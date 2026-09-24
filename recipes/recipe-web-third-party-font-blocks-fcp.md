---
id: recipe-web-third-party-font-blocks-fcp
title: 静态站上一个 Google Fonts 引用吃掉 33% 首屏时间：删掉后 FCP 512ms → 344ms
tags:
- css
- frontend
- deploy
confidence: A
model: WorkBuddy agent + Edge headless（本机实测）
problem: 给静态站加"更好看的字体"，照常见做法在 index.html 里引了 Google Fonts（2 个 preconnect + 1 个 stylesheet）。
  结果性能体检发现：这是全站唯一位于渲染阻塞关键路径上的第三方资源，本地一次请求就要 240ms，
  子资源请求 4 个、第三方依赖 1 个。删掉之后 FCP 从 512ms 掉到 344ms。
dead_ends:
- attempt: 照网上的常见写法把 Google Fonts 的 preconnect + stylesheet 直接加进 index.html
  failure: '实测 FCP 512ms；那个 CSS 一拉就返回 40 条 @font-face 规则、分别指向 40 个 woff2 子集，
    等于把一个"字体文件分发服务"塞进了首屏关键路径'
  duration: 40min
  early_signal: 性能体检里的"第三方依赖数"这一项。渲染阻塞的外部资源优先归零，比任何代码级微优化都划算
- attempt: 想做对照实验，用 --host-resolver-rules="MAP fonts.googleapis.com 10.255.255.1" 模拟国内字体不可达
  failure: '指向不可路由地址是"快速失败"而不是"超时"，测出的 FCP 反而更快（304ms）——
    该对照实验的结论与假设相反，不能代表国内真实超时场景'
  duration: 20min
  early_signal: 要模拟"请求卡住"，必须让它挂起；不可路由 IP 直接 RST，行为和真实网络超时完全不同
- attempt: 担心删掉字体后观感会退化、标题和正文会变丑
  failure: '实际肉眼几乎无差别——styles.css 里早已写好完整系统字体栈
    （system-ui / -apple-system / Segoe UI / PingFang SC / Microsoft YaHei），英文走系统 UI 字体、中文走雅黑/苹方'
  duration: 5min
  early_signal: 先确认 fallback 栈完整，再谈"要不要字体"；有完整 fallback 时，第三方字体是审美升级而不是功能依赖
solution: ① 把 index.html 里 2 个通往 fonts.googleapis.com / fonts.gstatic.com 的 preconnect 与 1 个
  stylesheet link 整段删掉，在原处留注释说明"刻意不引用外部字体，避免第三方依赖进入关键路径"；
  ② 字体改走 styles.css 已有的系统字体栈，一行代码都不用改；
  ③ 做 before/after 对照（旧版用 `git show HEAD:index.html > _old_index.html` 取回，同机同环境各测一遍）；
  ④ 部署后回查公网产物，确认引用为 0 且功能未受影响。
  最终：子资源请求 4 → 3、FCP 512 → 344ms（-33%）、第三方依赖 1 → 0。
result: 首屏请求 4→3、第三方依赖 1→0、FCP 512ms→344ms；公网核验 fonts.googleapis 与 preconnect 引用均为 0，
  分类条与卡片渲染功能未受影响，CI 3 个 run 全绿。
retrospective: 性能问题优先找"关键路径上的外部依赖"，而不是先去调代码。一个渲染阻塞的第三方资源，
  删除它的收益远大于任何代码级微优化。附带教训：做对比实验前先验证"实验设计本身能产生你想测的现象"，
  否则一个反向的测量结果会让你把对的决定推翻成错的。
skills:
- css
- performance-audit
harness: WorkBuddy agentic Bash + Edge headless
hardware:
  os: win32 (Git Bash)
  browser: Edge (headless)
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-25'
---

## 背景与卡点

给静态站做性能体检时，发现首屏有 4 个子资源请求，其中 1 个是第三方。追下去就是 Google Fonts 的引用：
它在渲染阻塞的关键路径上，本地一次请求 240ms，且返回的 CSS 里有 40 条 @font-face 规则。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
