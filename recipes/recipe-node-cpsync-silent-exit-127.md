---
id: recipe-node-cpsync-silent-exit-127
title: Node 的 fs.cpSync 让进程静默退出（rc=127，零输出）——排查时被退出码带偏了方向
tags:
- node
- 文件IO
- 测试
- 静默失败
- windows
model: Node 22 / fs.cpSync + mkdtempSync
problem: 给回归测试搭临时副本：用 mkdtempSync(tmpdir()) 建目录，再用 fs.cpSync(recipesDir, dst, {recursive:true}) 复制整个配方目录。进程跑到 cpSync 就无任何输出地退出，退出码 127 —— 既没有异常堆栈，也没有 stderr。排查绕了好几轮才定位到是这一行。
dead_ends:
- attempt: 直接跑 node tests/xxx.js，看它报什么错
  failure: 零输出、退出码 127。127 在 shell 里通常意味着「命令未找到」，于是排查方向被带到「node 没装 / 文件名写错了」——而 node -e 明明能跑，越查越远。退出码是会骗人的。
  duration: 两三轮
  early_signal: 进程零输出 + 退出码 127，但同一个解释器跑别的脚本正常
- attempt: 怀疑是 import 失败或收尾函数有问题，逐个改 import 试
  failure: 改了半天没有任何变化，因为真正的崩溃点在模块级的一次文件复制，跟 import 顺序无关。凭感觉猜的效率远低于二分。
  duration: 两三轮
  early_signal: 你在用「猜」而不是「二分」定位问题
- attempt: 把探针脚本写到 /tmp 下再跑
  failure: Git Bash 的 /tmp 与 Windows 版 Node 眼里的路径不是同一个（库内 recipe-tmp-gitbash-vs-windows-python 已记此坑），Node 报 MODULE_NOT_FOUND，又白花一轮。
  duration: 一轮
  early_signal: 你在 Git Bash 里用 /tmp 放要给 Windows 程序读的文件
solution: ① 定位靠二分探针，不靠读代码猜：把模块级操作拆成 A/B/C/D 每步 console.log，第一个没打印出来的就是崩溃点（这次就是这样揪出 cpSync 的）。② 绕开 cpSync：手写递归复制（mkdirSync + readdirSync(withFileTypes) + copyFileSync），十几行，行为完全可控。③ 对 mkdtempSync 的返回值加一道 realpathSync.native()，避开 8.3 短名路径（Windows 临时目录常返回带 ~1 的压缩写法，具体形态用 realpathSync.native() 打出来看即可）。另外这条配方第一次提交时被脱敏闸门拦下——因为正文里写了真实的本机家目录路径；配方里举例不要带真路径。④ 探针脚本写在项目内，别写 /tmp。
result: 换成手写递归复制 + realpath 后，16 条断言一次跑通，零输出问题消失。
retrospective: 「零输出 + 退出码 127」是最难排查的一类失败：它既不是抛异常，也不写 stderr，什么都不给你。对付它的唯一办法是二分探针，读代码猜必然绕远。另一层教训是**退出码会误导**：127 在这个环境是 cpSync 崩溃的表现，而不是它通常代表的「命令找不到」——当你按退出码的惯常含义排查却越查越远时，就该换成分段探针，而不是继续在错误方向里加假设。
harness: tests/rtg1-rebuild.test.js 的 copyDir
verified: true
status: published
confidence: B
contributor_id: anon-47856d
created_at: '2026-10-18'
---

## 背景与卡点

给回归测试搭临时副本：用 `mkdtempSync(tmpdir())` 建目录，再用 `fs.cpSync(recipesDir, dst, { recursive: true })` 复制整个配方目录。进程跑到 `cpSync` 就无任何输出地退出，退出码 127 —— 既没有异常堆栈，也没有 stderr。排查绕了好几轮才定位到是这一行。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。

### 一句话记忆

- **零输出 + 退出码 127** → 别猜，用**二分探针**（每步 console.log，第一个没打印出来的就是崩溃点）。
- 退出码会误导：127 在这里不是「命令找不到」。
- 探针脚本写在**项目内**，别写 `/tmp`（Git Bash 与 Windows 路径不通）。
