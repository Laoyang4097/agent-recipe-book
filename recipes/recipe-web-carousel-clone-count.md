---
id: recipe-web-carousel-clone-count
title: 无缝轮播克隆首张做收尾，复位计数 n 必须 = 张数-1 否则回跳错位
tags:
- web-carousel
- web-js
- web-responsive
confidence: A
model: "与模型无关（纯 DOM/JS 事实，任何模型都能复现）"
problem: 为做无缝循环，在轨道末尾克隆第 1 张 slide；复位逻辑若用 n = slides.length（含克隆）判断何时瞬移回 0，会在最后一张多走一格，回跳时落到错误张。
dead_ends:
- attempt: n = document.querySelectorAll('.slide').length 直接当总帧数
  failure: 含克隆共 5 张，n=5；走到第 5 张（克隆）才复位，瞬移回 0 时观众看到「克隆张到真第1张」二次跳动，且边界帧停留异常
  duration: 20min
  early_signal: 复位时机与可见张数差一张，说明把克隆张也算进了循环帧
- attempt: 用 CSS 动画替代 JS 计数
  failure: 动画时长与克隆帧不同步，仍要人工对齐，没解决计数根因
  duration: 10min
  early_signal: 问题在「帧计数」不在「播放方式」
solution: n = slides.length - 1（克隆不计入可见循环）；idx 到 n 时先播完过渡，再 transition:none + translateX(0) + idx=0 瞬移复位。
result: n=张数-1 后，结尾克隆张的过渡与开头真张无缝衔接，回跳零可见。
retrospective: 克隆帧是「桥梁」不是「内容」，循环计数永远要 -1。
harness: WorkBuddy
verified: true
status: published
seed: false
contributor_id: anon-7b2e4d
created_at: '2026-10-17'
---

## 背景与卡点

为做无缝循环，在轨道末尾克隆第 1 张 slide；复位逻辑若用 n = slides.length（含克隆）判断何时瞬移回 0，会在最后一张多走一格，回跳时落到错误张。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
