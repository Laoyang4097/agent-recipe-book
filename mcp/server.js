#!/usr/bin/env node
/* ============================================================
   解题配方库 · 只读 MCP Server（stdio）
   ------------------------------------------------------------
   规格：PRD 增量 v1.2 §7
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
import { searchRecipes, listTags, GROUPS } from "../lib/search.js";

/* ---------------- 常量 ---------------- */
const SERVER_INFO = { name: "agent-recipe-book", version: "1.0.0" };
const PROTOCOL_FALLBACK = "2024-11-05";
const SUPPORTED_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
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

/* ---------------- 工具实现 ---------------- */
function toolSearchRecipes(args) {
  const data = loadData();
  if (data.error) {
    return textResult({ error: "data_source_unavailable", detail: data.error }, true);
  }
  const query = requireString(args, "query");
  const tags = optionalTags(args);
  const limit = optionalLimit(args);

  const res = searchRecipes(data.recipes, query, { tags, limit });
  const payload = {
    matched: res.matched,
    // 透出切词与同义词扩展结果，让调用方能判断「为什么命中这些」而不是当黑盒
    terms: res.terms,
    synTags: res.synTags,
    results: res.results.map(({ score, recipe }) => ({
      id: recipe.id,
      title: recipe.title,
      tags: recipe.tags || [],
      score: Number(score.toFixed(2)),
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

/* ---------------- 工具注册 ---------------- */
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
];

/* ---------------- 方法分发 ---------------- */
function handleInitialize(id, params) {
  const requested = params?.protocolVersion;
  const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : PROTOCOL_FALLBACK;
  replyOk(id, {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
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
