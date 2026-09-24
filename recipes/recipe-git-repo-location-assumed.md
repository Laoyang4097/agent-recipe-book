---
id: recipe-git-repo-location-assumed
title: 只查一层就说"这里不是 git 仓库"——验证范围小于结论所依赖的前提
tags:
- git
- verification
- verification-scope
- tooling
confidence: A
model: WorkBuddy agentic Bash（本机 Windows）
problem: '需要判断一个工作区是不是 git 仓库、能不能提交。
  在根目录跑 `git rev-parse` 拿到 `fatal: not a git repository`，
  随即断言"整个工作区不是 git 仓库"，并据此告诉用户"得先 git init + remote add"。
  实际上仓库就在隔壁的 `agent-recipe-book/.git`，remote 早已配好、CI 和 Pages 都在跑。'
dead_ends:
- attempt: 在目标目录跑一次 `git rev-parse --show-toplevel`，拿到非 0 退出码，就认定结论成立
  failure: '返回 `fatal: not a git repository (or any of the parent directories): .git`。
    **这个错误信息只证明了"当前这一层往上都没有 .git"**，但它读起来像是"这个目录不是仓库"。
    于是得出了一个正好相反的结论，还把它写进了给用户看的报告。'
  duration: 3min
  early_signal: "错误信息的作用域比看起来窄。凡是「查 A 得不出 A」的报错——
    「这里不是仓库」说的是当前目录、而非整个工作区——都要先想清楚它到底覆盖了什么范围
    再据此下结论，或者干脆换个能直接回答问题的命令"
- attempt: 把「当前目录不是仓库」升级成「这里没有 .git」乃至「这里不该是仓库」
  failure: 顺着这个错误结论，给出的建议是"先 git init + 配 remote"——
    而用户早就在用 GitHub 了（remote = github.com/Laoyang4097/agent-recipe-book），
    按那条建议做会**把一个已有仓库的轮子重新造一遍**，并在根目录多出一个互不相干的仓库。
    最终是靠 `find . -maxdepth 3 -name ".git"` 才发现仓库一直在子目录里。
  duration: 10min
  early_signal: 想确认「某处是不是仓库」就直接去找标记物（`find . -maxdepth N -name .git`），
    不要用「在某个代表性目录上跑命令」来推断整体；
    反过来，要确认「一个已知仓库里的某条命令会怎么表现」，才该在其子目录里跑
solution: '判断仓库位置用 `find . -maxdepth 3 -name ".git" -o -maxdepth 3 -name "*.gitattributes"`，
  再 `git -C <dir> remote -v` 看 remote 到底指向哪里。
  判断当前目录是不是仓库才会用 `git rev-parse`
  两者有不同的适用面，别混用。'
result: 改用 find 后 10 秒内定位到仓库与 remote，4 个语义提交一次性推送成功，
  没有产生多余的 git init。
retrospective: 讽刺的是，这次犯错的当天刚把
  `recipe-infra-verify-silent-pass`（三处"验证通过"其实是没验证到）写进库里。
  那一条讲失败没有被暴露——这次则是**验证装置确实跑了、也确实报错了，
  是我把报错读成了另一个意思**。同一类错误的第三种形态：
  上一次是"没看信号"，这一次是"信号对了、解读错了"。
  判断规则可以压成一句：**结论的成立范围，必须不小于你验证它的范围。**
skills:
- git
- verification
harness: WorkBuddy agentic Bash（Windows / Git Bash）
hardware:
  os: win32 (Git Bash)
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-25'
---

## 背景与卡点

要判断一个工作区能不能提交代码。这一步看似简单，但它同时依赖两个前提：
「仓库在哪」和「当前目录算不算仓库」。我只验证了后者的一种情形，就当两者都定了。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。

### 与 `recipe-infra-verify-silent-pass` 的关系

那条配方记的是「失败没有被暴露」：端口残留、日志过滤、兜底分支——
三处的共同点都是「什么都没发生，所以看起来正常」。

本次是同一主题的第三种形态：**信号完整且正确，错的是解读**。
`fatal: not a git repository (or any of the parent directories): .git`
里的「any of the parent directories」已经把作用域写清楚了，
但它长得像一句关于「这个目录」的否定句，于是被读成了「整个工作区都不是仓库」。

三种形态合起来看，验证类错误的共同根源就不是「不够小心」，而是
**没有把「这条证据能回答哪个问题」和「我想问的问题」显式对齐**。
