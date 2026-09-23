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

/* ---------- 领域分类：按 id 前缀划分 ----------
   扩一个新垂直时，这里加一行，并把它从下面的「兜底」正则里排除。
   除此之外不需要改任何代码 —— 见 recipe.schema.md §1.1 的试收说明。 */
export const GROUPS = [
  { key: "all", label: "全部", match: () => true },
  { key: "collect", label: "采集", match: (r) => /^recipe-py-/.test(idOf(r)) },
  { key: "web", label: "网站工程", match: (r) => /^recipe-web-/.test(idOf(r)) },
  // 第二垂直（试收）：用 AI 做项目判断
  { key: "project", label: "项目判断", match: (r) => /^recipe-pj-/.test(idOf(r)) },
  // 兜底：既不是采集 / 网站工程 / 项目判断的，一律归工具链 / 基础设施
  { key: "infra", label: "工具链", match: (r) => !/^recipe-(py|web|pj)-/.test(idOf(r)) },
];

/* 元配方：记录「建设本库自身」时踩的坑，面向用户的检索里要降权。
   recipe.meta 可显式覆盖（true 强制视为元配方 / false 强制不视为）。 */
const META_ID_PREFIX = /^recipe-web-/;

const PUBLISHED = "published";
const SPLIT_RE = /[\s,，、。;；:：!！?？/|（）()\[\]"'“”]+/;
const CJK_RE = /[\u4e00-\u9fa5]/;

/* 单字符不足以定位（实测输入 "a" 曾命中 35/37 条，见 PRD §6.3 缺陷 C） */
export const MIN_TOKEN_LEN = 2;

/* ---------- 停用词：中文功能词 / 疑问词，一律不参与打分 ----------
   为什么需要：中文按 2-gram 切分会把「为什么」切成 为什/什么，
   而「什么」会命中正文里恰好写过「什么问题 / 为什么在」的配方 ——
   结果是「为什么我的猫不吃饭」返回「粒子背景是设计债」这类风马牛不相及的条目。
   只收高置信度虚词；**不要**把可能携带语义的动词收进来（如「没有 / 出现 / 失败」）。 */
export const STOPWORDS = new Set([
  // 疑问
  "为什么", "为什", "什么", "怎么", "咋办", "怎样", "如何", "哪里", "哪儿",
  "哪个", "哪些", "是否", "为嘛",
  // 人称 / 指示 / 量词
  "我的", "我们", "你们", "他们", "它们", "咱们",
  "这个", "那个", "这些", "那些", "一个", "一下", "一些", "一直", "总是", "老是",
  // 泛化连接 / 情态
  "的话", "然后", "但是", "因为", "所以", "如果", "或者", "而且", "并且",
  "可是", "不过", "可以", "能够", "需要", "应该", "可能",
  // 客套
  "帮我", "请问", "你好", "谢谢", "麻烦",
]);

/* 纯 ASCII 词（英文/数字）必须命中在**词首边界**：
   否则 "ip" 会命中 "gzip" 内部（实测 19 处），单一个 "ip" 就带来 10 条假命中。
   仍允许前缀匹配（"encode" 可命中 "encoding"），只是不允许从词中间开始。 */
const ASCII_TERM_RE = /^[a-z0-9]+$/;
const WORD_CHAR_RE = /[a-z0-9]/;

export const HINT_NO_MATCH = "库里没有直接匹配的经验，可换用更具体的词。";
export const HINT_TOO_SHORT =
  "查询词太短：至少需要 2 个字符，或一个完整的中文词 / 英文单词。";
export const HINT_NO_KEYWORD =
  "这句话里没有可检索的关键词（都是疑问词/虚词）。请描述具体现象，如「乱码」「翻页」「被封」。";

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

/* ---------- 命中判定 ----------
   中文：直接子串匹配（无空格，子串是唯一可行做法）。
   英文/数字：必须落在词首边界 —— "ip" 不得命中 "gzip"，但 "encode" 可命中 "encoding"。 */
function hasTerm(hay, term) {
  if (!ASCII_TERM_RE.test(term)) return hay.includes(term);
  let i = hay.indexOf(term);
  while (i >= 0) {
    if (i === 0 || !WORD_CHAR_RE.test(hay[i - 1])) return true;
    i = hay.indexOf(term, i + 1);
  }
  return false;
}

/* ---------- 单条打分 ---------- */
export function scoreRecipe(recipe, terms, synTags = []) {
  if (!recipe || !terms || !terms.length) return 0;
  const hay = hayOf(recipe);
  const title = String(recipe.title || "").toLowerCase();
  let n = 0;
  for (const t of terms) {
    if (hasTerm(hay, t)) n += 1;
    if (hasTerm(title, t)) n += WEIGHT_TITLE;
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

  /* 2) 切词 → 去停用词（功能词/疑问词不参与打分，见 PRD §6.3 缺陷 D） */
  const rawTerms = tokenize(rawQuery);
  const terms = rawTerms.filter((t) => !STOPWORDS.has(t));
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
      // 区分两种「查不出东西」：切不出词（太短）vs 切出的全是虚词（没问题描述）
      hint: rawTerms.length ? HINT_NO_KEYWORD : HINT_TOO_SHORT,
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
