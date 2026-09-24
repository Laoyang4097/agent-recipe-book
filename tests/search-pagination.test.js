/* ============================================================
   检索翻页回归测试（R-10 讨论落地，2026-09-24）
   ------------------------------------------------------------
   跑法： node tests/search-pagination.test.js   （或 npm test）
   退出码：任何一条 FAIL → 1
   验证：offset / has_more / returned 三件套，确保 agent 不会卡在第 6 条。
   ============================================================ */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { searchRecipes } from "../lib/search.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECIPES = JSON.parse(readFileSync(join(ROOT, "api", "experiences.json"), "utf8"));

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { failures.push(name); console.log(`  ❌ ${name}${detail ? "  — " + detail : ""}`); }
}
function idsOf(res) { return res.results.map((r) => r.recipe.id); }

console.log("=== 检索翻页（offset / has_more / returned）===");

/* 选一个返回足够多的查询做翻页验证 */
const Q = "爬虫";
const all = searchRecipes(RECIPES, Q, { limit: Infinity });
const total = all.matched;
check(`查询「${Q}」命中足够多（≥6）以便翻页`, total >= 6, `matched=${total}`);

/* 第 1 页：limit=5 offset=0 */
const p0 = searchRecipes(RECIPES, Q, { limit: 5, offset: 0 });
check("第1页 returned=5", p0.returned === 5, `returned=${p0.returned}`);
check("第1页 has_more=true（后面还有）", p0.has_more === true, `has_more=${p0.has_more}`);
check("第1页每条带 matchPct", p0.results.every((r) => typeof r.matchPct === "number"), "缺 matchPct");

/* 第 2 页：limit=5 offset=5 —— 应与第1页不重叠、且能取到第 6 条起 */
const p1 = searchRecipes(RECIPES, Q, { limit: 5, offset: 5 });
check("第2页 returned 合理（min(5, 余量)）", p1.returned === Math.min(5, total - 5), `returned=${p1.returned}, total=${total}`);
check("第2页 has_more 与剩余一致", p1.has_more === (total > 10), `has_more=${p1.has_more}, total=${total}`);
const overlap = idsOf(p0).filter((id) => idsOf(p1).includes(id));
check("两页 id 不重叠（offset 真正切到后续）", overlap.length === 0, `重叠=${overlap.join(",")}`);

/* 越界 offset：返回空、has_more=false、不报错 */
const pX = searchRecipes(RECIPES, Q, { limit: 5, offset: 1000 });
check("越界 offset → returned=0", pX.returned === 0, `returned=${pX.returned}`);
check("越界 offset → has_more=false", pX.has_more === false, `has_more=${pX.has_more}`);
check("越界 offset → 不抛错且 matched 仍准确", pX.matched === total, `matched=${pX.matched}`);

/* 单页场景：limit 大于总数时 has_more=false */
const big = searchRecipes(RECIPES, Q, { limit: 100, offset: 0 });
check("limit 足够大 → has_more=false", big.has_more === false, `has_more=${big.has_more}`);
check("limit 足够大 → returned=matched", big.returned === total, `returned=${big.returned}`);

/* 空查询分支也支持 offset（保序全库预览翻页） */
const empty0 = searchRecipes(RECIPES, "", { limit: 3, offset: 0 });
const empty1 = searchRecipes(RECIPES, "", { limit: 3, offset: 3 });
const eOverlap = idsOf(empty0).filter((id) => idsOf(empty1).includes(id));
check("空查询分页不重叠", eOverlap.length === 0, `重叠=${eOverlap.join(",")}`);
check("空查询第2页 has_more 与余量一致", empty1.has_more === (empty0.matched > 6), `has_more=${empty1.has_more}, matched=${empty0.matched}`);

console.log(`\n结果：${pass} 通过 / ${failures.length} 失败`);
if (failures.length) {
  console.log("失败项：" + failures.join("；"));
  process.exit(1);
}
