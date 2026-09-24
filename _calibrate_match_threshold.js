/* ============================================================
   匹配度阈值标定实验（R-10 前置，P1）
   ------------------------------------------------------------
   目的：验证「C 级隔离 + 匹配度≥阈值的最高一位可露头」里，
        相对归一化方法 + 80% 阈值能否分清「该推荐的」与「噪声」。

   方法：相对归一化 —— 对每条查询，取结果集中最高分为 100%，
        其余 = score / Top1.score。这样「≥80%」=「跟全库最相关条
        的相关度达到 80%」，直接对应用户「最高的一位至少 80%」。

   跑法：node _calibrate_match_threshold.js
   产出：阈值下的精度（该推荐的占比）+ 明细分布
   ============================================================ */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { searchRecipes } from "./lib/search.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RECIPES = JSON.parse(readFileSync(join(ROOT, "api", "experiences.json"), "utf8"));

/* 正例：查询 → 该推荐的配方集合（含同主题兄弟配方；来自 search-baseline + 反向验证）
   注：兄弟配方（如 double-decode 与 mojibake 同属乱码、ua-diff 与 antibot 同属反爬）
   都算「合法相关」，不是噪声。真噪声 = 跨主题误命中。 */
const POS = [
  { q: "抓回来是乱码", expected: ["recipe-py-encoding-mojibake", "recipe-py-content-encoding-double-decode"] },
  { q: "爬虫被封 IP 了", expected: ["recipe-py-antibot-stop-on-hit", "recipe-py-ua-diff-nonbrowser"] },
  { q: "翻页总是拿到第一页", expected: ["recipe-py-pagination-ignored-param"] },
  { q: "cookie 丢了登不上", expected: ["recipe-py-session-cookie-lost"] },
  { q: "请问我的爬虫为什么被封了", expected: ["recipe-py-antibot-stop-on-hit", "recipe-py-ua-diff-nonbrowser"] },
  { q: "那个网站抓下来是乱码怎么办", expected: ["recipe-py-encoding-mojibake", "recipe-py-content-encoding-double-decode"] },
  { q: "AI 说的规则可信吗", expected: ["recipe-pj-rule-from-memory"] },
  { q: "比赛都要交视频吗", expected: ["recipe-pj-requirement-misremembered"] },
];
const EXPECTED = new Set(POS.flatMap((p) => p.expected));

/* 待标定阈值（用户假设 0.8，回测后可能调） */
const THRESHOLD = Number(process.env.THRESHOLD || 0.8);

let aboveTotal = 0;
let aboveTarget = 0;
let aboveNoise = 0;
const dist = [];
const top1Abs = [];

for (const { q, target } of POS) {
  const res = searchRecipes(RECIPES, q, { limit: 20 });
  if (!res.results.length) {
    console.log(`  ⚠️ 正例「${q}」竟 0 命中（异常，应排查）`);
    continue;
  }
  const top = res.results[0].score;
  top1Abs.push(top);
  for (const r of res.results) {
    const rel = top > 0 ? r.score / top : 0; // 相对归一化 0-1
    if (rel >= THRESHOLD) {
      aboveTotal++;
      const isRelevant = EXPECTED.has(r.recipe.id); // 合法相关（含兄弟）
      if (isRelevant) aboveTarget++;
      else aboveNoise++; // 真噪声 = 跨主题误命中
      dist.push({ q, id: r.recipe.id.replace("recipe-", ""), pct: Math.round(rel * 100), isRelevant });
    }
  }
}

console.log(`\n=== 匹配度阈值标定（相对归一化，阈值 ${(THRESHOLD * 100).toFixed(0)}%）===`);
console.log(`  正例查询数：${POS.length}`);
console.log(`  命中 ≥ 阈值的条数：${aboveTotal}`);
console.log(`    其中「合法相关」(含同主题兄弟) = ${aboveTarget}`);
console.log(`    其中「真噪声」(跨主题误命中) = ${aboveNoise}`);
console.log(`  精度(合法相关占比) = ${aboveTotal ? ((aboveTarget / aboveTotal) * 100).toFixed(0) + "%" : "N/A"}`);
console.log(`  Top1 绝对分范围：${Math.min(...top1Abs).toFixed(1)} ~ ${Math.max(...top1Abs).toFixed(1)}（参考：绝对刻度未采用）`);
console.log(`\n  明细（≥阈值者）：`);
dist.forEach((d) => console.log(`    ${d.q} → ${d.id} @ ${d.pct}% ${d.isRelevant ? "[相关]" : "[真噪声]"}`));

/* 结论提示 */
const noiseRate = aboveTotal ? aboveNoise / aboveTotal : 0;
console.log(`\n  判读：`);
if (noiseRate <= 0.05) console.log(`    ✅ 真噪声率 ${(noiseRate * 100).toFixed(0)}% ≈ 0，阈值 ${(THRESHOLD * 100).toFixed(0)}% 干净，可作初值`);
else if (noiseRate <= 0.15) console.log(`    ⚠️ 真噪声率 ${(noiseRate * 100).toFixed(0)}%，阈值基本可用，赛后可微调`);
else console.log(`    ❌ 真噪声率 ${(noiseRate * 100).toFixed(0)}% 偏高，阈值需上调或方法重审`);
