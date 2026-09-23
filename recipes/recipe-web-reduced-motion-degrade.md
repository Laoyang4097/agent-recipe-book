---
id: recipe-web-reduced-motion-degrade
title: 平滑滚动变「闪现」：prefers-reduced-motion 把位移降级了
tags:
- frontend
- a11y
model: Deepseek-V4.1-Flash
problem: 用户反馈点检索后是「闪现」到列表、没有过渡，怀疑是动画写错。
dead_ends:
- attempt: 怀疑 scrollIntoView 的参数写错 / CSS scroll-behavior 未生效
  failure: 代码与 CSS 都正确，但实测仍是瞬时跳转
  duration: 20min
  early_signal: '注入探针回读 matchMedia(''(prefers-reduced-motion: reduce)'').matches =
    true，根因在用户系统设置而非代码'
- attempt: 为「尊重系统设置」而把落点提示也一并禁掉
  failure: 用户既失去平滑滚动，也失去结果位置提示，体验反而更差
  duration: 10min
  early_signal: 位移类动画与颜色类变化应分开对待，前者才属于前庭刺激
solution: ① 显式控制滚动行为：读取 prefers-reduced-motion，reduce 时用 behavior:'auto'，否则 'smooth'，不依赖
  CSS 传递；② 落点提示改为始终执行 —— 它是纯颜色脉冲、无任何位移，不构成前庭刺激，反而是位移被降级后的必要定位补偿；③ 在 reduced-motion
  媒体查询段里为它开例外，否则会被全局的 animation:none 一起禁掉。
result: 实测落点提示在 120ms 时 class=true 正常触发；在 reduce=true 环境下用户也能明确看到结果落在哪里。
retrospective: 尊重 prefers-reduced-motion 不等于什么都不做。要区分「位移类动画」（该禁）与「颜色/透明度变化」（可留），后者往往是前者被降级后的必要补偿。
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

用户反馈点检索后是「闪现」到列表、没有过渡，怀疑是动画写错。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
