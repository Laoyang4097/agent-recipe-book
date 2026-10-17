---
id: recipe-web-bg-position-noop-mobile
title: 移动端 cover 下 background-position 是空操作，须改用 background-size:auto 放大造出余量
tags:
- web-responsive
- web-background
- web-mobile
confidence: A
model: "与模型无关（纯 CSS/布局事实，任何模型都能复现）"
problem: 移动端竖屏容器对 4:3 背景图用 background-size:cover 后，竖直方向已无溢出余量，background-position:center 78% 之类的纵向定位完全不生效，想要「取景下移露产品」做不到。
dead_ends:
- attempt: 移动端加 background-position:center 78% 想把产品下移露出
  failure: cover 已在竖直方向撑满容器，纵向 0 余量，position 的纵向分量无处可移，图纹丝不动
  duration: 25min
  early_signal: position 生效前提是对应轴有溢出余量，cover 把余量吃光了
- attempt: 改 background-attachment 或加 padding 撑高
  failure: 撑高破坏布局，attachment 不改变取景，治标不治本
  duration: 15min
  early_signal: 根因是「没有余量可移」而非「定位写错」
solution: 移动端改用 background-size:auto 168%（横向撑满后纵向留 68% 余量），再用 background-position:center 78% 纵向取景；余量存在后 position 才生效。
result: auto 168% + position 78% 后，移动端竖屏成功把产品区框进可视带，水印/边角被自然推出视野。
retrospective: background-position 是「有余量才动」的相对位移；cover 吃光余量时它必失效，先造余量（auto 放大）再定位。
harness: WorkBuddy
verified: true
status: published
seed: false
contributor_id: anon-7b2e4d
created_at: '2026-10-17'
---

## 背景与卡点

移动端竖屏容器对 4:3 背景图用 background-size:cover 后，竖直方向已无溢出余量，background-position:center 78% 之类的纵向定位完全不生效，想要「取景下移露产品」做不到。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
