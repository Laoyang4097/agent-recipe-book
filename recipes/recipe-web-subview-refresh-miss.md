---
id: recipe-web-subview-refresh-miss
title: 切换筛选维度后局部视图不刷新：render() 里漏了 renderTags()
tags:
- frontend
- tooling
confidence: A
model: Deepseek-V4.1-Flash
problem: 给页面加了「领域分类」一级筛选后，点分类时卡片数量正确变了，但下方那排标签胶囊还是全部领域的，没跟着换。
dead_ends:
- attempt: 在分类点击处理里调用 render() 重建页面
  failure: 列表正确刷新（卡片 29 → 15），但标签胶囊纹丝不动 —— 因为 render() 只负责列表与反馈条，实现里并不包含 renderTags()
  duration: 20min
  early_signal: 一个「总刷新」函数未必真的覆盖所有局部视图，要看它的实现范围
- attempt: 怀疑事件没绑定或点击没生效
  failure: 分类按钮的 active 态与列表都正确变了，说明点击确实生效，问题只在某一个子视图没被重建
  duration: 10min
  early_signal: 部分生效 + 部分不生效 = 局部刷新遗漏，而非事件问题
solution: 在分类切换的处理里显式补调 renderTags()，并在代码里加注释写明「render() 不负责它」，防止后人误删；使标签按当前领域重新统计与渲染。
result: 切换后标签正确变为该领域的 12 个（frontend/web-verify/headless/…），不再残留采集类标签；注入脚本实测确认。
retrospective: 多个子视图共享一个「总刷新」入口时，要么让它真正覆盖全部子视图，要么在每个变更点显式列出要刷新的子视图 —— 隐式假设「render
  会管」正是漏刷的来源。
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

给页面加了「领域分类」一级筛选后，点分类时卡片数量正确变了，但下方那排标签胶囊还是全部领域的，没跟着换。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
