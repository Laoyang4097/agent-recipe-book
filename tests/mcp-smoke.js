/* ============================================================
   MCP Server 冒烟测试（PRD 增量 v1.2 §7.3）
   ------------------------------------------------------------
   跑法： node tests/mcp-smoke.js
   做法：真的 spawn 一个 mcp/server.js 子进程，走 stdio 说 JSON-RPC，
         断言每一条验收标准；失败退出码非 0。
   ============================================================ */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "mcp", "server.js");

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { failures.push(name); console.log(`  ❌ ${name}${detail ? "  — " + detail : ""}`); }
}
function section(t) { console.log(`\n${t}`); }

/* ---------------- 起子进程并做一次请求/响应会话 ---------------- */
function startServer() {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
  const state = { child, buf: "", pending: new Map(), nextId: 1, stderr: [], exited: null };

  child.stderr.on("data", (d) => state.stderr.push(d.toString()));
  child.on("exit", (code, sig) => { state.exited = { code, sig }; });

  child.stdout.on("data", (d) => {
    state.buf += d.toString();
    let i;
    while ((i = state.buf.indexOf("\n")) >= 0) {
      const line = state.buf.slice(0, i).trim();
      state.buf = state.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const key = msg.id === null || msg.id === undefined ? "__notification__" : String(msg.id);
      const waiter = state.pending.get(key);
      if (waiter) { state.pending.delete(key); waiter.resolve(msg); }
    }
  });

  state.call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = state.nextId++;
      const timer = setTimeout(
        () => { state.pending.delete(String(id)); reject(new Error(`${method} 超时（8s）`)); }, 8000);
      state.pending.set(String(id), {
        resolve: (m) => { clearTimeout(timer); resolve(m); },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });

  state.notify = (method, params) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

  state.stop = () => { try { child.stdin.end(); } catch {} setTimeout(() => child.kill(), 150); };

  return state;
}

console.log("=== MCP Server 冒烟测试 ===");

const s = startServer();

/* ---------------- AC：握手 + 工具列表 ---------------- */
try {
  const t0 = Date.now();
  const init = await s.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "1.0.0" },
  });
  const bootMs = Date.now() - t0;

  section("一、握手（§7.3 AC-1 / AC-2）");
  check("initialize 返回成功", !init.error, JSON.stringify(init.error));
  check("返回 protocolVersion", typeof init.result?.protocolVersion === "string", init.result?.protocolVersion);
  check("声明 tools 能力", !!init.result?.capabilities?.tools);
  check("返回 serverInfo.name", init.result?.serverInfo?.name === "agent-recipe-book");
  check("返回 instructions（含「不要编造」约束）",
    typeof init.result?.instructions === "string" && init.result.instructions.includes("不要用你自己的知识补答案"));
  check(`冷启动 < 2000ms（实测 ${bootMs}ms，含进程启动）`, bootMs < 2000, `${bootMs}ms`);

  // 按协议补发 initialized 通知（不应有回复，也不应报错）
  s.notify("notifications/initialized", {});
  const ping = await s.call("ping", {});
  check("补发 initialized 通知后服务仍正常（ping 有响应）", !ping.error);

  const list = await s.call("tools/list", {});
  const tools = list.result?.tools || [];
  section("二、工具列表");
  console.log("      工具:", tools.map((t) => t.name).join(" / "));
  check("返回 3 个工具", tools.length === 3, `实际 ${tools.length}`);
  check("含 search_recipes / get_recipe / list_tags",
    ["search_recipes", "get_recipe", "list_tags"].every((n) => tools.some((t) => t.name === n)));

  const sr = tools.find((t) => t.name === "search_recipes");
  check("search_recipes.inputSchema 合法（type=object + required=query）",
    sr?.inputSchema?.type === "object" && (sr?.inputSchema?.required || []).includes("query"));
  check("search_recipes 描述写明了「何时用」", /何时用/.test(sr?.description || ""));
  check("search_recipes 描述写明了「tags 可传哪些值」", /tags 可传的值[:：]/.test(sr?.description || ""));
  check("list_tags 无必填参数", !(tools.find((t) => t.name === "list_tags")?.inputSchema?.required || []).length);

  /* ---------------- AC-3：命中 ---------------- */
  section("三、检索正确性（§7.3 AC-3 / AC-4）");
  const hit = await s.call("tools/call", { name: "search_recipes", arguments: { query: "抓回来是乱码" } });
  const hitPayload = JSON.parse(hit.result.content[0].text);
  console.log(`      matched=${hitPayload.matched} 意图词=${(hitPayload.synTags || []).join(",")}`);
  console.log(`      Top: ${hitPayload.results.map((r) => r.id.replace("recipe-", "")).join(", ")}`);
  check("命中数 ≥ 1", hitPayload.matched >= 1, `matched=${hitPayload.matched}`);
  check("结果含 recipe-py-encoding-mojibake",
    hitPayload.results.some((r) => r.id === "recipe-py-encoding-mojibake"));
  check("结果条数 ≤ limit（默认 5）", hitPayload.results.length <= 5);
  check("每条结果含结构化死胡同（≥1 条且字段齐）",
    hitPayload.results.every((r) =>
      Array.isArray(r.dead_ends) && r.dead_ends.length >= 1 &&
      r.dead_ends.every((d) => d.attempt && d.failure !== undefined)));
  check("结果含解法与 score",
    hitPayload.results.every((r) => typeof r.solution === "string" && typeof r.score === "number"));

  const miss = await s.call("tools/call", { name: "search_recipes", arguments: { query: "怎么给猫剪指甲" } });
  const missPayload = JSON.parse(miss.result.content[0].text);
  check("无命中时返回 results: [] 且不报错（AC-4）",
    !miss.error && Array.isArray(missPayload.results) && missPayload.results.length === 0,
    JSON.stringify(miss.error || missPayload).slice(0, 80));
  check("无命中时给出 hint", typeof missPayload.hint === "string" && missPayload.hint.length > 0);
  check("无命中不是 isError（属正常业务结果）", miss.result.isError !== true);

  /* ---------------- limit / tags ---------------- */
  const lim = await s.call("tools/call", { name: "search_recipes", arguments: { query: "乱码", limit: 2 } });
  const limPayload = JSON.parse(lim.result.content[0].text);
  check("limit 生效", limPayload.results.length <= 2, `${limPayload.results.length}`);
  check("limit 不改变 matched 总数", limPayload.matched >= limPayload.results.length);

  const tg = await s.call("tools/call", { name: "search_recipes", arguments: { query: "乱码", tags: ["encoding"], limit: 20 } });
  const tgPayload = JSON.parse(tg.result.content[0].text);
  check("tags 过滤（AND）生效",
    tgPayload.results.every((r) => (r.tags || []).includes("encoding")),
    `越界 ${tgPayload.results.filter((r) => !(r.tags || []).includes("encoding")).length} 条`);

  /* ---------------- get_recipe ---------------- */
  section("四、单条读取与目录");
  const one = await s.call("tools/call", { name: "get_recipe", arguments: { id: "recipe-py-encoding-mojibake" } });
  const onePayload = JSON.parse(one.result.content[0].text);
  check("get_recipe 返回完整配方", onePayload.id === "recipe-py-encoding-mojibake" && !!onePayload.solution);

  const none = await s.call("tools/call", { name: "get_recipe", arguments: { id: "recipe-does-not-exist" } });
  const nonePayload = JSON.parse(none.result.content[0].text);
  check("id 不存在 → 返回 not_found 且不抛异常（不产生 JSON-RPC error）",
    !none.error && nonePayload.error === "not_found", JSON.stringify(none.error || nonePayload).slice(0, 80));
  check("not_found 给出 hint", typeof nonePayload.hint === "string");

  const lt = await s.call("tools/call", { name: "list_tags", arguments: {} });
  const ltPayload = JSON.parse(lt.result.content[0].text);
  console.log(`      total=${ltPayload.total}  分类=${(ltPayload.groups || []).map((g) => g.label + ":" + g.count).join(" ")}`);
  check("list_tags 返回总数", typeof ltPayload.total === "number" && ltPayload.total > 0);
  check("list_tags 返回 tags（含 count）",
    Array.isArray(ltPayload.tags) && ltPayload.tags.length > 0 && typeof ltPayload.tags[0].count === "number");
  check("list_tags 返回领域分类且计数之和 == total",
    (ltPayload.groups || []).filter((g) => g.key !== "all").reduce((a, g) => a + g.count, 0) === ltPayload.total,
    JSON.stringify(ltPayload.groups));

  /* ---------------- 参数校验 ---------------- */
  section("五、参数校验与错误约定（§7.3 AC-5）");
  const e1 = await s.call("tools/call", { name: "search_recipes", arguments: {} });
  check("缺 query → -32602", e1.error?.code === -32602, JSON.stringify(e1.error));
  const e2 = await s.call("tools/call", { name: "search_recipes", arguments: { query: 123 } });
  check("query 非字符串 → -32602", e2.error?.code === -32602);
  const e3 = await s.call("tools/call", { name: "search_recipes", arguments: { query: "x", limit: 999 } });
  check("limit 超上限 → -32602", e3.error?.code === -32602, JSON.stringify(e3.error));
  const e4 = await s.call("tools/call", { name: "search_recipes", arguments: { query: "x", tags: "encoding" } });
  check("tags 非数组 → -32602", e4.error?.code === -32602);
  const e5 = await s.call("tools/call", { name: "no_such_tool", arguments: {} });
  check("未知工具 → -32602", e5.error?.code === -32602);
  const e6 = await s.call("no/such/method", {});
  check("未知方法 → -32601", e6.error?.code === -32601, JSON.stringify(e6.error));

  /* ---------------- AC-6：只读边界 ---------------- */
  section("六、安全边界（§7.3 AC-6）");
  const WRITE_WORDS = ["write", "create", "update", "delete", "remove", "submit", "publish", "push", "ingest"];
  const offenders = tools.filter((t) => WRITE_WORDS.some((w) => t.name.toLowerCase().includes(w)));
  check("工具列表内不存在任何写操作", offenders.length === 0, offenders.map((t) => t.name).join(","));
  check("工具实现里不引用写入 API（无 fs.writeFile / child_process 调用）",
    !/writeFile|appendFile|unlink|child_process|execSync/.test(
      (await import("node:fs")).readFileSync(join(ROOT, "mcp", "server.js"), "utf8")));
} catch (err) {
  check("测试执行未抛异常", false, err.message);
} finally {
  s.stop();
}

/* ---------------- 数据源缺失时的行为（AC：不冒充空库） ---------------- */
section("七、数据源不可达（PRD §9 边界 #8）");
try {
  const bad = startServerWithEnv({ RECIPE_BOOK_PATH: join(ROOT, "api", "__not_exists__.json") });
  await bad.call("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
  const r = await bad.call("tools/call", { name: "search_recipes", arguments: { query: "乱码" } });
  const payload = JSON.parse(r.result.content[0].text);
  check("返回 data_source_unavailable 而不是空结果",
    payload.error === "data_source_unavailable", JSON.stringify(payload).slice(0, 90));
  check("标记 isError: true（调用方能识别失败）", r.result.isError === true);
  check("错误信息含实际路径（便于排查）", /__not_exists__/.test(payload.detail || ""));
  check("服务未崩溃（进程仍存活）", bad.exited === null);
  bad.stop();
} catch (err) {
  check("数据源缺失场景测试执行未抛异常", false, err.message);
}

function startServerWithEnv(env) {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  const state = { child, buf: "", pending: new Map(), nextId: 1, exited: null };
  child.on("exit", (code, sig) => { state.exited = { code, sig }; });
  child.stdout.on("data", (d) => {
    state.buf += d.toString();
    let i;
    while ((i = state.buf.indexOf("\n")) >= 0) {
      const line = state.buf.slice(0, i).trim();
      state.buf = state.buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const w = state.pending.get(String(msg.id));
      if (w) { state.pending.delete(String(msg.id)); w(msg); }
    }
  });
  state.call = (method, params) => new Promise((resolve, reject) => {
    const id = state.nextId++;
    const timer = setTimeout(() => reject(new Error(method + " 超时")), 8000);
    state.pending.set(String(id), (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  state.stop = () => { try { child.stdin.end(); } catch {} setTimeout(() => child.kill(), 150); };
  return state;
}

/* ---------------- 汇总 ---------------- */
console.log("\n=== 汇总 ===");
console.log(`  通过 ${pass} 项 ｜ 失败 ${failures.length} 项`);
if (failures.length) {
  console.log("  失败清单：");
  failures.forEach((f) => console.log("    - " + f));
  console.log("\n❌ MCP Server 冒烟测试失败");
  process.exit(1);
}
console.log("\n✅ MCP Server 全部通过");
