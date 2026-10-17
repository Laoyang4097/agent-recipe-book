#!/usr/bin/env node
/* ============================================================
   解题配方库 · 只读 MCP Server（stdio）
   ------------------------------------------------------------
   规格：PRD 增量 v1.2 §7（只读 MCP）+ §8（经验向导自动上岗：prompts）
   传输：stdio，newline-delimited JSON-RPC 2.0（不是 Content-Length 分帧）
   依赖：零第三方依赖（Node 标准库）；检索走 lib/search.js 共享内核
   权限：默认**只读** —— 不暴露写入工具。
       只有显式设 RECIPE_BOOK_WRITE=1 时，写工具才会出现在 tools/list（写侧内核在 api/ingest.py）

   设计要点（为什么这里没有第二个 AI）：
     一个 MCP 工具就是一次**函数调用**，不是对话。对方 Agent 传参数、我们回数据。
     "理解用户要什么"发生在对方 Agent 的脑子里；我们只负责"给得准"。
     本进程不调用任何 LLM，因此**物理上不可能编造**内容——它只会搬运库里已有的条目。

   用法：
     node mcp/server.js                    # 从 stdin 读 JSON-RPC，向 stdout 写
     RECIPE_BOOK_PATH=/path/to.json node mcp/server.js
     RECIPE_BOOK_WRITE=1 node mcp/server.js   # 挂载写工具（默认不给）
     RECIPE_BOOK_PYTHON=/path/to/python.exe node mcp/server.js  # 指定写侧内核的解释器
   ⚠️ stdout 只允许出现协议报文；一切日志走 stderr（否则会污染协议流）。
   ============================================================ */

import { readFileSync, statSync, appendFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { searchRecipes, listTags, GROUPS, confidenceOf } from "../lib/search.js";
import { verifyCitations } from "../lib/verifyCitations.js";
import { pickPython, pyCandidates } from "../lib/pybin.js";

/* ---------------- 常量 ---------------- */
const SERVER_INFO = { name: "agent-recipe-book", version: "1.0.0" };
const PROTOCOL_FALLBACK = "2024-11-05";
const SUPPORTED_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_OFFSET_FLOOR = MAX_LIMIT * 2; // 下限：库很小时也别把 offset 卡死
const MAX_OFFSET_HEADROOM = MAX_LIMIT; // 在"正好翻完"之外再留一整页余量

/* offset 上限**不能**写死成"库当前几条"：那样库一涨，最后一页就翻不出来
   （40 条时正好卡在边界，涨到 41 条才开始有隐患，再涨就直接吞数据）。
   按实际库规模推导，并留一整页余量。回归见 tests/mcp-smoke.js「翻页可覆盖全库」。 */
export function maxOffsetOf(recipes) {
  const n = Array.isArray(recipes) ? recipes.length : 0;
  const pages = Math.ceil(n / MAX_LIMIT);
  return Math.max(MAX_OFFSET_FLOOR, pages * MAX_LIMIT + MAX_OFFSET_HEADROOM);
}
const HINT_NOT_FOUND = "没有这个 id。先用 search_recipes 检索，或用 list_tags 看可用标签。";

const DATA_PATH =
  process.env.RECIPE_BOOK_PATH ||
  fileURLToPath(new URL("../api/experiences.json", import.meta.url));

/* ---------------- 写权限开关（进程级） ----------------
   写工具会写本机文件系统，绝不能因为「加了个功能」就默认开放。
   默认关闭——现有的只读客户端与测试路径完全不受影响；
   只有显式设 RECIPE_BOOK_WRITE=1，写工具才会出现在 tools/list 里。 */
const WRITE_ENABLED = process.env.RECIPE_BOOK_WRITE === "1";

/* ---------------- 租户标识（BL-022 · 多租户身份透明）----------------
   三份 MCP 入口（agent-recipe-book / lifelens-recipes / xhs）共用这一份 server.js，
   只靠 RECIPE_BOOK_PATH 换库。此前工具描述与返回体里都没有「当前连的是哪个库」，
   导致 Agent 靠名字猜——实测把通用主库误认成 LifeLens 专用库，于是压根没往里查也没往里写。
   现在：身份由服务端自己声明，调用方不用猜、也不用去翻客户端配置。
   可用 RECIPE_BOOK_ID 显式指定；否则从路径推断（books/<name>/... → <name>）。 */
function deriveBookId() {
  const p = process.env.RECIPE_BOOK_PATH;
  if (!p) return "default";
  const parts = String(p).replace(/\\/g, "/").split("/").filter(Boolean);
  for (let i = parts.length - 2; i >= 0; i--) {
    if (parts[i] === "books") return parts[i + 1] || "custom";
  }
  return "custom";
}
const BOOK_ID = process.env.RECIPE_BOOK_ID || deriveBookId();
const BOOK_IS_DEFAULT = BOOK_ID === "default";
/* 注意：BOOK_NOTE 里不要再重复写库名——调用方拼的是「当前库：<id>；<note>」，
   重复一遍就成了「当前库：default；通用主库（default）」。 */
const BOOK_NOTE = BOOK_IS_DEFAULT
  ? "通用主库：跨项目通用的坑，任何项目都该先查、解卡后都欢迎投稿"
  : `项目专属库：只收该项目的专属坑，通用坑请投 default 库`;
const BOOK_TAG = `（当前库：${BOOK_ID} — ${BOOK_NOTE}）`;

/* ---------------- 缺口日志（未命中留痕）----------------
   MCP 是请求-响应模型，服务端看不到对话，无法自动判断 AI 刚绕了几轮；
   「检索未命中」是服务端唯一亲眼目睹的「库里缺这一页」的证据，所以只抓这个信号。
   三条底线：① 只存 hash + 长度 + 分数，**绝不存查询原文**（防患者信息 / 内网路径入库）；
   ② RECIPE_GAP_LOG=0 可整体关闭；③ RECIPE_GAP_LOG_RAW=1 才记原文（且先做打码）。
   落盘与库同根，不上传、不进公开索引、不进 Pages。 */
const GAP_LOG_ENABLED = process.env.RECIPE_GAP_LOG !== "0";
const GAP_LOG_RAW = process.env.RECIPE_GAP_LOG_RAW === "1";
const GAP_LOG_DEDUPE_MS = 24 * 60 * 60 * 1000;
const GAP_LOG_MAX_BYTES = Number(process.env.RECIPE_GAP_LOG_MAX_BYTES || 2000000);
/* 分数阈值默认关闭（理由见下方 BL-021 注释）：只有显式设 RECIPE_MISS_SCORE=n 才启用。 */
const MISS_SCORE = process.env.RECIPE_MISS_SCORE ? Number(process.env.RECIPE_MISS_SCORE) : null;

function gapLogPath() {
  return join(dirname(DATA_PATH), "gaps.jsonl");
}

function hashQuery(q) {
  return createHash("sha256").update(String(q == null ? "" : q), "utf8").digest("hex").slice(0, 12);
}

/* RAW 模式的轻量打码：连续 6 位以上数字（病历号 / 电话一类）、绝对路径、IP、邮箱。
   注意这是 best-effort，不等于写侧 scan_sensitive 的同源复检；
   所以 RAW 只用于本机排查，日志不共享、不上传。 */
function scrubForGap(text) {
  return String(text == null ? "" : text)
    .replace(/\b\d{6,}\b/g, "<num>")
    .replace(/[A-Za-z]:\\[^\s"']*/g, "<path>")
    .replace(/\/(?:Users|home|root|var|opt|data)\/[^\s"']*/g, "<path>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>")
    .slice(0, 60);
}

function readGapLines() {
  const p = gapLogPath();
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function recordGap(entry) {
  if (!GAP_LOG_ENABLED) return { recorded: false, reason: "disabled" };
  const p = gapLogPath();
  try {
    if (existsSync(p) && statSync(p).size > GAP_LOG_MAX_BYTES) return { recorded: false, reason: "size_cap" };
    const prev = readGapLines()
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.query_hash === entry.query_hash)
      .map((e) => Date.parse(e.ts) || 0)
      .sort((a, b) => b - a)[0] || 0;
    if (prev && Date.now() - prev < GAP_LOG_DEDUPE_MS) return { recorded: false, reason: "deduped" };
    appendFileSync(p, JSON.stringify(entry) + "\n", "utf8");
    return { recorded: true };
  } catch {
    return { recorded: false, reason: "io_error" };
  }
}

function toolGapReport(args) {
  const raw = args?.limit;
  const limit = Number.isInteger(raw) && raw > 0 && raw <= 50 ? raw : 10;
  const lines = readGapLines();
  const agg = new Map();
  for (const line of lines) {
    let e = null;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || !e.query_hash) continue;
    const cur = agg.get(e.query_hash) || {
      query_hash: e.query_hash, count: 0, last_ts: "",
      query_len: e.query_len || 0, top_match_pct: e.top_match_pct || 0,
    };
    cur.count += 1;
    if (String(e.ts || "") > String(cur.last_ts || "")) {
      cur.last_ts = e.ts || "";
      cur.query_len = e.query_len || cur.query_len;
      cur.top_match_pct = e.top_match_pct || 0;
    }
    agg.set(e.query_hash, cur);
  }
  const items = [...agg.values()]
    .sort((a, b) => b.count - a.count || String(b.last_ts).localeCompare(String(a.last_ts)))
    .slice(0, limit);
  return textResult({
    total_records: lines.length,
    unique_gaps: agg.size,
    logging_enabled: GAP_LOG_ENABLED,
    has_query_text: GAP_LOG_RAW,
    note:
      "默认只存 hash + 长度 + 分数，不含查询原文；想知道具体缺什么，需自行对照本机调用日志，" +
      "或用 RECIPE_GAP_LOG_RAW=1 开启本机原文记录（会先打码）。",
    items,
  });
}

/* ---------------- 与写侧内核的桥接 ----------------
   校验、渲染、脱敏、晋升门槛全在 api/ingest.py，这里只做两件事：
   参数类型把关，以及把内核的结构化结果翻译成 MCP 报文。
   绝不在这里重写校验逻辑——本项目反复吃亏在「两份真值源」。 */
const INGEST_PY = fileURLToPath(new URL("../api/ingest.py", import.meta.url));

/* 解释器挑选：不能退回裸 `python` 就完事。
   本机（以及多数 Windows 开发机）PATH 上的 `python` 常是不带 pyyaml 的 managed
   解释器，带 pyyaml 的在另一个 venv 里。直接猜名字的话，写侧会 100% 失败，
   而报错写着「未安装 pyyaml」——看着像让用户装依赖，其实是选错了解释器，
   用户照着装一遍也解决不了。所以按「能 import yaml」筛，并打日志留痕。 */
let _pyBin = undefined;
function pythonBin() {
  if (_pyBin) return _pyBin;
  _pyBin = pickPython();
  const ok = _pyBin !== (process.env.RECIPE_BOOK_PYTHON || process.env.PYTHON);
  process.stderr.write(
    `[agent-recipe-book] 写侧解释器：${_pyBin}${ok ? "" : "（注意：这是 PATH 直出，可能缺 pyyaml）"}\n`
  );
  return _pyBin;
}

function runIngest(argv, stdinPayload) {
  const py = pythonBin();
  const r = spawnSync(py, [INGEST_PY, ...argv], {
    input: stdinPayload === undefined ? undefined : JSON.stringify(stdinPayload),
    encoding: "utf-8",
    // Windows 默认控制台码是 GBK，不强制 UTF-8 会把中文报错打成一堆问号
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error) {
    throw new RpcError(-32603, `无法启动写侧内核（${py}）：${r.error.message}`);
  }
  const out = (r.stdout || "").trim().split("\n").filter(Boolean).pop();
  let parsed = null;
  try {
    parsed = out ? JSON.parse(out) : null;
  } catch {
    parsed = null;
  }
  if (!parsed) {
    // 没拿到结构化回报就不当成功——宁可报错，也不能让调用方以为投稿落了地
    const tail = (r.stderr || "").trim().split("\n").slice(-2).join(" | ");
    let msg = `写侧内核未返回结构化结果（exit=${r.status}）。${tail}`;
    // 「未安装 pyyaml」多半不是真缺依赖，而是挑错了解释器。直说，省得用户去装一个用不上的包。
    if (/pyyaml|YAMLError/i.test(r.stderr || "")) {
      msg +=
        ` 当前解释器：${py}。若它确实不带 pyyaml，用 RECIPE_BOOK_PYTHON 指定另一个；` +
        `候选里有：${pyCandidates().slice(0, 4).join(" / ")}`;
    }
    throw new RpcError(-32603, msg);
  }
  return parsed;
}

/** 内核回报 ok:false 即业务失败（内容缺失 / 撞 id / 跳级等），转成 isError 结果。 */
function businessFailure(res) {
  return textResult({ ok: false, errors: res.errors }, true);
}

/* ---------------- 日志（只走 stderr） ---------------- */
function logErr(...args) {
  process.stderr.write("[agent-recipe-book] " + args.join(" ") + "\n");
}

/* ---------------- JSON-RPC 基础设施 ---------------- */
class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function replyOk(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyErr(id, code, message, data) {
  send({
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  });
}
function textResult(obj, isError = false) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  const r = { content: [{ type: "text", text }] };
  if (isError) r.isError = true;
  return r;
}

/* ---------------- 数据加载（带 mtime 缓存） ---------------- */
let cache = { recipes: [], mtimeMs: -1, error: null };

function loadData() {
  try {
    const st = statSync(DATA_PATH);
    if (cache.mtimeMs === st.mtimeMs && !cache.error) return cache;
    const parsed = JSON.parse(readFileSync(DATA_PATH, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("内容不是数组");
    cache = { recipes: parsed, mtimeMs: st.mtimeMs, error: null };
    logErr(`已加载 ${parsed.length} 条配方（${DATA_PATH}）`);
  } catch (e) {
    // 失败就如实失败，绝不返回空数组冒充「库里没有」——那会让调用方误判。
    cache = { recipes: [], mtimeMs: -1, error: `数据源不可达：${e.message}（${DATA_PATH}）` };
    logErr(cache.error);
  }
  return cache;
}

function publishedList(data) {
  return data.recipes.filter((r) => r && r.status === "published");
}

/* ---------------- 入参校验（严格，便于调用方一次改对） ---------------- */
function requireString(args, key) {
  const v = args?.[key];
  if (typeof v !== "string" || !v.trim()) {
    throw new RpcError(-32602, `参数 ${key} 必须是非空字符串`);
  }
  return v.trim();
}
function optionalTags(args) {
  const v = args?.tags;
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((t) => typeof t !== "string" || !t.trim())) {
    throw new RpcError(-32602, '参数 tags 必须是字符串数组（如 ["encoding"]）');
  }
  return v.map((t) => t.trim());
}
function optionalLimit(args) {
  const v = args?.limit;
  if (v === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(v) || v < 1 || v > MAX_LIMIT) {
    throw new RpcError(-32602, `参数 limit 必须是 1..${MAX_LIMIT} 的整数（默认 ${DEFAULT_LIMIT}）`);
  }
  return v;
}

function optionalOffset(args, ceiling = MAX_OFFSET_FLOOR) {
  const v = args?.offset;
  if (v === undefined) return 0;
  if (!Number.isInteger(v) || v < 0 || v > ceiling) {
    throw new RpcError(
      -32602,
      `参数 offset 必须是 0..${ceiling} 的整数（默认 0，用于翻页看后续结果）`
    );
  }
  return v;
}
function optionalQuarantine(args) {
  const v = args?.include_quarantine;
  if (v === undefined) return false;
  if (typeof v !== "boolean") {
    throw new RpcError(-32602, "参数 include_quarantine 必须是布尔值（默认 false）");
  }
  return v;
}

/* ---------------- 工具实现 ---------------- */
function toolSearchRecipes(args) {
  const data = loadData();
  if (data.error) {
    return textResult({ error: "data_source_unavailable", detail: data.error }, true);
  }
  const query = requireString(args, "query");
  const tags = optionalTags(args);
  const limit = optionalLimit(args);
  // 上限跟着实际库规模走，库涨到翻不完之前都不会静默吞数据
  const offset = optionalOffset(args, maxOffsetOf(data.recipes));
  const includeQuarantine = optionalQuarantine(args);
  const verify = args.verify === true;

  const res = searchRecipes(data.recipes, query, { tags, limit, offset, includeQuarantine });
  const payload = {
    // BL-022：返回体自带租户标识，调用方不必靠名字或配置文件去猜连的是哪个库
    book: BOOK_ID,
    matched: res.matched,
    returned: res.returned,
    has_more: res.has_more,
    quarantined_count: res.quarantined_count,
    // 透出切词与同义词扩展结果，让调用方能判断「为什么命中这些」而不是当黑盒
    terms: res.terms,
    synTags: res.synTags,
    results: res.results.map(({ score, recipe, matchPct, confidence, suspect }) => ({
      id: recipe.id,
      title: recipe.title,
      tags: recipe.tags || [],
      score: Number(score.toFixed(2)),
      matchPct,
      confidence,
      suspect,
      model: recipe.model,
      problem: recipe.problem,
      dead_ends: recipe.dead_ends || [],
      solution: recipe.solution,
      result: recipe.result,
      retrospective: recipe.retrospective,
      // 2026-10-01 边界字段：声明配方的适用/不适用边界（防错配锚定，见 v21 实验）
      applies_when: recipe.applies_when || "",
      not_applies_when: recipe.not_applies_when || "",
    })),
  };
  // BL-014：verify:true 时附带「可引用白名单」，调用方据此用 verify_citations 复核引用
  if (verify) payload.citable_ids = res.results.map((r) => r.recipe.id);
  if (res.hint) payload.hint = res.hint;
  /* BL-021 未命中判定：默认只认 matched===0 这一个无歧义信号。
     实测（2026-10-13）两条反直觉的事实，都记在这儿防止后人再踩：
     ① matchPct 是「相对 Top1 的归一化」，Top1 恒为 100%，拿它设阈值**永远不触发**；
     ② raw score 分不开噪声与真实查询——噪声「qqzz 完全不存在的主题」Top1=6，
        而真实查询「爬虫被封 IP 了」Top1 同样是 6。
     所以：默认只认零命中；分数阈值作为可选开关，启用就要接受噪声。 */
  const topScore = res.results.length ? Number(res.results[0].score || 0) : 0;
  const topPct = res.results.length ? Number(res.results[0].matchPct || 0) : 0;
  const isMiss = res.matched === 0 || (MISS_SCORE !== null && topScore < MISS_SCORE);
  if (isMiss) {
    if (WRITE_ENABLED) {
      payload.contribute = {
        kind: "miss",
        message:
          "库里没有直接对得上的经验——这恰恰是库最缺的东西。如果你刚把这个问题解决了，" +
          "可以用 submit_recipe 记一条（写清试过什么、为什么失败、最后成了什么），" +
          "它会进隔离池等人复核：一个人的坑写一次，后面所有人都绕得开。",
        suggested_tool: "submit_recipe",
      };
    }
    const rec = recordGap({
      ts: new Date().toISOString(),
      query_hash: hashQuery(query),
      query_len: String(query || "").length,
      matched: res.matched,
      top_match_pct: topPct,
      top_score: topScore,
      tags: tags || [],
      ...(GAP_LOG_RAW ? { query_sample: scrubForGap(query) } : {}),
    });
    payload.gap = {
      recorded: rec.recorded,
      reason: rec.reason || null,
      query_hash: hashQuery(query),
    };
  }
  return textResult(payload);
}

function toolGetRecipe(args) {
  const data = loadData();
  if (data.error) {
    return textResult({ error: "data_source_unavailable", detail: data.error }, true);
  }
  const id = requireString(args, "id");
  const found = data.recipes.find((r) => r.id === id);
  if (!found) return textResult({ error: "not_found", id, book: BOOK_ID, hint: HINT_NOT_FOUND });
  // BL-022：单条也带租户标识（同 id 在不同库里可能是两条完全不同的配方）
  return textResult({ ...found, book: BOOK_ID });
}

function toolListTags() {
  const data = loadData();
  if (data.error) {
    return textResult({ error: "data_source_unavailable", detail: data.error }, true);
  }
  const list = publishedList(data);
  const groups = GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    count: list.filter(g.match).length,
  })).filter((g) => g.key !== "all" || g.count > 0);

  return textResult({
    total: list.length,
    groups,
    tags: listTags(data.recipes),
    hint: "用 search_recipes(query, tags?) 做关键词检索；tags 为 AND 语义，取值见上面的 tags 列表。",
  });
}

function toolListQuarantine(args) {
  const data = loadData();
  if (data.error) {
    return textResult({ error: "data_source_unavailable", detail: data.error }, true);
  }
  const query = args?.query ? String(args.query).trim() : "";
  const quarantine = data.recipes.filter((r) => confidenceOf(r) === "C");
  if (!query) {
    // 审计视图：列出全部 C 级隔离项（供人工复核，AC-3）
    return textResult({
      total: quarantine.length,
      hint:
        "以上是 C 级（缓刑/存疑）隔离经验，默认不进 search_recipes 主检索。" +
        "传 query 可按匹配度给它们排序；亦可经 search_recipes(include_quarantine=true) 在检索时一并查看。",
      items: quarantine.map((r) => ({ id: r.id, title: r.title, tags: r.tags || [] })),
    });
  }
  // 带 query：用共享内核给 C 级打分并排序（与 search_recipes 同源）
  const res = searchRecipes(quarantine, query, { includeQuarantine: true });
  return textResult({
    query,
    total: res.matched,
    items: res.results.map(({ recipe, matchPct, suspect }) => ({
      id: recipe.id,
      title: recipe.title,
      tags: recipe.tags || [],
      matchPct,
      suspect,
    })),
  });
}

/* BL-014：引用校验闸门——把 lib/verifyCitations 接到运行时，让调用方能复核编造引用 */
function toolVerifyCitations(args) {
  const answer = requireString(args, "answer");
  const allowedIds = Array.isArray(args.allowedIds) ? args.allowedIds : [];
  const res = verifyCitations(answer, allowedIds);
  return textResult({
    ok: res.ok,
    cited: res.cited,
    badIds: res.badIds,
    hint: res.ok
      ? "引用均落在白名单内。"
      : "以下引用不在允许集合内，疑似编造，请重试或降级到原文：" + res.badIds.join(", "),
  });
}

/* ---------------- 写侧工具实现 ---------------- */
function toolSubmitRecipe(args) {
  /* 错误分两类，刻意不分在一起：
     -32602 = 「调用方式错了」（tags 传成了字符串），修法是改调用；
     业务失败 errors[] = 「内容不完整」（缺字段/撞 id/命中脱敏），修法是补齐重试。
     混成一类，Agent 就无法判断该重试还是该改调用。
     这里只卡类型，内容层面的校验一律交给 api/ingest.py。 */
  const payload = {};
  for (const k of ["title", "model", "problem", "solution"]) {
    if (args[k] === undefined) continue;
    if (typeof args[k] !== "string") {
      throw new RpcError(-32602, `参数 ${k} 必须是字符串`);
    }
    // 空串 / 纯空白不是「调用方式错了」，是「内容还没写」——
    // 归到 -32602 会让 Agent 以为改参数就能好，实际上得改内容。交回内核报业务失败。
    payload[k] = args[k];
  }
  if (args.dead_ends !== undefined && !Array.isArray(args.dead_ends)) {
    throw new RpcError(
      -32602,
      "参数 dead_ends 必须是数组，每条含 attempt / failure / duration / early_signal 四段"
    );
  } else {
    payload.dead_ends = args.dead_ends;
  }
  if (args.tags !== undefined && !Array.isArray(args.tags)) {
    throw new RpcError(-32602, '参数 tags 必须是字符串数组，例如 ["encoding", "scrapy"]');
  } else {
    payload.tags = args.tags;
  }
  for (const k of ["id", "contributor"]) {
    if (args[k] !== undefined && typeof args[k] !== "string") {
      throw new RpcError(-32602, `参数 ${k} 必须是字符串`);
    }
    payload[k] = args[k];
  }

  const res = runIngest(["submit", "-"], payload);
  return res.ok ? textResult(res) : businessFailure(res);
}

function toolPromoteRecipe(args) {
  const id = requireString(args, "id");
  const confidence = requireString(args, "confidence").toUpperCase();
  const confirm = args.confirm_downgrade === true;
  const argv = ["promote", id, confidence];
  if (confirm) argv.push("--confirm-downgrade");
  const res = runIngest(argv);
  if (res.confirm_required) return textResult(res); // BL-017：降档需二次确认，非错误
  return res.ok ? textResult(res) : businessFailure(res);
}

/* ---------------- 工具注册 ---------------- */
/* 先落一份数据用于推导 offset 上限。loadData 带缓存，后面工具调用不会重复读盘。
   数据源不可达时 recipes=[]，maxOffsetOf 退回下限，不影响报错路径。 */
const bootData = loadData();
const LIVE_MAX_OFFSET = maxOffsetOf(bootData.recipes);

const READ_TOOLS = [
  {
    name: "search_recipes",
    buildDescription() {
      const data = loadData();
      const tagNames = listTags(data.recipes)
        .map((t) => t.tag)
        .join(", ");
      return (
        "在「解题配方库」中检索别人踩过的坑。每条配方含：真实问题、结构化死胡同" +
        "（试过什么 / 结果如何 / 卡了多久 / 本可提前避开的信号）、最终解法与复盘。" +
        "何时用：用户遇到网页采集、编码乱码、反爬、分页、会话丢失、无头浏览器、" +
        "网站工程或工具链问题，想先看别人的经验与死胡同时。" +
        "query 用自然语言即可（中文会按 2 字组合切分，无需空格，如「抓回来是乱码」）。" +
        (tagNames ? ` tags 可传的值：${tagNames}。` : "")
      );
    },
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "用户卡住的现象，自然语言或关键词，如「抓回来是乱码」「爬虫被封 IP」",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "可选，按标签收窄（AND 语义）。取值见 list_tags 返回的 tags",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `返回条数，默认 ${DEFAULT_LIMIT}，上限 ${MAX_LIMIT}。matched 字段会给出命中总数`,
        },
        offset: {
          type: "integer",
          minimum: 0,
          maximum: LIVE_MAX_OFFSET,
          description:
            `翻页偏移：从第几条开始返回（默认 0）。配合 limit 看「第 6 条往后」的结果。` +
            `返回体 has_more=true 表示后面还有，应继续翻页或调大 limit 再查，才可下「库里没有」结论。`,
        },
        include_quarantine: {
          type: "boolean",
          description:
            "默认 false：C 级（缓刑/存疑）经验不进主检索。" +
            "设 true 时主结果包含全部 C 级（均标 suspect:true），供人工复核/审计（R-10 AC-3）。" +
            "注意：阈值(放行松紧)由服务端控制，不在此暴露。",
        },
        verify: {
          type: "boolean",
          description:
            "默认 false。设 true 时返回附带 citable_ids（本次结果的可引用白名单），" +
            "供你组织答案后用 verify_citations 工具复核 [recipe-xxx] 引用是否编造。",
        },
      },
      required: ["query"],
    },
    run: toolSearchRecipes,
  },
  {
    name: "get_recipe",
    description:
      "按 id 取一条配方的完整内容（含全部死胡同与复盘）。" +
      "何时用：search_recipes 已给出候选 id，需要看某一条的完整细节时。" +
      '不存在时返回 {"error":"not_found"} 而不报错，请按 error 字段判断。',
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "配方 id，如 recipe-py-encoding-mojibake" },
      },
      required: ["id"],
    },
    run: toolGetRecipe,
  },
  {
    name: "list_tags",
    description:
      "列出库内全部标签（含出现次数）与领域分类（采集 / 网站工程 / 工具链）。" +
      "何时用：不确定该用什么关键词或标签时，先看这张目录；也可用于向用户介绍本库覆盖范围。" +
      "本工具不接收参数。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => toolListTags(),
  },
  {
    name: "list_quarantine",
    description:
      "列出全部 C 级（缓刑/存疑）隔离经验，供人工复核与审计（R-10 AC-3）。" +
      "默认不接收参数，返回隔离项清单；可传 query 让其按匹配度排序，便于判断「这条存疑经验是否与当前问题相关」。" +
      "本工具只读，不暴露任何写入/放行操作——放行决策由人工在库侧完成。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "可选，给隔离项按匹配度排序的查询词" },
      },
      additionalProperties: false,
    },
    run: toolListQuarantine,
  },
  {
    name: "verify_citations",
    description:
      "校验回答中的 [recipe-xxx] 引用是否全部落在允许的 id 集合内（PRD《防编造护栏》）。" +
      "何时用：你组织完答案准备引用若干配方时，把回答文本与本次检索返回的 citable_ids 传入，" +
      "确认没有凭空捏造的引用。返回 ok=false 时 badIds 列出越界引用，应重试或降级到原文。",
    inputSchema: {
      type: "object",
      properties: {
        answer: {
          type: "string",
          description: "Agent 的回答文本，其中 [recipe-xxx] 形式的引用会被校验",
        },
        allowedIds: {
          type: "array",
          items: { type: "string" },
          description: "允许引用的 id 白名单，来自 search_recipes(verify=true) 返回的 citable_ids",
        },
      },
      required: ["answer"],
    },
    run: toolVerifyCitations,
  },
  {
    name: "gap_report",
    description:
      "列出「有人问过、但库里没有」的查询缺口，按被问次数排序，用来决定下一批该写哪些配方。" +
      "数据来自本机 api/gaps.jsonl（与库同根，不上传）。默认只存 hash 与分数，不含查询原文。",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, description: "返回条数，默认 10" },
      },
    },
    run: toolGapReport,
  },
];

/* 写侧工具。只在 RECIPE_BOOK_WRITE=1 时挂进 tools/list——默认不给。
   两个工具分工：submit_recipe 管「进得来」，promote_recipe 管「出得去」。
   缺了 promote，隔离区就是只进不出的死箱子；缺了 submit，投稿还得人手写 JSON。
   都不提供编辑与删除：内容一旦进库只能人工改文件（archive-not-delete 的保洁原则）。 */
const WRITE_TOOLS = [
  {
    name: "submit_recipe",
    description:
      "把一条踩坑经验提交进库。何时用：你和用户在对话里刚解决完一个真问题，" +
      "想把这段经验存成配方，而不想让用户学 JSON、开终端。\n" +
      "内容必须原样来自真实经历：脚本只做格式转换与体检，不会替你补内容、不会润色。" +
      "缺哪个字段会逐条点名，你补齐后重试即可。\n" +
      "提交后这条进隔离池（C 级，暂不进主检索），等人复核放行；" +
      "成功回执里会写明下一步该做什么。\n" +
      "status / confidence / verified 由服务端与人锁死，传了会被拒（A 档要的 verified " +
      "只能由人复核后手写）。",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "一句话说清解决什么。英文标题会自动推导 id；" +
            "中文占一半以上的标题必须显式传 id（否则会推出 id / ip 这类猜不出含义的主键）",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "标签数组，取值见 list_tags 的返回。至少 1 个",
        },
        model: { type: "string", description: "当时用的模型或工具，如 Claude Sonnet 4.5" },
        problem: { type: "string", description: "具体卡在哪，卡点的原始现象" },
        solution: { type: "string", description: "最后怎么破的，可含可复现的操作步骤" },
        dead_ends: {
          type: "array",
          description:
            "走过的死胡同，每条四段齐全：attempt(试过什么) / failure(结果如何) " +
            "/ duration(卡了多久) / early_signal(本可提前避开的信号)",
        },
        id: {
          type: "string",
          description:
            "可选。库内唯一主键，小写英文短横线，如 recipe-sqlite-wal。" +
            "不传时按标题推导；标题是纯中文则必须传。撞 id 会被拒绝，原内容不动",
        },
        contributor: {
          type: "string",
          description: "可选。贡献者句柄，服务端转成不可反查的匿名哈希，同一句柄始终同一标识",
        },
      },
      required: ["title", "tags", "model", "problem", "solution", "dead_ends"],
    },
    run: toolSubmitRecipe,
  },
  {
    name: "promote_recipe",
    description:
      "人工复核后的放行动作：把一条隔离稿升到 B 级（可信）或 A 级（有实测证据），" +
      "或驳回回隔离区。何时用：你已看过隔离池里的某条内容，判断它值不值得留。\n" +
      "B 门槛：格式合规 + 死胡同四段齐全 + 脱敏复检通过。\n" +
      "A 门槛：B 的基础上还要 verified 显式为 true —— 它是「有人真跑过一遍、结论可复现」" +
      "的标记，投稿侧带不进来，只能由人确认后亲手写在 frontmatter 里。\n" +
      "禁止跳级：C 不能直接升 A，须先在 B 停一次。\n" +
      "本工具只改分级与状态，不碰内容一字——判断内容真伪是人的活儿。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "要晋升的配方 id" },
        confidence: {
          type: "string",
          enum: ["A", "B", "C"],
          description: "A=完全信任（需实测证据）/ B=可信 / C=驳回回隔离区",
        },
        confirm_downgrade: {
          type: "boolean",
          description:
            "降档二次确认（BL-017）：当目标分级低于当前（如 A→B、A→C、B→C）时，" +
            "必须显式传 true 才会执行，否则返回 confirm_required 让你确认。" +
            "升档（C→B→A）不需要。",
        },
      },
      required: ["id", "confidence"],
    },
    run: toolPromoteRecipe,
  },
];

const TOOLS = WRITE_ENABLED ? READ_TOOLS.concat(WRITE_TOOLS) : READ_TOOLS;

/* ---------------- 经验向导「培训手册」（R-3 / R-4：自动上岗） ----------------
   单一来源：本常量即「样板员工」的培训手册，同时也是 AGENT_PROMPT.md 的兜底文本。
   接入方 Agent 一连上即可 prompts/get 取到，自动加载为自身指令 → 上岗。
   角色层（怎么回答）在此；工具层（怎么调）在上面的工具 description。两层缺一不可。 */
const GUIDE_MANUAL = `你是「解题配方库」的**经验向导**，专门帮遇到技术卡点的同学，从别人真实踩过的坑里找出破局法与避坑提醒。

# 你的工作流程
1. 用户描述一个卡点（如「爬虫被反爬封了 IP」「抓回来是乱码」），**先调用 search_recipes(query, tags?) 检索**库内经验。
2. 拿到候选后，再决定是否调 get_recipe(id) 展开某一条完整细节。
3. 用大白话把候选里相关的经验组织成回答。
4. **翻页防卡死**：返回体带 has_more 与 matched。若 Top 结果没解决用户问题，且 has_more=true（或 matched 明显大于本次 returned 条数），**先用 offset 翻页或调大 limit 再看后续结果，然后才可考虑「换说法重查」**；只有翻完且换说法都无相关，才如实告诉用户「库里没有这条经验」。绝不能只看了前几条就说「库里没有」——答案可能排在第 6 条之后。

# 硬约束（违反任一条都算失败）
- C-1 只引用：每条结论都必须来自检索返回的候选配方内容，**不得引入任何候选之外的信息**。
- C-2 带编号：每条结论后必须标注来源 [配方id]，例如 [recipe-py-encoding-mojibake]。
- C-3 不补充：严禁用你自身的知识补充候选之外的任何建议、代码或判断。
- C-4 不猜测：候选不足以回答时，明确说「库内没有直接匹配的经验」，并建议换更具体的说法或查 list_tags，**不猜**。
- C-5 给死胡同：回答中必须至少包含 1 条「死胡同提醒」（某条配方的 dead_ends：试过什么 / 结果如何 / 卡了多久），帮用户少走弯路。
- C-6 附声明：回答末尾固定附加一句：「以上为库内经验，非官方认定；以你自己的真实场景为准」。
- C-7 要投稿：帮用户解决完卡点后**必须主动提议**用 submit_recipe 把这条经验记进库（尤其是检索未命中、靠推理解决的情况）；用户同意后再提交。理由：库里每一条都是这么攒出来的，不提议 = 下一个人还得重新踩一遍。

# 降级（必须做到）
- 检索返回空、而你随后把问题解决了：除 C-4 外还要按 **C-7** 主动提议投稿（返回体里的 contribute 字段就是给你的信号）。
- 检索返回空：走 C-4 话术，**不编造**，直接如实告知用户库里没有。
- 检索有结果但都很弱：也只允许引用这些弱结果，不得自行发挥，并说明「匹配度不高，仅供参考」。

# 为什么这样做
库的价值在于「别人真的踩过什么坑」。一旦你用自身知识补答案，这份诚实就破了——用户会把你的编造当成真实经验。所以：**检索结果里没有的，一律不说。**`;

const PROMPTS = [
  {
    name: "experience-guide",
    description:
      "将你的 Agent 培训成「解题配方库」经验向导：只引用库内检索结果、每条结论带配方 id、" +
      "查不到就如实说没有、绝不编造。挂载本 MCP 后调用 prompts/get 即可自动上岗，" +
      "效果与项目演示的样板 Agent 一致（数据同源、规矩同款）。",
    args: [
      {
        name: "question",
        description:
          "用户当前的卡点描述（自然语言）。填了会作为待回答的问题注入模板；不填则只返回通用手册。",
        required: false,
      },
    ],
    getMessages(question) {
      const body =
        question && String(question).trim()
          ? `${GUIDE_MANUAL}\n\n# 用户当前的问题\n${String(question).trim()}`
          : GUIDE_MANUAL;
      return [{ role: "user", content: { type: "text", text: body } }];
    },
  },
];

/* ---------------- 方法分发 ---------------- */
function handleInitialize(id, params) {
  const requested = params?.protocolVersion;
  const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : PROTOCOL_FALLBACK;
  replyOk(id, {
    protocolVersion,
    capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions:
      /* BL-022：先把「我连的是哪个库」讲清楚。此前三个入口共用这份 server.js 却不声明身份，
         Agent 靠名字猜，实测把通用主库误判成 LifeLens 专用库，于是压根没查也没写。 */
      `解题配方库（当前库：${BOOK_ID}；${BOOK_NOTE}；` +
      (WRITE_ENABLED ? "写侧已开启" : "只读模式") +
      "）。两条规矩：① 遇到网页采集、编码乱码、反爬、限流、分页、无头浏览器、" +
      "网站工程、工具链、评测方法论这类卡点，**动手前先用 search_recipes 查一次**——" +
      "别人踩过的坑比从头试更省事；② 查不到、而你随后把问题解决了，" +
      "回来用 submit_recipe 把这条坑记进库，让下一个人不必再踩一遍" +
      (WRITE_ENABLED
        ? ""
        : "（当前连接是只读的：投稿需先开启 RECIPE_BOOK_WRITE=1 并重启会话）") +
      "。完整行为手册可调 prompts/get（name='experience-guide'）取回。" +
      "无命中时如实告诉用户「库里没有」，不要用你自己的知识补答案——" +
      "本库的价值在于「别人真的踩过什么坑」，编造会毁掉它。引用时请带上配方 id，便于用户核对。" +
      (WRITE_ENABLED
        ? " 写入仅限已开启写入的那位用户：submit_recipe 提交后进隔离池等人复核，人点头才公开。" +
          " 检索未命中时返回体带 contribute 字段——那说明库里缺这一页，请转告用户可以把这次的坑记下来。"
        : ""),
  });
}

function handleToolsCall(id, params) {
  const name = params?.name;
  if (typeof name !== "string") throw new RpcError(-32602, "params.name 必须是字符串");
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new RpcError(-32602, `未知工具：${name}`);
  const args = params?.arguments ?? {};
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new RpcError(-32602, "params.arguments 必须是对象");
  }
  replyOk(id, tool.run(args));
}

function handleToolsList(id) {
  replyOk(id, {
    tools: TOOLS.map((t) => ({
      name: t.name,
      /* BL-022：每个工具描述末尾统一带上租户标识。此前三个入口共用这份 server.js
         却不声明身份，Agent 只能靠名字猜，实测把通用主库误认成 LifeLens 专用库。 */
      description:
        (typeof t.buildDescription === "function" ? t.buildDescription() : t.description) +
        BOOK_TAG,
      inputSchema: t.inputSchema,
    })),
  });
}

function handlePromptsList(id) {
  replyOk(id, {
    prompts: PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.args.map((a) => ({
        name: a.name,
        description: a.description,
        required: !!a.required,
      })),
    })),
  });
}

function handlePromptsGet(id, params) {
  const name = params?.name;
  if (typeof name !== "string") throw new RpcError(-32602, "params.name 必须是字符串");
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) throw new RpcError(-32602, `未知 prompt：${name}`);
  const args = params?.arguments ?? {};
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new RpcError(-32602, "params.arguments 必须是对象");
  }
  for (const a of prompt.args) {
    if (a.required && (typeof args[a.name] !== "string" || !args[a.name].trim())) {
      throw new RpcError(-32602, `prompt ${name} 缺少必填参数：${a.name}`);
    }
  }
  replyOk(id, { description: prompt.description, messages: prompt.getMessages(args.question) });
}

function dispatch(msg) {
  const id = msg?.id;
  const isNotification = id === undefined || id === null;
  const method = msg?.method;

  try {
    switch (method) {
      case "initialize":
        if (!isNotification) handleInitialize(id, msg.params);
        return;
      case "notifications/initialized":
      case "notifications/cancelled":
        return; // 通知无需回复
      case "ping":
        if (!isNotification) replyOk(id, {});
        return;
      case "tools/list":
        if (!isNotification) handleToolsList(id);
        return;
      case "tools/call":
        if (!isNotification) handleToolsCall(id, msg.params);
        return;
      case "prompts/list":
        if (!isNotification) handlePromptsList(id);
        return;
      case "prompts/get":
        if (!isNotification) handlePromptsGet(id, msg.params);
        return;
      default:
        if (!isNotification) replyErr(id, -32601, `未实现的方法：${method}`);
    }
  } catch (e) {
    if (e instanceof RpcError) {
      if (!isNotification) replyErr(id, e.code, e.message, e.data);
      return;
    }
    logErr("内部错误：" + (e && e.stack ? e.stack : e));
    if (!isNotification) replyErr(id, -32603, "服务内部错误：" + (e?.message || String(e)));
  }
}

/* ---------------- 启动 ---------------- */
function main() {
  const pre = loadData();
  if (pre.error)
    logErr("⚠️ 启动时数据源不可用，工具调用会返回 data_source_unavailable（不返回空结果）");

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const s = line.trim();
    if (!s) return;
    let msg;
    try {
      msg = JSON.parse(s);
    } catch (e) {
      replyErr(null, -32700, "解析 JSON 失败：" + e.message);
      return;
    }
    dispatch(msg);
  });
  rl.on("close", () => process.exit(0));
  logErr(
    WRITE_ENABLED
      ? `就绪：${TOOLS.length} 个工具（${TOOLS.map((t) => t.name).join(" / ")}）— 写入已开启（RECIPE_BOOK_WRITE=1）`
      : `就绪：只读模式，${TOOLS.length} 个工具（${TOOLS.map((t) => t.name).join(" / ")}）`
  );
  if (WRITE_ENABLED) logErr("⚠️ 写工具已挂载：调用方可直接往库里落新配方，落盘即隔离，等人复核。");
}

main();
