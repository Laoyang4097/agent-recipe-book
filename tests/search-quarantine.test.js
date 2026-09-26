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

   PRD《写侧 MCP v1.0》§5.7 那张表是「C 级破例露头」的设计契约，本文件就是它的回归闸门。
   那三行逐条对应到 §5.7 检查项：R-1 / R-2 / R-3 / R-4（见文末小节标题）。
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
/* §5.7 三行的三组探针：
   C_LOOSE 命中了但匹配度不够 → 压住（对应「否则不返回」）
   C_RIVAL_1/2 同为唯一强命中 → 破例最多放一条（对应 matchPct≥阈值 的「且为 Top1」） */
const C_LOOSE = "recipe-test-c-loose";
const A_STRONG = "recipe-test-a-strong";
const C_RIVAL_1 = "recipe-test-c-rival-1";
const C_RIVAL_2 = "recipe-test-c-rival-2";

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
  {
    // 只在 problem 里蹭到一个词，title 里一个「螺栓」都不许有——标题命中额外 +2，
    // 标题里只要出现这个词，它就跟 A_STRONG 同分、matchPct 直接 100，R-4 就测不出东西了。
    // 用「螺栓」还因为它真实库里 zero match，加进来不会污染其它查询的 Top1。
    id: C_LOOSE, confidence: "C", status: "published",
    title: "测试C 标题里没写这个词",
    tags: ["zzz-test-loose"], model: "x",
    problem: "顺带提了一句螺栓",
    dead_ends: [{ attempt: "a", failure: "f", duration: "1min", early_signal: "无关信号" }],
    solution: "s", result: "r", retrospective: "t",
  },
  {
    // 同一个词命中 4 处 → raw 是 C_LOOSE 的数倍，把它的 matchPct 压到阈值以下
    id: A_STRONG, confidence: "A", status: "published",
    title: "测试A 螺栓 强命中",
    tags: ["zzz-test-strong"], model: "x",
    problem: "螺栓 断裂 导致 排查",
    dead_ends: [{ attempt: "a", failure: "f", duration: "1min", early_signal: "螺栓强信号" }],
    solution: "换了一颗螺栓 才解决", result: "r", retrospective: "t",
  },
  {
    // 与 C_RIVAL_2 同强命中「金箍棒」，靠 matchPct 竞争破例名额
    id: C_RIVAL_1, confidence: "C", status: "published",
    title: "测试C 金箍棒 甲",
    tags: ["zzz-test-rival"], model: "x",
    problem: "金箍棒",
    dead_ends: [{ attempt: "a", failure: "f", duration: "1min", early_signal: "信号甲" }],
    solution: "s", result: "r", retrospective: "t",
  },
  {
    id: C_RIVAL_2, confidence: "C", status: "published",
    title: "测试C 金箍棒 乙",
    tags: ["zzz-test-rival"], model: "x",
    problem: "金箍棒",
    dead_ends: [{ attempt: "a", failure: "f", duration: "1min", early_signal: "信号乙" }],
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

/* ============ PRD §5.7 三行契约的回归闸门（R-1..R-5） ============
   §5.7 写明「存疑经验可破例露头、但一定挂标记」是有意保留的设计，
   不是待修的 bug。下面每条都对应那张表的一行，重构检索层时不能削弱。 */

/* R-1：最好的命中是 A / B 级 → 正常返回，附可信等级，不挂 suspect */
const strongQ = "螺栓 强命中";
const strongRes = searchRecipes(POOL, strongQ, {});
const strongTop = (strongRes.results || [])[0];
check("R-1 A/B 命中正常返回且附可信等级",
  !!strongTop && ["A", "B"].includes(strongTop.confidence), `conf=${strongTop && strongTop.confidence}`);
check("R-1 A/B 命中不带 suspect 标记", !!strongTop && strongTop.suspect !== true);
check("R-1 suspect 标记只落在 C 级上",
  strongRes.results.every((r) => (r.confidence === "C") === (r.suspect === true)),
  JSON.stringify(strongRes.results.map((r) => [r.recipe.id, r.confidence, r.suspect])));

/* R-3：破例只放 matchPct 最高的那一条。两条 C 同为唯一强命中时，不能一起露头 */
const rivalQ = "金箍棒";
const rivalIds = idsOf(searchRecipes(POOL, rivalQ, {}));
check("R-3 两条同为 100% 的 C，破例最多放一条",
  rivalIds.filter((x) => x === C_RIVAL_1 || x === C_RIVAL_2).length === 1, `命中=${rivalIds.join(",")}`);
const rivalAll = idsOf(searchRecipes(POOL, rivalQ, { includeQuarantine: true }));
check("R-3 放开 includeQuarantine 时两条都在（说明是被闸门压住，不是压根没命中）",
  rivalAll.includes(C_RIVAL_1) && rivalAll.includes(C_RIVAL_2), `命中=${rivalAll.join(",")}`);

/* R-4：命中了但匹配度不够 → 不返回（§5.7 第三行） */
const looseQ = "螺栓";
const looseDef = searchRecipes(POOL, looseQ, {});
check("R-4 匹配度不够的 C 不在默认结果里", !idsOf(looseDef).includes(C_LOOSE), `命中=${idsOf(looseDef).join(",")}`);
const looseEntry = searchRecipes(POOL, looseQ, { includeQuarantine: true })
  .results.find((r) => r.recipe.id === C_LOOSE);
check("R-4 确认它命中的（压住是因为匹配度不是因为没命中）",
  !!looseEntry && looseEntry.matchPct < C_LEVEL_MATCH_THRESHOLD * 100,
  `matchPct=${looseEntry && looseEntry.matchPct} 阈值=${C_LEVEL_MATCH_THRESHOLD * 100}`);

/* R-5：全部翻完也没有 → 如实说没有，而不是空着 or 拿 C 凑数。
   查询词要挑真实库里 zero match 的：中文子串切分会拿「zz-nonexistent」这种
   里头的两字词去撞真实配方，结果 matched=32，看着像有货其实是噪声。 */
const missRes = searchRecipes(POOL, "量子纠缠", {});
check("R-5 无命中时结果为空且给出「没找到」提示",
  missRes.results.length === 0 && !!missRes.hint, `hint=${missRes.hint}`);

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
// 从 fixtures 现算，不写死数字：再加一条 C fixture 就又得回来改这条断言
const nC = fixtures.filter((f) => f.confidence === "C").length;
check(`合成池含 ${nC} 条 C → quarantined_count=${nC}`,
  poolQ.quarantined_count === nC, `=${poolQ.quarantined_count}`);

/* 真实数据无回归：真实配方均已放行且无一漏进隔离态，经典查询 Top1 不变。
   条数只设下限——写死具体数字会让"又加了 2 条配方"这种正常动作变红。 */
// 原断言写「全部 confidence='A'」：那是晋升功能还没存在时的前提。B 档是晋升机制的
// 合法产物，主库里出现 B 不该变红；真正要守的是隔离态不许漏进主库。
const leaked = RECIPES.filter((r) => r.confidence === "C" || r.status === "quarantined");
check("真实配方无一处于隔离态（C / quarantined）", leaked.length === 0,
  leaked.map((r) => r.id).join(","));
check("真实库已出现 B 档（晋升链路真的用过，A/B 权重差异有真数据可验）",
  RECIPES.some((r) => r.confidence === "B"));
check("真实数据条数 ≥ 40", RECIPES.length >= 40, `=${RECIPES.length}`);
const reg = searchRecipes(RECIPES, "爬虫被封 IP 了", {});
check("真实查询 Top1 仍为 antibot（无回归）", idsOf(reg)[0] === "recipe-py-antibot-stop-on-hit", `top=${idsOf(reg)[0]}`);
check("真实结果均带 confidence 字段（放行档为 A / B）",
  reg.results.every((r) => r.confidence === "A" || r.confidence === "B"));

console.log(`\n结果：${pass} 通过 / ${failures.length} 失败`);
if (failures.length) {
  console.log("失败项：" + failures.join("；"));
  process.exit(1);
}
