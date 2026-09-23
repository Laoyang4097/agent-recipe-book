---
id: recipe-web-thumbnail-misjudge
title: 缩略图看走眼：同一现象连续误判三次「移动端文字被裁」
tags:
- web-verify
model: Deepseek-V4.1-Flash
problem: 从截图缩略图看，移动端副标题、胶囊像是被右边框切断，连续三轮回合都据此改了代码。
dead_ends:
- attempt: 看缩略图判断「文字被裁」并改 CSS
  failure: 改完再截仍然「像被裁」，来回三轮
  duration: 50min
  early_signal: 每次「被裁」的位置都紧贴缩略图边缘，而不是文字的语义断点
- attempt: 放大截图肉眼细看
  failure: 放大后仍难以确定是换行还是裁切
  duration: 10min
  early_signal: 肉眼分辨率不足以判断像素级归属，应换客观指标
solution: 用注入式探针取客观数据代替肉眼：document.documentElement.scrollWidth（是否横向溢出）、getComputedStyle(el).gridTemplateColumns（媒体查询是否生效）、el.getBoundingClientRect()（元素真实左右边界）、matchMedia().matches（断点是否命中）。
result: 390px 与 1280px 下 scrollWidth 均等于视口宽、overflow-x 为 visible、各关键元素 right 全部小于视口宽；超出的仅
  3 个元素且全是默认 translateX(100%) 收起的详情抽屉 —— 零溢出，三次判断全部推翻。
retrospective: 缩略图的字距、边缘、对比度都会骗人。视觉评估必须有客观测量兜底，否则会在「自己造的 bug」上反复消耗。
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

从截图缩略图看，移动端副标题、胶囊像是被右边框切断，连续三轮回合都据此改了代码。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
