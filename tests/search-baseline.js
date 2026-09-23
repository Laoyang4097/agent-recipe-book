/* ============================================================
   检索质量回归测试（PRD v1.2 §11.1 / §11.3）
   ------------------------------------------------------------
   跑法： node tests/search-baseline.js   （或 npm test）
   退出码：任何一条 FAIL → 1（可直接挂 CI）

   基线（2026-09-24 实测，37 条）：
     正例命中 4/4 ｜ 反例拒绝 1/1
   改动 lib/search.js 后若此测试变红，说明排序/命中质量回退了。
   ============================================================ */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  searchRecipes, tokenize, listTags, GROUPS,
  HINT_NO_MATCH, HINT_TOO_SHORT, MIN_TOKEN_LEN,
} from "../lib/search.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECIPES = JSON.parse(readFileSync(join(ROOT, "api", "experiences.json"), "utf8"));

/* ---------------- 迷你断言框架 ---------------- */
let pass = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { failures.push(name); console.log(`  ❌ ${name}${detail ? "  — " + detail : ""}`); }
}

function section(title) {
  console.log(`\n${title}`);
}

/* ---------------- 验收用例（与 PRD §6.3 表一致） ---------------- */
const CASES = [
  { n: 1, kind: "正例", q: "抓回来是乱码", must: ["recipe-py-encoding-mojibake"], maxRank: 2 },
  { n: 2, kind: "正例", q: "爬虫被封 IP 了", must: ["recipe-py-antibot-stop-on-hit", "recipe-py-ua-diff-nonbrowser"], maxRank: 2, minMatched: 1 },
  { n: 3, kind: "正例", q: "翻页总是拿到第一页", must: ["recipe-py-pagination-ignored-param"], maxRank: 1 },
  { n: 4, kind: "正例", q: "cookie 丢了登不上", must: ["recipe-py-session-cookie-lost"], maxRank: 1 },
  { n: 5, kind: "反例", q: "怎么给猫剪指甲", must: [], expectMatched: 0 },
];

console.log(`=== 检索质量回归测试（库内 ${RECIPES.length} 条）===`);

section(`一、验收用例（AC-1 / AC-2 / AC-3 / AC-4）`);

let posPass = 0, posTotal = 0, negPass = 0, negTotal = 0;
const ranks = {};

for (const c of CASES) {
  const res = searchRecipes(RECIPES, c.q, { limit: 5 });
  const top = res.results;
  console.log(`  [${c.n}] ${c.kind} 「${c.q}」 → 命中 ${res.matched} 条` +
    (res.synTags.length ? ` ｜ 同义词: ${res.synTags.join(",")}` : ""));
  console.log(`      Top5: ${top.map((x) => x.recipe.id.replace("recipe-", "") + "(" + x.score.toFixed(1) + ")").join(", ") || "（无）"}`);

  if (c.kind === "正例") {
    posTotal++;
    const idx = top.findIndex((x) => c.must.includes(x.recipe.id));
    const ok = idx >= 0 && idx + 1 <= c.maxRank;
    if (ok) posPass++;
    ranks[c.n] = idx >= 0 ? idx + 1 : null;
    check(`用例${c.n} 目标配方进 Top${c.maxRank}`, ok,
      ok ? `第 ${idx + 1} 位` : `实际 ${idx < 0 ? "未进 Top5" : "第 " + (idx + 1) + " 位"}`);
    if (c.minMatched != null) {
      check(`用例${c.n} 命中数 ≥ ${c.minMatched}（原缺陷 A：曾为 0）`, res.matched >= c.minMatched, `实际 ${res.matched}`);
    }
  } else {
    negTotal++;
    const ok = res.matched === 0;
    if (ok) negPass++;
    check(`用例${c.n} 无命中（反例必须优雅拒绝）`, ok, `实际 ${res.matched} 条`);
    check(`用例${c.n} 0 命中时给出提示而非空响应`, res.hint === HINT_NO_MATCH, `hint=${JSON.stringify(res.hint)}`);
  }
}

check(`AC-1 正例通过率 ${posPass}/${posTotal}`, posPass === posTotal);
check(`AC-1 反例拒绝率 ${negPass}/${negTotal}`, negPass === negTotal);
check("AC-2 用例1 目标排名 ≤ 2（原第 3 位）", ranks[1] != null && ranks[1] <= 2, `实际第 ${ranks[1] ?? "?"} 位`);

/* 缺陷 B：元配方不得抢占 Top1（用户问「乱码」，不该先给「我是怎么修这个搜索的」） */
const case1 = searchRecipes(RECIPES, "抓回来是乱码", { limit: 5 });
check("缺陷B 元配方未抢占用例1 Top1",
  case1.results.length > 0 && case1.results[0].recipe.id !== "recipe-web-cjk-substring-search",
  `Top1=${case1.results[0]?.recipe.id}`);

/* ---------------- 缺陷 C：单字符不得命中全库 ---------------- */
section("二、边界输入（缺陷 C）");
for (const q of ["a", "x", "1", "_"]) {
  const res = searchRecipes(RECIPES, q, { limit: 5 });
  check(`单字符「${q}」不再命中全库`, res.matched === 0 && tokenize(q).length === 0,
    `命中 ${res.matched} 条 / 切出 ${tokenize(q).length} 词`);
}
const aQuery = searchRecipes(RECIPES, "a");
check("单字符查询给出 HINT_TOO_SHORT（而非空响应）", aQuery.hint === HINT_TOO_SHORT);
check(`MIN_TOKEN_LEN === ${MIN_TOKEN_LEN}`, MIN_TOKEN_LEN === 2);

/* 大小写不敏感：hay 是小写的，若 tokenize 不转小写，大写词会被静默浪费 */
check("tokenize 统一转小写", tokenize("IP").every((t) => t === t.toLowerCase()), JSON.stringify(tokenize("IP")));
const upper = searchRecipes(RECIPES, "抓回来是乱码 COOKIE");
const lower = searchRecipes(RECIPES, "抓回来是乱码 cookie");
check("大小写不影响命中结果",
  upper.matched === lower.matched && upper.results[0]?.recipe.id === lower.results[0]?.recipe.id,
  `upper=${upper.matched} lower=${lower.matched}`);

/* ---------------- 空查询 / 无效查询 ---------------- */
section("三、空查询与无效查询");
const publishedCount = RECIPES.filter((r) => r.status === "published").length;
for (const q of ["", "   ", "\n"]) {
  const res = searchRecipes(RECIPES, q);
  check(`空白查询「${JSON.stringify(q)}」→ 返回全量（不过滤）`, res.matched === publishedCount && res.hint === null,
    `matched=${res.matched} vs 已发布=${publishedCount}`);
}
/* 注意：纯空白串（" "）在上一组已覆盖 —— trim 后为空 = 用户清空了搜索框，
   属于「返回全量」而不是「无效查询」。别把它归到这一组。 */
for (const q of ["。。。", "的", "!!!", "、、、"]) {
  const res = searchRecipes(RECIPES, q);
  check(`无效查询「${q}」→ 0 命中 + 太短提示`, res.matched === 0 && res.hint === HINT_TOO_SHORT,
    `matched=${res.matched} hint=${JSON.stringify(res.hint)}`);
}

/* ---------------- limit / tags / predicate / 去重 / 状态 ---------------- */
section("四、过滤与治理");
const limited = searchRecipes(RECIPES, "抓回来是乱码", { limit: 2 });
check("limit 生效", limited.results.length <= 2, `实际 ${limited.results.length}`);
check("limit 不改变 matched 总数", limited.matched >= limited.results.length);

const tagged = searchRecipes(RECIPES, "乱码", { tags: ["encoding"] });
check("tags 过滤（AND）生效", tagged.results.every((x) => (x.recipe.tags || []).includes("encoding")),
  `越界条数 ${tagged.results.filter((x) => !(x.recipe.tags || []).includes("encoding")).length}`);

const webGroup = GROUPS.find((g) => g.key === "web");
const inWeb = searchRecipes(RECIPES, "乱码", { predicate: webGroup.match });
check("predicate（领域）过滤生效", inWeb.results.every((x) => webGroup.match(x.recipe)),
  `越界条数 ${inWeb.results.filter((x) => !webGroup.match(x.recipe)).length}`);

const dupd = RECIPES.concat(RECIPES);
const dedup = searchRecipes(dupd, "", { limit: 999 });
check("按 id 去重（重复喂入不重复输出）", dedup.results.length === publishedCount,
  `${dedup.results.length} vs ${publishedCount}`);

const withQuarantined = RECIPES.concat([{
  ...RECIPES[0], id: "recipe-py-test-quarantined", status: "quarantined",
}]);
const q1 = searchRecipes(withQuarantined, "乱码");
const q2 = searchRecipes(withQuarantined, "乱码", { includeUnpublished: true });
check("status≠published 默认被过滤", !q1.results.some((x) => x.recipe.id === "recipe-py-test-quarantined"));
check("includeUnpublished 开关可放开", q2.matched >= q1.matched);

/* ---------------- 标签清单 & 领域分类 ---------------- */
section("五、标签清单与领域分类");
const tags = listTags(RECIPES);
check("listTags 非空", tags.length > 0, `${tags.length} 个标签`);
check("listTags 按出现次数降序", tags.every((t, i) => i === 0 || tags[i - 1].count >= t.count));
check("listTags 计数之和 = 全部 tag 引用数",
  tags.reduce((s, t) => s + t.count, 0) === RECIPES.reduce((s, r) => s + (r.tags || []).length, 0));

const groupCounts = GROUPS.filter((g) => g.key !== "all").map((g) => ({
  label: g.label, n: RECIPES.filter(g.match).length,
}));
const sumGroups = groupCounts.reduce((s, g) => s + g.n, 0);
check("领域分类无重叠无遗漏（合计 = 全库）", sumGroups === RECIPES.length,
  groupCounts.map((g) => `${g.label}=${g.n}`).join(" ") + ` 合计 ${sumGroups} vs ${RECIPES.length}`);

/* ---------------- 汇总 ---------------- */
console.log(`\n=== 汇总 ===`);
console.log(`  通过 ${pass} 项 ｜ 失败 ${failures.length} 项`);
if (failures.length) {
  console.log(`  失败清单：`);
  failures.forEach((f) => console.log(`    - ${f}`));
  console.log(`\n❌ 检索质量回归失败 —— 请检查 lib/search.js 的打分权重与同义词表。`);
  process.exit(1);
}
console.log(`\n✅ 全部通过（正例 ${posPass}/${posTotal}，反例 ${negPass}/${negTotal}）`);
console.log(`   Top5 排名：` + CASES.filter((c) => c.kind === "正例").map((c) => `用例${c.n}=第${ranks[c.n]}位`).join(" ｜ "));
