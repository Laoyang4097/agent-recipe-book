---
id: recipe-web-wcag-muted-contrast
title: 次级灰字对比度只有 3.06:1：看着「还行」实则不达 WCAG AA
tags:
- design-system
- a11y
model: Deepseek-V4.1-Flash
problem: 页面上的说明性小字（如统计项下方的解释文字）看着发飘、读不清，但肉眼判断不出到底合不合格。
dead_ends:
- attempt: 靠肉眼比较几个灰色，凭感觉调
  failure: 调完仍不确定是否达标，且容易把层级关系调乱
  duration: 10min
  early_signal: 对比度是可计算的量，不该用感觉判断
- attempt: 只检查主文字色
  failure: '主文字 5.9:1 合格，但次级色 #8b94a3 实测只有 3.06:1，小字号要求 ≥4.5:1，实际不达标'
  duration: 15min
  early_signal: 越是「次要」的色越容易被漏检，而它们恰恰是最容易不达标的
solution: '按 WCAG 相对亮度公式逐个色值计算对比度，把不达标的次级色调深：--muted-2 从 #8b94a3 改为 #6b7686，白底对比度
  3.06:1 → 4.60:1，达到正文 4.5:1 的要求。'
result: 全套色值实测：主文字 6.00:1、强调蓝 6.67:1、次级文字 4.60:1，全部通过 WCAG AA；可读性肉眼可见提升。
retrospective: 对比度要用公式算，不能目测。一个「看着还行」的灰，很可能正好卡在 3:1 附近而不自知。
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

页面上的说明性小字（如统计项下方的解释文字）看着发飘、读不清，但肉眼判断不出到底合不合格。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
