/* ============================================================
   L3 分级置信隔离测试（R-10，2026-09-24 落地）
   ------------------------------------------------------------
   跑法： node tests/search-quarantine.test.js   （或 npm test）
   退出码：任何一条 FAIL → 1
   验证：
     · C 级默认不进主检索（AC-2）
     · C 级「高匹配度例外放行」（§6.6.1，matchPct≥阈值且为 Top1 → 破例露头 suspect）
     · include_quarantine=true 时主结果含全部 C（AC-3 配合）
     · B 级权重 ×0.85 < A 级 ×1.0（同 raw 时 A 排前，AC-2）
     · quarantined_count 正确
     · 真实 42 条全 A，检索行为无回归
   ============================================================ */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { searchRecipes, C_LEVEL_MATCH_THRESHOLD } from "../lib/search.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECIPES = JSON.parse(readFileSync(join(ROOT, "api", "experiences.json"), "utf8"));

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { failures.push(name); console.log(`  ❌ ${name}${detail ? "  — " + detail : ""}`); }
}
function idsOf(res) { return res.results.map((r) => r.recipe.id); }

/* ---- 合成隔离配方（不污染生产 42 条，仅测试用） ---- */
const C_UNIQUE = "recipe-test-c-unique";   // 唯一强命中 → 触发例外放行
const C_DUP = "recipe-test-c-dup";         // 与 A_DUP 同内容 → 不释放（被 A 压）
const A_DUP = "recipe-test-a-dup";
const A_W = "recipe-test-a-weight";
const B_W = "recipe-test-b-weight";

const fixtures = [
  {
    id: C_UNIQUE, confidence: "C", status: "published",
    title: "测试C 唯一命中 玄武岩缓冲崩溃",
    tags: ["zzz-test-c"], model: "x",
    problem: "撞见玄武岩缓冲导致崩溃",
    dead_ends: [{ attempt: "a", failure: "f", duration: "1min", early_signal: "玄武岩缓冲必有前置信号" }],
    solution: "s", result: "r", retrospective: "t",
  },
  {
    id: C_DUP, confidence: "C", status: "published",
    title: "测试C 爬虫被封 IP 反爬 重复内容",
    tags: ["zzz-test-c"], model: "x",
    problem: "爬虫被封 IP 了反爬",
    dead_ends: [{ attempt: "a", failure: "f", duration: "1min", early_signal: "封 IP 前有频率信号" }],
    solution: "s", result: "r", retrospective: "t",
  },
  {
    id: A_DUP, confidence: "A", status: "published",
    title: "测试A 爬虫被封 IP 反爬 重复内容",
    tags: ["zzz-test-a"], model: "x",
    problem: "爬虫被封 IP 了反爬",
    dead_ends: [{ attempt: "a", failure: "f", duration: "1min", early_signal: "封 IP 前有频率信号" }],
    solution: "s", result: "r", retrospective: "t",
  },
  {
    id: A_W, confidence: "A", status: "published",
    title: "测试权重 乱码编码 唯一词",
    tags: ["zzz-test-w"], model: "x",
    problem: "乱码编码 唯一词",
    dead_ends: [{ attempt: "a", failure: "f", duration: "1min", early_signal: "编码错有明确信号" }],
    solution: "s", result: "r", retrospective: "t",
  },
  {
    id: B_W, confidence: "B", status: "published",
    title: "测试权重 乱码编码 唯一词",
    tags: ["zzz-test-w"], model: "x",
    problem: "乱码编码 唯一词",
    dead_ends: [{ attempt: "a", failure: "f", duration: "1min", early_signal: "编码错有明确信号" }],
    solution: "s", result: "r", retrospective: "t",
  },
];
const POOL = [...RECIPES, ...fixtures];

console.log("=== L3 分级置信隔离（R-10）===");

/* AC-2：C 级默认不进主检索 —— 同内容 A/C 竞争，A 压 C */
const dupQ = "爬虫被封 IP 了反爬";
const dupDef = searchRecipes(POOL, dupQ, {});
check("默认检索不含 C 级（C_DUP 被隔离）", !idsOf(dupDef).includes(C_DUP), `命中=${idsOf(dupDef).join(",")}`);
check("默认检索含同内容 A 级（A_DUP）", idsOf(dupDef).includes(A_DUP));

/* AC-3 / include_quarantine：含全部 C */
const dupQAll = searchRecipes(POOL, dupQ, { includeQuarantine: true });
check("include_quarantine=true 含 C 级", idsOf(dupQAll).includes(C_DUP), `命中=${idsOf(dupQAll).join(",")}`);
const cEntry = dupQAll.results.find((r) => r.recipe.id === C_DUP);
check("C 级带 suspect:true", cEntry && cEntry.suspect === true);
check("C 级带 confidence:'C'", cEntry && cEntry.confidence === "C");

/* §6.6.1：C 级高匹配度例外放行（唯一强命中 → Top1 matchPct=100≥阈值 → 破例露头） */
const uniQ = "玄武岩缓冲";
const uniDef = searchRecipes(POOL, uniQ, {});
check("唯一命中 C 级被例外放行（进主检索）", idsOf(uniDef).includes(C_UNIQUE), `命中=${idsOf(uniDef).join(",")}`);
const uniEntry = uniDef.results.find((r) => r.recipe.id === C_UNIQUE);
check("放行 C 级标 suspect:true", uniEntry && uniEntry.suspect === true);
check("放行 C 级标 matchPct≥阈值", uniEntry && uniEntry.matchPct >= C_LEVEL_MATCH_THRESHOLD * 100, `matchPct=${uniEntry && uniEntry.matchPct}`);
check("放行 C 级 quarantined_count 反映隔离存在", uniDef.quarantined_count >= 1, `quarantined_count=${uniDef.quarantined_count}`);

/* AC-2：B 级权重 ×0.85 < A 级 ×1.0（同 raw 内容，A 应排前） */
const wQ = "乱码编码 唯一词";
const wRes = searchRecipes(POOL, wQ, {});
const aIdx = idsOf(wRes).indexOf(A_W);
const bIdx = idsOf(wRes).indexOf(B_W);
check("A/B 同内容均命中", aIdx >= 0 && bIdx >= 0, `a=${aIdx}, b=${bIdx}`);
check("A 级排名先于 B 级（×0.85 降权生效）", aIdx >= 0 && bIdx >= 0 && aIdx < bIdx, `a=${aIdx}, b=${bIdx}`);

/* quarantined_count：C 在池中即计入 */
const baseQ = searchRecipes(RECIPES, "爬虫", {});
check(`真实 ${RECIPES.length} 条无 C → quarantined_count=0`, baseQ.quarantined_count === 0, `=${baseQ.quarantined_count}`);
const poolQ = searchRecipes(POOL, "爬虫", {});
check("合成池含 2 条 C → quarantined_count=2", poolQ.quarantined_count === 2, `=${poolQ.quarantined_count}`);

/* 真实数据无回归：真实配方全 A，经典查询 Top1 不变。
   条数只设下限——写死具体数字会让"又加了 2 条配方"这种正常动作变红。 */
check("真实配方全部 confidence='A'", RECIPES.every((r) => r.confidence === "A"));
check("真实数据条数 ≥ 40", RECIPES.length >= 40, `=${RECIPES.length}`);
const reg = searchRecipes(RECIPES, "爬虫被封 IP 了", {});
check("真实查询 Top1 仍为 antibot（无回归）", idsOf(reg)[0] === "recipe-py-antibot-stop-on-hit", `top=${idsOf(reg)[0]}`);
check("真实结果均带 confidence 字段", reg.results.every((r) => r.confidence === "A"));

console.log(`\n结果：${pass} 通过 / ${failures.length} 失败`);
if (failures.length) {
  console.log("失败项：" + failures.join("；"));
  process.exit(1);
}
