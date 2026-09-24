/* ============================================================
   引用校验单测（PRD 增量 v1.2 §8.3 防编造护栏）
   ------------------------------------------------------------
   跑法： node tests/verify-citations.test.js
   重点：构造「故意越界」样例，验证它能拦下 Agent 编造的配方 id。
   ============================================================ */

import { verifyCitations } from "../lib/verifyCitations.js";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { failures.push(name); console.log(`  ❌ ${name}${detail ? "  — " + detail : ""}`); }
}
function section(t) { console.log(`\n${t}`); }

const ALLOWED = ["recipe-py-encoding-mojibake", "recipe-py-antibot-stop-on-hit"];

section("一、全部合法 → 通过");
{
  const ans = "中文站乱码多半是编码问题 [recipe-py-encoding-mojibake]；被封就别硬刚 [recipe-py-antibot-stop-on-hit]。";
  const r = verifyCitations(ans, ALLOWED);
  check("ok = true", r.ok === true);
  check("cited 含两个 id", r.cited.length === 2 && r.badIds.length === 0, JSON.stringify(r));
}

section("二、出现越界（编造）id → 拦截");
{
  const ans = "你可以试试 fake-lib-xyz 的方法 [recipe-fake-lib-xyz]，但乱码请用 [recipe-py-encoding-mojibake]。";
  const r = verifyCitations(ans, ALLOWED);
  check("ok = false", r.ok === false);
  check("badIds 含编造 id", r.badIds.includes("recipe-fake-lib-xyz"), JSON.stringify(r));
  check("合法 id 仍计入 cited", r.cited.includes("recipe-py-encoding-mojibake"));
}

section("三、完全无引用 → 通过（不误伤）");
{
  const r = verifyCitations("这个问题库里没有直接匹配，建议换更具体的说法。", ALLOWED);
  check("ok = true", r.ok === true);
  check("cited 为空", r.cited.length === 0);
}

section("四、空回答 / 非字符串 → 不报错");
{
  check("空串 ok", verifyCitations("", ALLOWED).ok === true);
  check("undefined ok", verifyCitations(undefined, ALLOWED).ok === true);
  check("null ok", verifyCitations(null, ALLOWED).ok === true);
}

section("五、白名单为空但答案有引用 → 全部判越界");
{
  const ans = "参考 [recipe-py-encoding-mojibake]。";
  const r = verifyCitations(ans, []);
  check("ok = false", r.ok === false);
  check("badIds 命中该 id", r.badIds.includes("recipe-py-encoding-mojibake"));
}

section("六、大小写 / 非 recipe 前缀不误判为引用");
{
  // [Recipe-...] 大写、[注意] 非 recipe 前缀，都不应被当成配方引用
  const ans = "注意：[Recipe-XXX] 这种写法不应被当成引用。";
  const r = verifyCitations(ans, ALLOWED);
  check("ok = true（不误伤）", r.ok === true, JSON.stringify(r));
  check("cited 为空", r.cited.length === 0);
}

console.log(`\n=== 结果：${pass} 通过 / ${failures.length} 失败 ===`);
if (failures.length) {
  console.log("失败项：\n - " + failures.join("\n - "));
  process.exit(1);
}
console.log("🎉 引用校验全部通过");
