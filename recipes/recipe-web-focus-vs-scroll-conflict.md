---
id: recipe-web-focus-vs-scroll-conflict
title: input.focus() 与滚动到结果打架：焦点把视口又拽回搜索框
tags:
- frontend
- ux
model: Deepseek-V4.1-Flash
problem: 加上「点检索后滚动到结果区」之后，点击按钮却总是先跳回搜索框再滚动，行为互相拉扯。
dead_ends:
- attempt: 保留按钮回调里的 input.focus()（原本用于方便继续输入）
  failure: 聚焦会触发浏览器把该元素滚入视野，与「滚动到结果列表」方向相反，两个滚动相互抵消
  duration: 15min
  early_signal: 焦点调用本身就是一次隐式滚动，与显式滚动放一起必然冲突
- attempt: 调大 scrollIntoView 的延时，期望后执行者胜出
  failure: 时序只是掩盖冲突，实际仍会看到跳动
  duration: 8min
  early_signal: 用延时解决两个相反意图的冲突不可靠
solution: 移除滚动类操作里的 input.focus()。若确实需要保留输入便利性，应改为不触发滚动的聚焦方式，或把「继续输入」与「查看结果」做成两个明确不同的动作。
result: 去掉 focus() 后，点检索只发生一次滚动，稳定落到结果区。
retrospective: 任何主动 focus() 都是一次隐式的滚动请求。它和滚动逻辑放在一起时，必须先想清楚谁说话。
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

加上「点检索后滚动到结果区」之后，点击按钮却总是先跳回搜索框再滚动，行为互相拉扯。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
