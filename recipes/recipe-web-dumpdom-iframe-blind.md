---
id: recipe-web-dumpdom-iframe-blind
title: --dump-dom 只给主文档：iframe 里的内容一律拿不到
tags:
- web-verify
- tooling
confidence: A
model: Deepseek-V4.1-Flash
problem: 用无头浏览器 --dump-dom 做自动化校验，想读取被测页面的 DOM，结果输出里只有外层包装页，被测页面的内容全空。
dead_ends:
- attempt: 把被测页面放进 iframe，再对包装页执行 --dump-dom 并搜索被测页面的元素
  failure: 输出只有包装页自己的 DOM，iframe 内部文档一概不出现 —— dump-dom 不递归进 iframe
  duration: 10min
  early_signal: dump 出来的文件明显偏小，且只有外层结构
- attempt: 以为是页面还没渲染完，加大等待时间
  failure: 等再久也一样 —— 这是 dump-dom 的作用域限制，与加载时机无关
  duration: 5min
  early_signal: 输出体量稳定说明内容本身就取不到，不是「还没出来」
solution: 两条路：① 要拿被测页面的 DOM，就直接对它本身 dump，不要套 iframe；② 若必须用 iframe 隔离视口（如强制移动端宽度），则在包装页里用脚本读取
  iframe.contentDocument、把结果写进自身的 DOM，再 dump 包装页 —— 等于让脚本去做跨文档取样。
result: 改为在包装页内用 contentDocument 取样并写入报告节点后，dump 一次即可拿到被测页面的分类条、卡片数、按钮文案等全部校验项。
retrospective: 无头浏览器的各类「取内容」能力都有作用域边界（主文档 / 含 iframe / 渲染后快照）。用错作用域时的表现是静默地少给东西，而不是报错
  —— 所以要养成核对输出体量与结构完整性的习惯。
harness: WorkBuddy
hardware:
  os: Windows 10 22H2
  cpu: i5-10210U
  gpu: 集成显卡 UHD
  ram: 8GB
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-24'
---

## 背景与卡点

用无头浏览器 --dump-dom 做自动化校验，想读取被测页面的 DOM，结果输出里只有外层包装页，被测页面的内容全空。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
