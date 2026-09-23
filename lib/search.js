/* ============================================================
   解题配方库 · 共享检索内核（零依赖 ES Module）
   ------------------------------------------------------------
   单一实现，三处共用（改一处即三处生效）：
     1. 网站         assets/app.js
     2. MCP Server   mcp/server.js
     3. 演示 Agent   agent/guide.js
   规格与验收标准：PRD v1.2 §6 / §11.1。

   ⚠️ 改动本文件后必须先跑：node tests/search-baseline.js
   ============================================================ */

/* ---------- 领域同义词表：口语词 → 库内真实 tag ----------
   为什么需要它：库里写「反爬 / 403」，用户说「被封」，字面零交集。
   本表是命中率从 3/4 提升到 4/4 的关键（PRD §6.3 缺陷 A）。
   新增 tag 时同步在此登记口语说法，否则该类查询会静默 0 命中。 */
export const TAG_HINTS = {
  encoding: ["编码", "乱码", "charset", "gbk", "utf8", "mojibake"],
  "anti-bot": ["反爬", "风控", "被封", "403", "拦截", "指纹"],
  timing: ["超时", "重定向", "tls", "握手", "很慢"],
  session: ["会话", "cookie", "登录", "302", "跳转"],
  headless: ["无头", "浏览器", "动态渲染", "javascript"],
  selector: ["选择器", "表格", "合并单元格", "解析", "结构"],
  pagination: ["翻页", "分页", "页码", "页数"],
  "rate-limit": ["限流", "频率", "太快", "429", "请求过多"],
  "auth-wall": ["登录墙", "鉴权", "权限", "需要登录"],
  scrape: ["抓取", "采集", "爬虫", "下载"],
  "shadow-dom": ["影子", "web component", "组件"],
};

/* ---------- 打分权重（改这些数字等于改排序质量，务必重跑回归） ---------- */
export const WEIGHT_TITLE = 2;   // 命中标题额外加 2（与正文命中 1 合计 3）
export const WEIGHT_SYN_TAG = 3; // 命中「同义词扩展出来的 tag」
export const META_WEIGHT = 0.35; // 元配方降权系数（PRD §6.3 缺陷 B）

/* ---------- 领域分类：按 id 前缀划分 ---------- */
export const GROUPS = [
  { key: "all", label: "全部", match: () => true },
  { key: "collect", label: "采集", match: (r) => /^recipe-py-/.test(idOf(r)) },
  { key: "web", label: "网站工程", match: (r) => /^recipe-web-/.test(idOf(r)) },
  // 兜底：既不是采集(Python)也不是网站工程的，一律归工具链/基础设施
  { key: "infra", label: "工具链", match: (r) => !/^recipe-(py|web)-/.test(idOf(r)) },
];

/* 元配方：记录「建设本库自身」时踩的坑，面向用户的检索里要降权。
   recipe.meta 可显式覆盖（true 强制视为元配方 / false 强制不视为）。 */
const META_ID_PREFIX = /^recipe-web-/;

const PUBLISHED = "published";
const SPLIT_RE = /[\s,，、。;；:：!！?？/|（）()\[\]"'“”]+/;
const CJK_RE = /[\u4e00-\u9fa5]/;

/* 单字符不足以定位（实测输入 "a" 曾命中 35/37 条，见 PRD §6.3 缺陷 C） */
export const MIN_TOKEN_LEN = 2;

export const HINT_NO_MATCH = "库里没有直接匹配的经验，可换用更具体的词。";
export const HINT_TOO_SHORT =
  "查询词太短：至少需要 2 个字符，或一个完整的中文词 / 英文单词。";

function idOf(recipe) {
  return String((recipe && recipe.id) || "");
}

/* ---------- 切词：中文 2-gram + 英文数字按词 ----------
   解决「中文没有空格，整串匹配必然 0 结果」（PRD §6.3 背景）。
   注意：这里统一转小写 —— 因为 hayOf() 输出的可搜索文本是小写的，
   若不转小写，MCP 传来的「爬虫被封 IP 了」里的大写 IP 会被静默浪费。 */
export function tokenize(query) {
  const out = new Set();
  const q = String(query == null ? "" : query).toLowerCase();
  for (const seg of q.split(SPLIT_RE)) {
    if (!seg) continue;
    out.add(seg);
    if (CJK_RE.test(seg)) {
      for (let i = 0; i + 2 <= seg.length; i++) out.add(seg.slice(i, i + 2));
    }
  }
  return [...out].filter((t) => t.length >= MIN_TOKEN_LEN);
}

/* ---------- 口语词 → 真实 tag 的扩展 ---------- */
export function synonymsFor(query) {
  const ql = String(query == null ? "" : query).toLowerCase();
  if (!ql) return [];
  const hits = [];
  for (const tag of Object.keys(TAG_HINTS)) {
    if (TAG_HINTS[tag].some((h) => ql.includes(h.toLowerCase()))) hits.push(tag);
  }
  return hits;
}

export function isMetaRecipe(recipe) {
  if (!recipe) return false;
  if (recipe.meta === true) return true;
  if (recipe.meta === false) return false;
  return META_ID_PREFIX.test(idOf(recipe));
}

/* ---------- 可搜索文本（结果缓存，避免重复拼接） ---------- */
const HAY_CACHE = new WeakMap();

function buildHay(r) {
  if (!r) return "";
  const deadStr = (r.dead_ends || [])
    .map((d) => `${d.attempt || ""} ${d.failure || ""} ${d.early_signal || ""}`)
    .join(" ");
  return [r.title, r.problem, (r.tags || []).join(" "), deadStr, r.solution]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function hayOf(recipe) {
  if (recipe && typeof recipe === "object") {
    const cached = HAY_CACHE.get(recipe);
    if (cached !== undefined) return cached;
    const hay = buildHay(recipe);
    HAY_CACHE.set(recipe, hay);
    return hay;
  }
  return buildHay(recipe);
}

/* ---------- 单条打分 ---------- */
export function scoreRecipe(recipe, terms, synTags = []) {
  if (!recipe || !terms || !terms.length) return 0;
  const hay = hayOf(recipe);
  const title = String(recipe.title || "").toLowerCase();
  let n = 0;
  for (const t of terms) {
    if (hay.includes(t)) n += 1;
    if (title.includes(t)) n += WEIGHT_TITLE;
  }
  const tags = recipe.tags || [];
  for (const tg of synTags) if (tags.includes(tg)) n += WEIGHT_SYN_TAG;
  if (isMetaRecipe(recipe)) n *= META_WEIGHT;
  return n;
}

/* ---------- 主入口 ----------
   searchRecipes(recipes, query, opts) -> {
     query, terms, synTags, matched, results: [{ score, recipe }], hint
   }
   - query 为空字符串 → 不做关键词过滤，仅应用 tags/predicate（结果保序，score 恒为 0）
   - query 非空但切不出有效词 → matched=0 + HINT_TOO_SHORT（不返回全库）
   - 无命中 → matched=0 + HINT_NO_MATCH
   - 结果按 score 降序；score 相同时保持入参顺序（Array.sort 稳定） */
export function searchRecipes(recipes, query, options = {}) {
  const {
    tags = [],
    limit = Infinity,
    predicate = null,
    includeUnpublished = false,
  } = options;

  const rawQuery = String(query == null ? "" : query).trim();

  /* 1) 先按治理状态 / 去重 / 领域 / 标签过滤出候选池 */
  const pool = [];
  const seen = new Set();
  for (const r of recipes || []) {
    if (!r) continue;
    const id = idOf(r);
    if (!id) continue;
    if (!includeUnpublished && r.status !== PUBLISHED) continue;
    if (seen.has(id)) continue;
    if (predicate && !predicate(r)) continue;
    if (tags.length && !tags.every((t) => (r.tags || []).includes(t))) continue;
    seen.add(id);
    pool.push(r);
  }

  /* 2) 切词 */
  const terms = tokenize(rawQuery);
  if (!terms.length) {
    if (rawQuery === "") {
      return {
        query: rawQuery, terms: [], synTags: [], matched: pool.length,
        results: pool.slice(0, limit).map((recipe) => ({ score: 0, recipe })),
        hint: null,
      };
    }
    return {
      query: rawQuery, terms: [], synTags: [], matched: 0, results: [],
      hint: HINT_TOO_SHORT,
    };
  }

  /* 3) 打分 + 排序 */
  const synTags = synonymsFor(rawQuery);
  const scored = [];
  for (const r of pool) {
    const score = scoreRecipe(r, terms, synTags);
    if (score > 0) scored.push({ score, recipe: r });
  }
  scored.sort((a, b) => b.score - a.score);

  return {
    query: rawQuery,
    terms,
    synTags,
    matched: scored.length,
    results: scored.slice(0, limit),
    hint: scored.length ? null : HINT_NO_MATCH,
  };
}

/* ---------- 标签清单（MCP 的 list_tags / 网站的分类条共用） ---------- */
export function listTags(recipes, options = {}) {
  const { includeUnpublished = false } = options;
  const freq = new Map();
  for (const r of recipes || []) {
    if (!r) continue;
    if (!includeUnpublished && r.status !== PUBLISHED) continue;
    for (const t of r.tags || []) freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
