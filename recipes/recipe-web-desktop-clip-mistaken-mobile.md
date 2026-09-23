---
id: recipe-web-desktop-clip-mistaken-mobile
title: 把「桌面布局的左半被裁」误认为「移动端渲染」
tags:
- web-verify
- headless
model: Deepseek-V4.1-Flash
problem: 在诊断页里依次测 390px 与 1280px 两个宽度，截图时 iframe 停在 1280，而外层容器只有 390px 宽且 overflow:hidden
  —— 看到的是「桌面布局被裁掉右边」，却当成移动端渲染来分析。
dead_ends:
- attempt: 在同一个 wrapper 里循环改 iframe 宽度，先 390 再 1280
  failure: 截图时 iframe 已停在 1280，外层 390px 容器把它裁掉右边；标题、胶囊看起来全被切断，误判为移动端排版问题
  duration: 30min
  early_signal: 被裁的位置恰好落在 390px 容器边界，而不是文字自身的自然换行点
- attempt: 据此给移动端加一系列换行/宽度修复
  failure: 真实 390px 渲染完全正常，改了半天没有对象
  duration: 25min
  early_signal: 应先用固定单宽度的 wrapper 复现一次，再做判断
solution: 一个诊断 wrapper 只测一个宽度；若必须复用，每次截图前显式重置 iframe 宽度并等待重排，且在报告里输出当前 clientWidth
  作为自证。
result: 改为单宽度 wrapper 后，390px 下的真实渲染显示标题两行完整、胶囊五行完整、导航含 GitHub 按钮，全部正常。
retrospective: 当「截图看起来坏了」时，先怀疑测量装置，再怀疑产品代码。本次 5 次视觉 bug 报告里有 3 次是装置问题。
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

在诊断页里依次测 390px 与 1280px 两个宽度，截图时 iframe 停在 1280，而外层容器只有 390px 宽且 overflow:hidden —— 看到的是「桌面布局被裁掉右边」，却当成移动端渲染来分析。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
