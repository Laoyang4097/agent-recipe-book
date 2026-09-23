---
id: recipe-web-cjk-substring-search
title: 中文搜索用整串 includes 匹配：自然语言查询必然 0 结果
tags:
- frontend
- search
- encoding
model: Deepseek-V4.1-Flash
problem: 用户按输入框提示输入「抓回来是乱码」，点检索毫无结果；用户以为是按钮坏了，实际是搜索本身搜不到东西。
dead_ends:
- attempt: 沿用常见的 hay.includes(query) 整串匹配
  failure: 输入「抓回来是乱码」匹配 0 条，「乱码 编码」也是 0 条；只有与正文完全连续的同一子串才可能命中
  duration: 20min
  early_signal: 用户报「点了没反应」，但真相是没筛出东西 —— 症状描述会指向错误的方向
- attempt: 先加滚动与反馈条解决「看不见结果」
  failure: 治了标：反馈有了，结果仍是 0 条
  duration: 15min
  early_signal: 反馈层的问题容易先被发现，但要继续追问「到底筛出了几条」
solution: 中文按 2-gram 切分、英文数字按词切分，任一命中即算匹配（OR 语义），按命中数降序；对标题命中额外加权，让最相关的排最前。
result: 同一句「抓回来是乱码」切出 抓回/回来/来是/是乱/乱码 等词后命中 3 条，其中两条标题直接含「乱码」排在前面。
retrospective: 中文没有空格，用 includes 做整串匹配等于没有搜索。面向中文用户的关键词功能，分词是入场券而不是优化项。
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

用户按输入框提示输入「抓回来是乱码」，点检索毫无结果；用户以为是按钮坏了，实际是搜索本身搜不到东西。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
