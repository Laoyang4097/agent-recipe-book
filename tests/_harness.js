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
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { failures.push(name); console.log(`  ❌ ${name}${detail ? "  — " + detail : ""}`); }
}

export function section(t) { console.log(`\n${t}`); }
