/* ============================================================
   写侧 MCP 端到端测试（PRD《写侧 MCP v1.0》§6.1）
   ------------------------------------------------------------
   跑法： node tests/write-mcp.test.js
   做法：真 spawn 一个开了写入的 mcp/server.js，走 stdio 说 JSON-RPC，
         按 PRD 的 A-1..A-15 逐条断言；跑完把落盘文件与索引还原干净。

   为什么不测 Python 层就完事：隔离态「搜不到但看得见」这类口径问题
   只有在 MCP 这一层才暴露（读侧过滤认的是 confidence，写侧落的是 status）。
   ============================================================ */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickPython } from "../lib/pybin.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "mcp", "server.js");
/* 解释器探测与 run-python.js 共用一份（见 pybin.js）：写侧要真 spawn ingest.py，
   挑到没有 pyyaml 的那个，整个测试会以「未安装 pyyaml」伪装成环境缺失而全红。 */
const PY = pickPython();
console.log(`[解释器] ${PY}`);
const RECIPES_DIR = path.join(ROOT, "recipes");
const EXP_JSON = path.join(ROOT, "api", "experiences.json");
const LLMS_TXT = path.join(ROOT, "llms.txt");

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { failures.push(name); console.log(`  ❌ ${name}${detail ? "  — " + detail : ""}`); }
}
function section(t) { console.log(`\n${t}`); }

function startServer(env = {}) {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, RECIPE_BOOK_WRITE: "1", RECIPE_BOOK_PYTHON: PY, ...env },
  });
  const state = { child, buf: "", pending: new Map(), nextId: 1, stderr: [] };
  child.stderr.on("data", (d) => state.stderr.push(d.toString()));
  child.stdout.on("data", (d) => {
    state.buf += d.toString();
    let i;
    while ((i = state.buf.indexOf("\n")) >= 0) {
      const line = state.buf.slice(0, i).trim();
      state.buf = state.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const key = msg.id == null ? "__n__" : String(msg.id);
      const w = state.pending.get(key);
      if (w) { state.pending.delete(key); w.resolve(msg); }
    }
  });
  // 写侧要 spawn python，比读侧慢，超时给到 20s
  state.call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = state.nextId++;
      const timer = setTimeout(() => {
        state.pending.delete(String(id));
        reject(new Error(`${method} 超时（20s）`));
      }, 20000);
      state.pending.set(String(id), { resolve: (m) => { clearTimeout(timer); resolve(m); } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  state.stop = () => { try { child.stdin.end(); } catch {} setTimeout(() => child.kill(), 150); };
  return state;
}

const payloadOf = (res) => {
  try { return JSON.parse((res.result.content || [])[0].text); } catch { return null; }
};
const callTool = async (s, name, args) => {
  const res = await s.call("tools/call", { name, arguments: args });
  const body = payloadOf(res);
  // tools/call 也可能返回 protocol 层错误（-32602 等），此时没有 result 字段
  return { res, body, isError: !!(res.result && res.result.isError), err: res.error };
};

const FULL = {
  title: "Git Bash 的 /tmp 与 Windows Python 不是同一个目录",
  tags: ["git-bash", "python"],
  model: "Node 22 / Git Bash",
  problem: "测试脚本往 /tmp 写临时文件，Python 侧读同一路径报 FileNotFoundError。",
  // 注意：这里不能出现真实用户目录，否则会被脱敏规则拦下（那正是它该做的）
  solution: "改用两边 shell 与 Python 都认的临时目录绝对路径，不再走 /tmp 这种单侧翻译的路径。",
  dead_ends: [{
    attempt: "先当成路径写法问题",
    failure: "换成反斜杠也一样报找不到",
    duration: "15 分钟",
    early_signal: "Git Bash 里的 /tmp 被翻译成 Windows 自己的临时目录",
  }],
  contributor: "@write-tester",
};

/* ---------------- 跑 ---------------- */
const backup = {
  exp: fs.readFileSync(EXP_JSON, "utf8"),
  llms: fs.readFileSync(LLMS_TXT, "utf8"),
};
/* 记下开跑前的配方清单，收尾时把「多出来的」一律删掉。
   只删本次自己建的（created）是不够的：哪次中途崩了留下一个孤儿文件，
   下次跑就会一直挂在库里，最后那条「库未被污染」还会假红。 */
const filesBefore = new Set(fs.readdirSync(RECIPES_DIR));
let s = null;

try {
  s = startServer();
  await s.call("initialize", { protocolVersion: "2024-11-05", capabilities: {} });

  section("A-1 / A-4 / A-9  提交完整配方");
  const nBefore = fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".md")).length;
  const id = "recipe-write-test-tmp";
  const r1 = await callTool(s, "submit_recipe", { ...FULL, id });
  check("A-1 提交成功并返回 id 与下一步人工动作",
    r1.body && r1.body.id === id && /promote_recipe/.test(r1.body.next_human_action || ""),
    JSON.stringify(r1.body).slice(0, 160) + ` || raw=${JSON.stringify(r1.res).slice(0, 300)}`);
  check("A-4 成功落盘，recipes/ 增加 1 个文件",
    fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".md")).length === nBefore + 1);
  check("A-9 贡献者落地为匿名哈希", /^anon-/.test((r1.body || {}).contributor_id || ""),
    (r1.body || {}).contributor_id);
  // filesBefore 快照负责收尾清理，这里不用再记账

  section("A-2 / A-3 / A-4  缺字段与死胡同子字段逐条点名");
  const r2 = await callTool(s, "submit_recipe", {
    title: "", tags: ["x"], model: "", problem: "", solution: "", dead_ends: [],
  });
  const e2 = (r2.body && r2.body.errors || []).map((e) => e.field);
  check("A-2 缺 4 个必填字段时一次报全",
    ["title", "model", "problem", "solution"].every((k) => e2.includes(k)), JSON.stringify(e2));
  const r3 = await callTool(s, "submit_recipe", {
    ...FULL, id: "recipe-write-test-tmp2",
    dead_ends: [{ attempt: "a", failure: "b", duration: "c", early_signal: "" }],
  });
  const e3 = (r3.body && r3.body.errors || []).map((e) => e.field);
  check("A-3 死胡同缺 early_signal 被点名", e3.includes("dead_ends[0].early_signal"), JSON.stringify(e3));
  check("A-3 拒绝走的是业务失败而非协议错误（-32602）", !r3.err, JSON.stringify(r3.err || {}));
  check("A-4 失败后不落任何文件",
    fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".md")).length === nBefore + 1);

  section("A-5 / A-6  撞 id 与中文标题");
  // 撞 id 必须拿一个「确定已存在」的 id 来撞，不能靠标题 slug 碰运气：
  // 上次跑测试留下的同名文件会让这条断言假绿，删干净了又假红。
  const collide = path.join(RECIPES_DIR, "recipe-git-pat-push.md");
  const before4 = fs.readFileSync(collide, "utf8");
  const r4 = await callTool(s, "submit_recipe", { ...FULL, id: "recipe-git-pat-push" });
  check("A-5 撞 id 被拒且提示原内容不动",
    (r4.body.errors || []).some((e) => e.field === "id"), JSON.stringify(r4.body));
  check("A-5 撞 id 时原稿一字未改",
    fs.readFileSync(collide, "utf8") === before4, "原稿内容与撞击前不一致");
  const r5 = await callTool(s, "submit_recipe", { ...FULL, title: "端口被占了", id: "" });
  check("A-6 纯中文标题未给 id 时被拒",
    (r5.body.errors || []).some((e) => e.field === "id"), JSON.stringify(r5.body));

  section("AC-4.2 / AC-4.3  隔离态：搜不到，但看得见");
  const r6 = await callTool(s, "search_recipes", { query: "Git Bash 的 tmp 目录" });
  const hitIds = ((r6.body || {}).results || []).map((r) => r.id);
  check("A-7 提交后主检索默认搜不到它", !hitIds.includes(id), JSON.stringify(hitIds));
  const r7 = await callTool(s, "list_quarantine", {});
  const qIds = ((r7.body || {}).items || []).map((r) => r.id);
  check("A-8 提交后它出现在隔离清单里", qIds.includes(id), JSON.stringify(qIds.slice(0, 5)));
  const r8 = await callTool(s, "get_recipe", { id });
  check("A-11 隔离稿可取到完整内容（非一行摘要）",
    (r8.body || {}).dead_ends && (r8.body || {}).dead_ends[0] && (r8.body || {}).dead_ends[0].early_signal);

  section("A-10  同一贡献者匿名标识稳定");
  const r9 = await callTool(s, "submit_recipe", { ...FULL, id: "recipe-write-test-tmp3" });
  check("A-10 同一 contributor 两次投稿同一匿名标识",
    r9.body && r9.body.contributor_id === r1.body.contributor_id,
    `${r1.body.contributor_id} vs ${(r9.body || {}).contributor_id}`);
// filesBefore 快照负责收尾清理，这里不用再记账

  section("A-14 / A-12 / A-13  晋升门槛");
  const r10 = await callTool(s, "promote_recipe", { id, confidence: "A" });
  check("A-14 C→A 跳级被拒（禁跳级）",
    (r10.body.errors || []).some((e) => /跳级/.test(e.reason)), JSON.stringify(r10.body));
  const r11 = await callTool(s, "promote_recipe", { id, confidence: "B" });
  check("A-12 死胡同四段齐全可升 B", r11.body && r11.body.confidence === "B"
    && r11.body.status === "published", JSON.stringify(r11.body));
  const r12 = await callTool(s, "promote_recipe", { id, confidence: "A" });
  check("A-13 无实测结论升 A 被拒并点名 result",
    (r12.body.errors || []).some((e) => e.field === "result"), JSON.stringify(r12.body));

  /* §5.7 闭环：想让一条存疑稿被正常检索到，正确路径是「晋升」，
     不是绕过隔离区、也不是直接改 status。这条把它完整走一遍。 */
  section("§5.7 闭环：晋升是存疑稿见光的正道");
  const afterPro = await callTool(s, "search_recipes", { query: "Git Bash 的 tmp 目录" });
  const afterEntry = ((((afterPro.body || {}).results) || []).find((r) => r.id === id)) || null;
  check("晋升 B 后主检索搜得到它", !!afterEntry,
    JSON.stringify((((afterPro.body || {}).results) || []).map((r) => r.id)));
  check("它现在 confidence='B' 且不挂 suspect 标记",
    afterEntry && afterEntry.confidence === "B" && afterEntry.suspect !== true,
    JSON.stringify(afterEntry));

  section("A-15  晋升后可进公开目录");
  const r13 = await callTool(s, "promote_recipe", { id: "no-such-id", confidence: "B" });
  check("未知 id 晋升被拒", (r13.body.errors || []).some((e) => e.field === "id"));

  section("B-4  写工具只在显式开启时出现");
  s.stop();
  await new Promise((r) => setTimeout(r, 250));
  const s2 = startServer({ RECIPE_BOOK_WRITE: "" });   // 模拟未开启
  await s2.call("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
  const list = await s2.call("tools/list", {});
  const names = list.result.tools.map((t) => t.name);
  check("B-4 默认.tools/list 只有 4 个读工具",
    names.length === 4 && !names.includes("submit_recipe"), JSON.stringify(names));
  check("B-4 默认写入未开启时调写工具报 -32602",
    (await s2.call("tools/call", { name: "submit_recipe", arguments: {} })).error?.code === -32602);
  s2.stop();
  await new Promise((r) => setTimeout(r, 250));
} finally {
  for (const f of fs.readdirSync(RECIPES_DIR)) {
    if (filesBefore.has(f)) continue;
    try { fs.rmSync(path.join(RECIPES_DIR, f), { force: true }); } catch {}
  }
  fs.writeFileSync(EXP_JSON, backup.exp);
  fs.writeFileSync(LLMS_TXT, backup.llms);
  if (s) s.stop();
}

/* ---------------- 收尾：库必须回到原样 ---------------- */
section("回归：库未被测试污染");
// 跟开跑前快照比，不跟硬编码数字比：写死「44」会把「库里 legit 多了几条配方」
// 这种正常动作当成污染。真正要守的是「没多出任何不属于这次运行的文件」。
const nowFiles = fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".md"));
const strays = nowFiles.filter((f) => !filesBefore.has(f));
check("recipes/ 多出的文件全部清干净（与开跑前快照逐一比对）",
  strays.length === 0 && nowFiles.every((f) => filesBefore.has(f)),
  `开跑前 ${filesBefore.size} 个 / 现在 ${nowFiles.length} 个 / 残留 ${strays.join(",")}`);
check("测试配方残留已清理", !fs.existsSync(path.join(RECIPES_DIR, "recipe-write-test-tmp.md")));
check(" experiences.json 已还原", fs.readFileSync(EXP_JSON, "utf8") === backup.exp);

console.log(`\n通过 ${pass} / 失败 ${failures.length}`);
if (failures.length) { failures.forEach((f) => console.log(`  ❌ ${f}`)); process.exit(1); }
