/* ============================================================
   缺口日志与投稿邀请测试（BL-021，2026-10-13 落地）
   ------------------------------------------------------------
   跑法： node tests/gap-hint.test.js   （或 npm test）
   退出码：任何一条 FAIL → 1

   守的是设计 PRD《写侧触发与缺口日志》§七 的验收标准：
     · 未命中才触发，命中不触发（不制造噪音）
     · 只存 hash + 长度 + 分数，**绝不落查询原文**（医院场景第一防线）
     · 同 hash 24h 内只记一次（防噪声淹没真信号）
     · RECIPE_GAP_LOG=0 可整体关闭
     · 投稿邀请只在写侧开启时出现（只读部署不该诱导写操作）
     · 日志与库同根，但**绝不污染真实仓库**——本文件全程用临时目录

   ⚠️ 为什么必须换临时目录：gapLogPath() = dirname(RECIPE_BOOK_PATH)/gaps.jsonl，
   若直接用真实 api/experiences.json，测试会把 api/gaps.jsonl 写进仓库。
   故本文件复制一份库到 tmp 并把 RECIPE_BOOK_PATH 指过去。
   ============================================================ */

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, SERVER, check, section, done } from "./_harness.js";

const TMP = mkdtempSync(join(tmpdir(), "recipe-gap-"));
const DATA = join(TMP, "experiences.json");
const GAP_FILE = join(TMP, "gaps.jsonl");
copyFileSync(join(ROOT, "api", "experiences.json"), DATA);

function start(envExtra = {}) {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, RECIPE_BOOK_PATH: DATA, ...envExtra },
  });
  const state = { buf: "", pending: new Map(), nextId: 1 };
  child.stdout.on("data", (d) => {
    state.buf += d.toString();
    let i;
    while ((i = state.buf.indexOf("\n")) >= 0) {
      const line = state.buf.slice(0, i).trim();
      state.buf = state.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const key = String(msg.id);
      const w = state.pending.get(key);
      if (w) {
        state.pending.delete(key);
        clearTimeout(w.timer);
        w.resolve(msg);
      }
    }
  });
  state.call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = state.nextId++;
      const timer = setTimeout(() => {
        state.pending.delete(String(id));
        reject(new Error(method + " 超时（8s）"));
      }, 8000);
      state.pending.set(String(id), { resolve, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  state.kill = () => child.kill();
  return state;
}

async function withServer(envExtra, fn) {
  const s = start(envExtra);
  try {
    await s.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "gap-test", version: "1" },
    });
    return await fn(s);
  } finally {
    s.kill();
  }
}

function payloadOf(msg) {
  return JSON.parse(msg.result.content[0].text);
}

async function search(s, query) {
  const msg = await s.call("tools/call", {
    name: "search_recipes",
    arguments: { query, limit: 3 },
  });
  return payloadOf(msg);
}

const MISS_Q = "xyzzyqqzz";
const HIT_Q = "requests 抓中文站乱码";

/* ---------------- 一、工具挂载 ---------------- */
section("一、gap_report 是只读工具，默认就在列表里");
await withServer({}, async (s) => {
  const list = await s.call("tools/list", {});
  const names = list.result.tools.map((t) => t.name);
  check("默认 tools/list 含 gap_report", names.includes("gap_report"), JSON.stringify(names));
  check("gap_report 是只读的（默认未开启写入时也在）", !names.includes("submit_recipe"));

  const p = payloadOf(await s.call("tools/call", { name: "gap_report", arguments: {} }));
  check("gap_report 返回 total_records / unique_gaps / items", ["total_records", "unique_gaps", "items"].every((k) => k in p), Object.keys(p).join(","));
  check("空日志时 items 为数组且不炸", Array.isArray(p.items) && p.items.length === 0);
});

/* ---------------- 二、未命中才触发 ---------------- */
section("二、未命中才记缺口，命中绝不记");
await withServer({}, async (s) => {
  const miss = await search(s, MISS_Q);
  check("未命中时返回体带 gap 字段", "gap" in miss, JSON.stringify(miss.gap || {}));
  check("缺口已落盘（recorded=true）", miss.gap && miss.gap.recorded === true, JSON.stringify(miss.gap || {}));

  const hit = await search(s, HIT_Q);
  check("命中查询的返回体不带 gap 字段（不制造噪音）", !("gap" in hit), JSON.stringify(hit.gap || {}));
});

/* ---------------- 三、绝不落查询原文 ---------------- */
section("三、只存 hash + 长度 + 分数，绝不落原文");
check("缺口日志与库同根（落在库文件同目录）", existsSync(GAP_FILE), GAP_FILE);
{
  const lines = readFileSync(GAP_FILE, "utf8").split("\n").filter(Boolean);
  const first = JSON.parse(lines[0]);
  check("字段只含 ts / query_hash / query_len / matched / top_match_pct / tags", ["ts", "query_hash", "query_len", "matched", "top_match_pct", "top_score", "tags"].every((k) => k in first), Object.keys(first).join(","));
  check("不存在 query 原文字段", !("query" in first) && !("query_sample" in first), Object.keys(first).join(","));
  check("整个文件里搜不到那条查询的原文", !readFileSync(GAP_FILE, "utf8").includes(MISS_Q));
}

/* ---------------- 四、去重与开关 ---------------- */
section("四、24h 去重 + 可整体关闭");
await withServer({}, async (s) => {
  const again = await search(s, MISS_Q);
  check("同一查询 24h 内不重复记账（reason=deduped）", again.gap && again.gap.recorded === false && again.gap.reason === "deduped", JSON.stringify(again.gap || {}));
});
await withServer({ RECIPE_GAP_LOG: "0" }, async (s) => {
  const off = await search(s, "abcxyzzyqqzz");
  check("RECIPE_GAP_LOG=0 时不记账（reason=disabled）", off.gap && off.gap.recorded === false && off.gap.reason === "disabled", JSON.stringify(off.gap || {}));
});

/* ---------------- 五、投稿邀请只在写侧开启时出现 ---------------- */
section("五、投稿邀请（contribute）只在开启写入时才给");
await withServer({}, async (s) => {
  const miss = await search(s, "ghixyzzyqqzz");
  check("只读部署下不带 contribute（不诱导写操作）", !("contribute" in miss));
});
await withServer({ RECIPE_BOOK_WRITE: "1", RECIPE_GAP_LOG: "0" }, async (s) => {
  const miss = await search(s, "mnoxyzzyqqzz");
  check("写侧开启且未命中 → 带 contribute", "contribute" in miss, JSON.stringify(miss.contribute || {}));
  check("contribute 指明用 submit_recipe", miss.contribute && miss.contribute.suggested_tool === "submit_recipe");
});

/* ---------------- 六、RAW 模式必须先打码 ---------------- */
section("六、RAW 模式的原文要先打码");
{
  const rawDir = mkdtempSync(join(tmpdir(), "recipe-gap-raw-"));
  const rawData = join(rawDir, "experiences.json");
  copyFileSync(join(ROOT, "api", "experiences.json"), rawData);
  await withServer({ RECIPE_BOOK_PATH: rawData, RECIPE_GAP_LOG_RAW: "1" }, async (s) => {
    await search(s, "12345678 xyzzyqqzz");
  });
  const rawFile = join(rawDir, "gaps.jsonl");
  if (existsSync(rawFile)) {
    const raw = readFileSync(rawFile, "utf8");
    check("RAW 模式下长数字被打码为 <num>", raw.includes("<num>"), raw.slice(0, 120));
    check("RAW 模式下原文长数字不落盘", !raw.includes("12345678"));
  } else {
    check("RAW 模式下长数字被打码为 <num>", false, "未生成日志文件");
    check("RAW 模式下原文长数字不落盘", false, "未生成日志文件");
  }
  rmSync(rawDir, { recursive: true, force: true });
}

rmSync(TMP, { recursive: true, force: true });
done();
