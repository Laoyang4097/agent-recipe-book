---
id: recipe-scrape-pagination-dedup
title: 翻分页列表：用错page参数静默重复首页，offset步长不对边界重叠
tags:
- scrape
- pagination
model: Hy3
problem: 抓某电影榜单（Top250）这类带分页的公开列表并翻 3 页，直觉用常见 ?page=N 翻页，再合并去重得到完整榜单。
dead_ends:
- attempt: 用 ?page=2 翻第 2 页（沿用多数 CMS 的 page 参数习惯）。
  failure: 服务端忽略 page 参数，返回与第 1 页完全相同的 25 条（首条仍是 rank#1 肖申克的救赎），造成静默整页重复；若直接 append
    会污染数据集 25 条重复。
  duration: 1 次抓取（数秒）
  early_signal: 本页第一条仍是'肖申克的救赎'(排名1)，而非预期的排名26，说明 page 未生效。
- attempt: 改用 ?start=10 试探偏移（误以为每页 10 条）。
  failure: 实际每页 25 条，start=10 返回排名 11–35，与第 1 页(1–25)在 11–25 区间重叠 15 条，产生边界重复。
  duration: 1 次抓取（数秒）
  early_signal: 本页从排名11开始，与首页尾部 11–25 重复。
solution: ① 先抓一页并解析真实分页控件：该站用 start= 偏移、页大小 25，规律为 start=(page-1)*25；② 永远用稳定 item
  id（本例为影片 subject URL 或排名）做集合去重后再 append，杜绝 page 参数失效导致的整页重复；③ 即便 offset 正确，对实时/无限滚动列表也要按
  id 去重，因为插入式更新会造成边界重叠；④ 翻页间隔加延时，规避反爬/验证码。
result: 用 start=(page-1)*25 翻 3 页(start=0/25/50)得到排名 1–75 连续无重叠的 75 部电影；对比实验证明 ?page=2
  会静默返回首页、?start=10 会重叠 15 条。
retrospective: 分页先看控件再翻页，合并前必按 id 去重——'page 参数失效'比 403 更阴险，因为它不报错。
skills:
- web-fetch
- pagination-probing
- offset-calc
- id-dedup
harness: WebFetch（只读）
hardware: 云端托管抓取（无本地浏览器）
agent_config: model=Hy3；策略=先验证分页控件
verified: true
status: published
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

抓某电影榜单（Top250）这类带分页的公开列表并翻 3 页，直觉用常见 ?page=N 翻页，再合并去重得到完整榜单。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
