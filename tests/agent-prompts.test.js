/* ============================================================
   经验向导 Agent · 自动上岗测试（PRD 增量 v1.2 §8.0 / R-4）
   ------------------------------------------------------------
   跑法： node tests/agent-prompts.test.js
   做法： spawn 真实 mcp/server.js，断言 prompts 能力、prompts/list、
         prompts/get 返回的「培训手册」含全部硬约束 C-1~C-6 与降级/免责声明。
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

function startServer() {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
  const state = { child, buf: "", pending: new Map(), nextId: 1, exited: null };
  child.stderr.on("data", () => {});
  child.on("exit", (code) => { state.exited = { code }; });
  child.stdout.on("data", (d) => {
    state.buf += d.toString();
    let i;
    while ((i = state.buf.indexOf("\n")) >= 0) {
      const line = state.buf.slice(0, i).trim();
      state.buf = state.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const key = msg.id === null || msg.id === undefined ? "__n__" : String(msg.id);
      const waiter = state.pending.get(key);
      if (waiter) { state.pending.delete(key); waiter.resolve(msg); }
    }
  });
  state.call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = state.nextId++;
      const timer = setTimeout(() => { state.pending.delete(String(id)); reject(new Error(`${method} 超时（8s）`)); }, 8000);
      state.pending.set(String(id), { resolve: (m) => { clearTimeout(timer); resolve(m); } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  state.stop = () => { try { child.stdin.end(); } catch {} setTimeout(() => child.kill(), 150); };
  return state;
}

console.log("=== 经验向导 Agent · 自动上岗测试 ===");

const s = startServer();

try {
  const init = await s.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "agent-prompts-test", version: "1.0.0" },
  });

  section("一、initialize 声明 prompts 能力（§8.0 自动上岗）");
  check("initialize 成功", !init.error, JSON.stringify(init.error));
  check("声明 prompts 能力", !!init.result?.capabilities?.prompts, JSON.stringify(init.result?.capabilities));

  section("二、prompts/list 返回 experience-guide");
  const plist = await s.call("prompts/list", {});
  const prompts = plist.result?.prompts || [];
  check("返回 ≥1 个 prompt", prompts.length >= 1, `实际 ${prompts.length}`);
  const guide = prompts.find((p) => p.name === "experience-guide");
  check("含 experience-guide", !!guide);
  check("experience-guide 带可选参数 question",
    guide?.arguments?.some((a) => a.name === "question" && a.required === false));
  check("experience-guide 描述提到「自动上岗」", /自动上岗/.test(guide?.description || ""));

  section("三、prompts/get 返回的培训手册含全部硬约束（§8.2 C-1~C-6）");
  const pget = await s.call("prompts/get", { name: "experience-guide" });
  check("prompts/get 成功", !pget.error, JSON.stringify(pget.error));
  const msgs = pget.result?.messages || [];
  const text = msgs.map((m) => (m.content?.text || "")).join("\n");
  check("返回 1 条 user 消息", msgs.length === 1 && msgs[0].role === "user");
  for (const c of ["C-1", "C-2", "C-3", "C-4", "C-5", "C-6"]) {
    check(`手册含硬约束 ${c}`, text.includes(c), "未在手册中检出");
  }
  check("C-2 要求带 [配方id]", /\[配方id\]/.test(text) || /recipe-/.test(text));
  check("C-4 要求「库内没有直接匹配」", text.includes("库内没有直接匹配"));
  check("C-6 要求附免责声明", text.includes("以上为库内经验，非官方认定"));
  check("手册含降级要求（不编造）", /不编造|不猜测|一律不说/.test(text));

  section("四、prompts/get 注入 question 参数");
  const pgetQ = await s.call("prompts/get", { name: "experience-guide", arguments: { question: "爬虫被反爬封了 IP" } });
  const textQ = (pgetQ.result?.messages || []).map((m) => (m.content?.text || "")).join("\n");
  check("注入的问题出现在模板中", textQ.includes("爬虫被反爬封了 IP") && textQ.includes("用户当前的问题"));

  section("五、异常：未知 prompt 返回 -32602");
  const bad = await s.call("prompts/get", { name: "not-exist" });
  check("未知 prompt 返回 -32602", bad.error?.code === -32602, JSON.stringify(bad.error));

  s.stop();
} catch (e) {
  s.stop();
  console.error("测试异常：", e);
  process.exit(1);
}

console.log(`\n=== 结果：${pass} 通过 / ${failures.length} 失败 ===`);
if (failures.length) {
  console.log("失败项：\n - " + failures.join("\n - "));
  process.exit(1);
}
console.log("🎉 自动上岗（prompts）全部通过");
