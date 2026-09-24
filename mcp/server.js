#!/usr/bin/env node
/* ============================================================
   解题配方库 · 只读 MCP Server（stdio）
   ------------------------------------------------------------
   规格：PRD 增量 v1.2 §7（只读 MCP）+ §8（经验向导自动上岗：prompts）
   传输：stdio，newline-delimited JSON-RPC 2.0（不是 Content-Length 分帧）
   依赖：零第三方依赖（Node 标准库）；检索走 lib/search.js 共享内核
   权限：**只读** —— 不暴露任何写入 / 删除工具

   设计要点（为什么这里没有第二个 AI）：
     一个 MCP 工具就是一次**函数调用**，不是对话。对方 Agent 传参数、我们回数据。
     "理解用户要什么"发生在对方 Agent 的脑子里；我们只负责"给得准"。
     本进程不调用任何 LLM，因此**物理上不可能编造**内容——它只会搬运库里已有的条目。

   用法：
     node mcp/server.js                    # 从 stdin 读 JSON-RPC，向 stdout 写
     RECIPE_BOOK_PATH=/path/to.json node mcp/server.js
   ⚠️ stdout 只允许出现协议报文；一切日志走 stderr（否则会污染协议流）。
   ============================================================ */

import { readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { searchRecipes, listTags, GROUPS, confidenceOf } from "../lib/search.js";

/* ---------------- 常量 ---------------- */
const SERVER_INFO = { name: "agent-recipe-book", version: "1.0.0" };
const PROTOCOL_FALLBACK = "2024-11-05";
const SUPPORTED_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_OFFSET_FLOOR = MAX_LIMIT * 2; // 下限：库很小时也别把 offset 卡死
const MAX_OFFSET_HEADROOM = MAX_LIMIT;  // 在"正好翻完"之外再留一整页余量

/* offset 上限**不能**写死成"库当前几条"：那样库一涨，最后一页就翻不出来
   （40 条时正好卡在边界，涨到 42 条才开始有隐患，再涨就直接吞数据）。
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
  send({ jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } });
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
    throw new RpcError(-32602, "参数 tags 必须是字符串数组（如 [\"encoding\"]）");
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
    throw new RpcError(-32602, `参数 offset 必须是 0..${ceiling} 的整数（默认 0，用于翻页看后续结果）`);
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

  const res = searchRecipes(data.recipes, query, { tags, limit, offset, includeQuarantine });
  const payload = {
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
    })),
  };
  if (res.hint) payload.hint = res.hint;
  return textResult(payload);
}

function toolGetRecipe(args) {
  const data = loadData();
  if (data.error) {
    return textResult({ error: "data_source_unavailable", detail: data.error }, true);
  }
  const id = requireString(args, "id");
  const found = data.recipes.find((r) => r.id === id);
  if (!found) return textResult({ error: "not_found", id, hint: HINT_NOT_FOUND });
  return textResult(found);
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
      hint: "以上是 C 级（缓刑/存疑）隔离经验，默认不进 search_recipes 主检索。" +
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
      id: recipe.id, title: recipe.title, tags: recipe.tags || [], matchPct, suspect,
    })),
  });
}

/* ---------------- 工具注册 ---------------- */
/* 先落一份数据用于推导 offset 上限。loadData 带缓存，后面工具调用不会重复读盘。
   数据源不可达时 recipes=[]，maxOffsetOf 退回下限，不影响报错路径。 */
const bootData = loadData();
const LIVE_MAX_OFFSET = maxOffsetOf(bootData.recipes);

const TOOLS = [
  {
    name: "search_recipes",
    buildDescription() {
      const data = loadData();
      const tagNames = listTags(data.recipes).map((t) => t.tag).join(", ");
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
          description: `翻页偏移：从第几条开始返回（默认 0）。配合 limit 看「第 6 条往后」的结果。` +
            `返回体 has_more=true 表示后面还有，应继续翻页或调大 limit 再查，才可下「库里没有」结论。`,
        },
        include_quarantine: {
          type: "boolean",
          description: "默认 false：C 级（缓刑/存疑）经验不进主检索。" +
            "设 true 时主结果包含全部 C 级（均标 suspect:true），供人工复核/审计（R-10 AC-3）。" +
            "注意：阈值(放行松紧)由服务端控制，不在此暴露。",
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
      "不存在时返回 {\"error\":\"not_found\"} 而不报错，请按 error 字段判断。",
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
];

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

# 降级（必须做到）
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
        description: "用户当前的卡点描述（自然语言）。填了会作为待回答的问题注入模板；不填则只返回通用手册。",
        required: false,
      },
    ],
    getMessages(question) {
      const body = question && String(question).trim()
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
      "解题配方库（只读）。先用 search_recipes 检索；无命中时如实告诉用户「库里没有」，" +
      "不要用你自己的知识补答案——本库的价值在于「别人真的踩过什么坑」，编造会毁掉它。" +
      "引用时请带上配方 id，便于用户核对。",
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
      description: typeof t.buildDescription === "function" ? t.buildDescription() : t.description,
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
  if (pre.error) logErr("⚠️ 启动时数据源不可用，工具调用会返回 data_source_unavailable（不返回空结果）");

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
  logErr(`就绪：只读模式，${TOOLS.length} 个工具（${TOOLS.map((t) => t.name).join(" / ")}）`);
}

main();
