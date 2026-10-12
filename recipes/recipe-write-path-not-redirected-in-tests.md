---
id: recipe-write-path-not-redirected-in-tests
title: 验证会写盘的功能时忘了重定向写入路径：探针把运行期日志写进真实仓库（untracked，git add -A 就带走）
tags:
- 测试
- 写路径
- 运行期产物
- git
- 隐私
model: Node 22 / mcp/server.js 缺口日志 + tests/gap-hint.test.js
problem: 给 MCP 加缺口日志后，为了验证判据对不对，手动 spawn 服务打探针发了几条查询。测试套件本身已经用临时目录隔离了，但探针用的是默认数据路径——于是探针的查询被写进了真实仓库的 api/gaps.jsonl（2 行），其中一行是在旧的错误判据下产生的（matched=13 却记为缺口）。更麻烦的是它是 untracked 文件，git status 里静静躺着，一次 git add -A 就能带进提交。
dead_ends:
- attempt: 测试套件已经用 mkdtempSync 隔离了，所以认为整条链路都不会碰真实仓库
  failure: 隔离只覆盖了自动化测试这一条路径。手动探针、REPL 调试、临时脚本走的都是默认数据路径，写盘照样落到真实仓库。隔离做在了测试里，没做在功能本身上。
  duration: 提交前 git status 才发现多了一个 untracked 文件
  early_signal: 你心里记着「这个功能有隔离」，于是放松了对其他入口的检查
- attempt: 觉得写进去也没关系，因为日志只存 hash 和长度，不存查询原文
  failure: 默认配置下确实不存原文，但功能留了 RECIPE_GAP_LOG_RAW=1 开关（存打码后的样本）。开关一旦被别人打开，写进仓库的就是用户真实输入。而且即便只有 hash，运行期产物本身也不属于代码仓库——它会无限增长，每次跑都不一样，提交上去就是噪音。
  duration: 设计复核时想到
  early_signal: 用「现在的内容安全」论证「进仓库没问题」——内容会变，位置不会变
- attempt: 手动删掉那个文件就完事
  failure: 删掉只是清掉这一次的结果。下一次任何人打探针、跑调试脚本，它还会再长出来，而且还是 untracked——同样会被 git add -A 带走。修的是产物，不是路径。
  duration: 删完就意识到
  early_signal: 你的修复不改变「它会不会再次产生」
solution: ① 会写盘的功能在验证前先重定向写入路径：新建临时目录、把库复制过去、用环境变量把读写路径指过去，验证完连目录一起删。测试、探针、调试脚本三种入口都要这么做，不能只做测试那一种。② 运行期日志一律进 .gitignore，并在注释里写明「运行期产物，不入库」，防止 git add -A 带走。③ 提交前必看 git status 的 untracked 段——新功能第一次跑完，最容易多出来的就是这类文件。④ 更进一步：把「日志写到哪」做成可配置项而不是硬编码路径，让调用方自己决定落在哪，默认落在数据目录旁边（那里本来就不该进库）。
result: api/gaps.jsonl 确认无原文泄露（只有 ts / query_hash / query_len / matched / top_match_pct / tags），隐私设计生效；但把它加入 .gitignore 并清掉残留，避免作为运行期产物进库。测试用例全程走临时目录，未再污染真实仓库。
retrospective: 「测试隔离了」和「功能不会污染仓库」是两件事。前者只管住了一条入口，后者才是属性。凡是会写盘的功能，都要问一句：除了测试，还有谁会调用它？手动探针、调试脚本、同事的一次随手运行——这些都是没被隔离的入口。另外 untracked 文件是最容易漏的一类提交：它不出现在 git diff 里，只有 git status 看得见，而很多人提交前只看 diff。新功能第一次跑完，先跑一次 git status。
harness: tests/gap-hint.test.js 的 mkdtempSync 隔离 + .gitignore
verified: true
status: published
confidence: B
contributor_id: anon-47856d
created_at: '2026-10-08'
---

## 背景与卡点

给 MCP 加缺口日志后，为了验证判据对不对，手动 spawn 服务打探针发了几条查询。测试套件本身已经用临时目录隔离了，但探针用的是默认数据路径——于是探针的查询被写进了真实仓库的 `api/gaps.jsonl`（2 行），其中一行是在旧的错误判据下产生的（matched=13 却记为缺口）。更麻烦的是它是 untracked 文件，`git status` 里静静躺着，一次 `git add -A` 就能带进提交。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。

### 一句话记忆

- 测试隔离 ≠ 功能不污染。**三种入口**（测试 / 探针 / 调试脚本）都要重定向写入路径。
- untracked 文件不在 `git diff` 里，只在 `git status` 里 —— 新功能跑完先看 status。
