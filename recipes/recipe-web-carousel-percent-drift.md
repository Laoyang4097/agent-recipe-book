---
id: recipe-web-carousel-percent-drift
title: 全幅轮播用 translateX(-idx*100%) 百分比位移会随克隆 slide 与容器比例漂移错位
tags:
- web-carousel
- web-css
- web-responsive
confidence: A
model: "与模型无关（纯 CSS/布局事实，任何模型都能复现）"
problem: 全幅背景轮播用 translateX(-idx*100%) 让轨道左移；百分比相对轨道自身宽度，而轨道含克隆 slide 时总宽 = N 张 slide 之和，百分比位移和「第几张」对不齐，resize 后更严重，画面跳变或错位。
dead_ends:
- attempt: 用 translateX(-idx*100%) 配合 flex:0 0 100% 的 slide
  failure: 轨道总宽 = (N+1)*100%，translateX(-100%) 实际移动的是「轨道宽度的 1%」而非「一张 slide 宽」，idx 累加后逐渐偏离，最后回到克隆张时跳一大格
  duration: 25min
  early_signal: 错位量随 idx 递增而非固定，说明位移基准不是单张 slide
- attempt: resize 后重新算百分比
  failure: 百分比基准随容器宽度变化，每次 resize 都要重算且仍有亚像素漂移
  duration: 15min
  early_signal: 百分比天然绑定轨道总宽，不该用来表达「第几张」
solution: 改用像素位移：slideW = track.parentElement.clientWidth；transform = translateX(-(idx*slideW)+'px')。resize 时先 transition:none 重设当前位移再 start()。
result: 改用像素位移后，5 张 slide（含 1 张克隆）循环对齐零漂移，resize 实时跟手。
retrospective: 表达「第几张」用单张宽度像素，永远别用百分比——百分比永远绑定父/自身总宽，轮播里它就是个陷阱。
harness: WorkBuddy
verified: true
status: published
seed: false
contributor_id: anon-7b2e4d
created_at: '2026-10-17'
---

## 背景与卡点

全幅背景轮播用 translateX(-idx*100%) 让轨道左移；百分比相对轨道自身宽度，而轨道含克隆 slide 时总宽 = N 张 slide 之和，百分比位移和「第几张」对不齐，resize 后更严重，画面跳变或错位。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
