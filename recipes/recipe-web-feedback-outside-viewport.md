---
id: recipe-web-feedback-outside-viewport
title: 搜索结果在视口外且无即时反馈：用户以为按钮坏了
tags:
- frontend
- ux
confidence: A
model: Deepseek-V4.1-Flash
problem: 搜索框在页面上部、结果列表在页面下部，点检索后页面纹丝不动，使用者判断「按钮没反应」，必须手动往下翻才发现筛选已生效。
dead_ends:
- attempt: 只在控制台确认 render 被调用、数据确实变了
  failure: 从代码视角一切正常，但用户完全感知不到 —— 反馈发生在视野之外
  duration: 10min
  early_signal: 「功能生效」和「用户知道功能生效了」是两个独立的验收项
- attempt: 加一个页面底部的提示条
  failure: 位置太靠下，仍在视口外，等于没加
  duration: 5min
  early_signal: 反馈元素必须落在当前视口内，位置比文案更重要
solution: 三件套：① 在搜索框正下方（用户当前视野内）放即时反馈条，显示「筛出 N 条 + 跳到结果 ↓」，任何筛选变化立刻更新，并用 aria-live
  播报；② 点「检索」或回车这类明确的「我要看结果」动作时，平滑滚动到结果区；③ 给滚动目标加 scroll-margin-top 避开 sticky 头部。
result: 注入脚本模拟输入后，反馈条立即显示「筛出 3 条配方 · 跳到配方列表 ↓」；点击检索后页面滚到结果区，视口内直接看到「匹配 3 条」与三张卡片。
retrospective: 反馈必须出现在用户当前的视野里。结果在下方，就要么把反馈搬到上面，要么把人带到下面 —— 不能指望用户自己找。
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

搜索框在页面上部、结果列表在页面下部，点检索后页面纹丝不动，使用者判断「按钮没反应」，必须手动往下翻才发现筛选已生效。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
