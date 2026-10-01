/* ============================================================
   测试样板（六套测试共用）
   ------------------------------------------------------------
   原先 6 个测试文件各自复制同一份 check/section/ROOT/SERVER。
   抽到这里后：改一次断言口径，六套一起生效；新增测试只需 import。
   ============================================================ */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SERVER = join(ROOT, "mcp", "server.js");

export let pass = 0;
export const failures = [];

export function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? "  — " + detail : ""}`);
  }
}

export function section(t) {
  console.log(`\n${t}`);
}

/* ---------------- 收尾口径（唯一真值源 · BL-020） ----------------
   全部测试文件的最后一行必须是：
       结果：<N> 通过 / <M> 失败
   （Python 侧同样是这一行，见 tests/*.test.py。）

   为什么要强约束到「最后一行」：本项目报过的断言数有 177 / 257 / 271 / 281 / 294 好几个版本，
   根因不是谁算错，而是 9 个文件用了 4 种口径，谁用什么 grep 就得到什么数。
   现在 tests/run-all.js 用下面这条正则逐文件解析、再打总计；哪个文件口径漂了就找不到那一行，
   总计会直接报「认不出」而不是悄悄少加一个数——把口径漂移从「事后发现」变成「当场红」。 */
export const SUMMARY_RE = /^结果：(\d+) 通过 \/ (\d+) 失败$/m;

export function summaryLine() {
  return `结果：${pass} 通过 / ${failures.length} 失败`;
}

/* 打完收工：先列失败清单（如果有），再打规范行，最后按失败数定退出码。
   三个动作绑在一起，是为了让「忘记打汇总行」或「失败却不退非零」在结构上不可能发生。 */
export function done() {
  if (failures.length) {
    console.log("\n失败清单：");
    failures.forEach((f) => console.log(`  ❌ ${f}`));
  }
  console.log(`\n${summaryLine()}`);
  process.exit(failures.length ? 1 : 0);
}
