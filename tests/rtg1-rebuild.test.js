/* ============================================================
   RT-G1 回归测试：坏 .md 必须让 rebuild / check 失败
   （依据 2026-10-18 维护者反馈 docs/feedback-proactive-usage-2026-10-18.md §4.1）
   ------------------------------------------------------------
   跑法： node tests/rtg1-rebuild.test.js   （或 npm test）
   退出码：任何一条 FAIL → 1

   旧行为（bug）：rebuild 遇到 frontmatter 解析失败的 .md，只打一行警告，
   然后**照常写出索引**、退出码仍是 0 —— 库静默少一条，投稿方以为自己写进去了。
   实测：一条 solution 里写了「{timeout: 30}」的配方被剔除，库停在 74 条且无人知晓。

   新行为（本文件守的）：
     · 坏 .md 存在 → rebuild 拒绝写索引，索引字节不变，退出码非 0
     · 新增 check 子命令做提交前预检：只读、不写盘、坏即非 0
     · --force 显式允许跳过：退出 0，但输出必须写明「不完整」
     · 条数等式哨兵：recipes/*.md 数 == 索引条数，不等即失败（force 下降级为警告）

   ⚠️ 全程用临时副本（RECIPE_BOOK_ROOT 重定向整本书），真实仓库一个字节都不碰。
   ============================================================ */

import { spawnSync } from "node:child_process";
import {
  copyFileSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, check, section, done } from "./_harness.js";
import { pickPython } from "../lib/pybin.js";

const PY = pickPython();
const INGEST = join(ROOT, "api", "ingest.py");

/* 坏 md：solution 里的「冒号+空格」未加引号，YAML 会把它当嵌套 mapping 而崩 */
const BAD_MD = `---
id: recipe-deliberately-broken
title: 故意写坏的配方（冒号加空格未加引号）
tags:
- 测试
model: 测试
problem: 用来验证 rebuild 会不会静默跳过这条
solution: 见下 {timeout: 30} 这段会让 YAML 解析崩掉
status: published
---

正文占位。
`;

/* 不用 fs.cpSync：本机实测它在这个临时目录上会让 Node 静默退出（rc=127，无任何输出），
   且 mkdtempSync 给回的是 8.3 短名路径（C:\Users\LAOYAN~1\...）。两步都规避掉：
   先 realpath 还原成长路径，再用显式递归复制。 */
function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name);
    const d = join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

const TMP = realpathSync.native(mkdtempSync(join(tmpdir(), "rtg1-")));
const BOOK = join(TMP, "book");
mkdirSync(join(BOOK, "api"), { recursive: true });
copyDir(join(ROOT, "recipes"), join(BOOK, "recipes"));
copyFileSync(join(ROOT, "api", "experiences.json"), join(BOOK, "api", "experiences.json"));

const EXP = join(BOOK, "api", "experiences.json");
const BAD_PATH = join(BOOK, "recipes", "recipe-deliberately-broken.md");

function run(args) {
  const r = spawnSync(PY, [INGEST, ...args], {
    encoding: "utf8",
    env: { ...process.env, RECIPE_BOOK_ROOT: BOOK },
    cwd: ROOT,
    timeout: 60000,
  });
  return { rc: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function countMd() {
  return readdirSync(join(BOOK, "recipes")).filter((f) => f.endsWith(".md")).length;
}
function countIndex() {
  return JSON.parse(readFileSync(EXP, "utf8")).length;
}

const before = readFileSync(EXP, "utf8");
const nBefore = countIndex();

section("一、干净副本：check 与 rebuild 都应成功");
const c1 = run(["check"]);
check("check rc=0（全部可解析）", c1.rc === 0, `rc=${c1.rc} ${c1.out.slice(0, 120)}`);
check("check 输出含「check 通过」", /check 通过/.test(c1.out));
const r1 = run(["rebuild"]);
check("rebuild rc=0", r1.rc === 0, `rc=${r1.rc} ${r1.out.slice(0, 120)}`);

section("二、放进坏 .md 后：check 必须失败");
writeFileSync(BAD_PATH, BAD_MD, "utf8");
const c2 = run(["check"]);
check("check rc≠0", c2.rc !== 0, `rc=${c2.rc}`);
check("check 列出坏文件名", c2.out.includes("recipe-deliberately-broken.md"));

section("三、坏 .md 存在时：rebuild 必须拒绝写索引（RT-G1 核心）");
const r2 = run(["rebuild"]);
check("rebuild rc≠0", r2.rc !== 0, `rc=${r2.rc}`);
check("索引字节完全没变（未产出残缺索引）", readFileSync(EXP, "utf8") === before);
check("提示索引保持原样", /索引保持原样/.test(r2.out));
check("提示 --force 这条退路", /--force/.test(r2.out));

section("四、--force 显式跳过：退出 0 但必须写明不完整");
const r3 = run(["rebuild", "--force"]);
check("--force rc=0", r3.rc === 0, `rc=${r3.rc} ${r3.out.slice(0, 120)}`);
check("索引条数不含坏文件（仍是原条数）", countIndex() === nBefore,
  `${countIndex()} 条，期望 ${nBefore}`);
check("输出注明「不完整」", /不完整/.test(r3.out));
check("skipped 的坏文件被点名", r3.out.includes("recipe-deliberately-broken.md"));

section("五、删掉坏文件后恢复，且条数等式成立");
rmSync(BAD_PATH, { force: true });
const c3 = run(["check"]);
check("check 恢复 rc=0", c3.rc === 0, `rc=${c3.rc}`);
const r4 = run(["rebuild"]);
check("rebuild 恢复 rc=0", r4.rc === 0, `rc=${r4.rc}`);
check("条数等式：recipes/*.md 数 == 索引条数", countMd() === countIndex(),
  `md=${countMd()} 索引=${countIndex()}`);

rmSync(TMP, { recursive: true, force: true });
done();
