/* ============================================================
   全量测试跑手 · 断言数唯一口径（BL-020）
   ------------------------------------------------------------
   跑法： npm test      （= node tests/run-all.js）

   它替掉了 package.json 里那条 `a && b && c && ...` 长链。换掉的不是「能不能跑」，
   而是解决了三个长链解决不了的问题：

   1. **总计没人打**。长链只会把手底下 9 段输出首尾相接，谁也不负责加总。
      于是每次要报数字，都靠人用某条 grep 去数——本项目因此报过 177 / 257 / 271 / 281，
      四个数都不是编的，是四种数法。现在总计由本文件打，且是唯一出口。
   2. **格式漂移没人拦**。9 个文件原本 4 种口径。现在每个文件必须打出
      `结果：N 通过 / M 失败`（regex 与 tests/_harness.js 共用同一份常量），
      打不出就当场标红——把「口径漂移」从几个月后才发现，变成这一次就红。
   3. **自相矛盾没人管**。子进程退出码说失败、汇总行却说 0 失败（或反之），
      以前会悄悄过去。现在两种都算问题，一起报。

   输出约定：每个文件自己的输出原样透传（便于定位），末尾打一行
   `总计（N 个文件）：X 通过 / Y 失败`——刻意与单文件那行不同前缀，
   免得下次有人又拿同一条 grep 同时捞到「单文件数」和「总数」。
   ============================================================ */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SUMMARY_RE } from "./_harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* SUMMARY_RE 是「单条规范行长什么样」的唯一真值源（tests/_harness.js）。
   这里只补一个 g 让它能 matchAll；正则本体一个字都不另写。 */
const SCAN_RE = new RegExp(SUMMARY_RE.source, "gm");

/* 顺序即依赖顺序：先纯检索，再 MCP（会 spawn server.js），写侧放最后。 */
const SUITES = [
  { name: "检索质量基线", args: ["tests/search-baseline.js"] },
  { name: "检索翻页", args: ["tests/search-pagination.test.js"] },
  { name: "L3 分级置信隔离", args: ["tests/search-quarantine.test.js"] },
  { name: "MCP Server 冒烟", args: ["tests/mcp-smoke.js"] },
  { name: "经验向导 prompts", args: ["tests/agent-prompts.test.js"] },
  { name: "写侧 MCP 端到端", args: ["tests/write-mcp.test.js"] },
  { name: "引用校验", args: ["tests/verify-citations.test.js"] },
  { name: "投稿链路解析", args: ["tests/run-python.js", "tests/issue_to_recipe.test.py"] },
  { name: "写侧内核回归", args: ["tests/run-python.js", "tests/ingest_write.test.py"] },
];

const problems = [];
let sumPass = 0;
let sumFail = 0;
let counted = 0;

for (const { name, args } of SUITES) {
  console.log(`\n${"─".repeat(64)}`);
  console.log(`▶ ${name}   (node ${args.join(" ")})`);
  console.log("─".repeat(64));

  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = r.stdout || "";
  const stderr = r.stderr || "";
  if (stdout.trimEnd()) console.log(stdout.trimEnd());
  if (stderr.trimEnd()) console.error(stderr.trimEnd());

  /* 取最后一条匹配：万一某个文件正文里也引用了这句格式（比如文档字符串），
     末尾那条才是它真正的收尾，取最后一条不会认错。 */
  const hit = [...stdout.matchAll(SCAN_RE)].pop();
  if (!hit) {
    problems.push(`${name}：没有打出规范汇总行，无法计入总计（口径漂移）`);
    console.log(`  ❗ 未找到规范汇总行「结果：N 通过 / M 失败」——该文件的口径已漂移，不计入总计。`);
    continue;
  }
  const p = Number(hit[1]);
  const f = Number(hit[2]);
  counted++;
  sumPass += p;
  sumFail += f;

  const exitOk = r.status === 0;
  if (exitOk !== (f === 0)) {
    problems.push(`${name}：退出码(${r.status}) 与自报失败数(${f}) 不一致`);
    console.log(`  ❗ 退出码 ${r.status} 与自报失败数 ${f} 对不上——两者必有一个在说谎。`);
  }
}

console.log(`\n${"═".repeat(64)}`);
console.log(`总计（${counted}/${SUITES.length} 个文件）：${sumPass} 通过 / ${sumFail} 失败`);
if (counted < SUITES.length) {
  console.log(`⚠️ 有 ${SUITES.length - counted} 个文件没被计入（见上方 ❗）——这个总计是不完整的。`);
}
if (problems.length) {
  console.log("\n需要处理的问题：");
  problems.forEach((p) => console.log(`  ❌ ${p}`));
}
console.log("═".repeat(64));

process.exit(problems.length || sumFail ? 1 : 0);
