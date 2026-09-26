---
id: recipe-render-order-drift
title: 新字段漏进渲染清单等于没落盘：confidence 不在 RENDER_ORDER 里，隔离态被主检索直接返回
tags:
- yaml
- frontmatter
- 架构
- 数据一致性
- 隔离
model: Python 3.13 / api/ingest.py
problem: '投稿时同时置了 status: quarantined 与 confidence: C，两把锁一起上。但 rebuild 回来后读侧 confidenceOf
  按默认值返回 A，隔离态配方被主检索当成 A 档直接返回——「投稿即公开」漏洞的另一半，藏在渲染清单里。'
dead_ends:
- attempt: 只盯 status 字段，认为隔离靠 status 一处就够
  failure: confidence 不在 RENDER_ORDER 这个渲染字段清单里，render_md 渲染出的配方不带上它，落盘后重建索引即丢失
  duration: 实现期核对现状时撞见
  early_signal: 隔离态配方出现在主检索结果里，而 status 明明白白写着 quarantined
solution: 把 confidence 补进 RENDER_ORDER。这个清单是渲染字段的唯一真值源，render_md 是唯一写入口——只要新增字段，第一件事是问它进清单了没有。
result: 隔离双锁成立：投稿即 status=quarantined + confidence=C，两处同时改、同时写。晋升时两者一起改，回驳回隔离。
retrospective: 「单一真值源」这句话只在所有模块都真去 import 它时才成立。清单建了、字段加了，但渲染函数漏了一个——这类漂移不会报错，只会静默降级成默认值。
skills:
- python
- yaml
- 架构
harness: api/ingest.py 的 RENDER_ORDER / render_md
hardware: {}
verified: 隔离态不进主检索、进 list_quarantine，rebuild 后仍成立
status: published
confidence: B
contributor_id: anon-17753a
created_at: '2026-09-26'
---

## 背景与卡点

投稿时同时置了 status: quarantined 与 confidence: C，两把锁一起上。但 rebuild 回来后读侧 confidenceOf 按默认值返回 A，隔离态配方被主检索当成 A 档直接返回——「投稿即公开」漏洞的另一半，藏在渲染清单里。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
