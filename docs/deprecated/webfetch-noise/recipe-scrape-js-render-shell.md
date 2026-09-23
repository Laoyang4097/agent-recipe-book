---
id: recipe-scrape-js-render-shell
title: 抓JS动态站列表：静态请求只拿到外壳，命中SSR端点才出正文
tags:
- scrape
- headless
model: Hy3
problem: 想抓某社交媒体平台的热搜榜列表与某视频站的排行榜，直觉用 WebFetch 直接抓首页，期望拿到可枚举的条目列表。
dead_ends:
- attempt: WebFetch 抓某社交媒体平台首页，prompt 要'热搜榜条目（带排名）'。
  failure: 返回的是用户时间线/推荐微博（如王楚钦孙颖莎赛况、明星动态），并非热搜排名榜；热搜榜由独立 XHR 接口填充，不在首屏 SSR HTML 中。
  duration: 1 次抓取（数秒）
  early_signal: 输出是具体微博博文而非带序号/热度值的热搜词，没有排名。
- attempt: WebFetch 抓某短视频平台首页，prompt 要'推荐视频标题列表'。
  failure: 只返回 logo 与'下载APP/下载抖音看更多/下载AI抖音发起搜索'等图片与按钮，纯客户端渲染（CSR）外壳，零视频标题。
  duration: 1 次抓取（数秒）
  early_signal: 整页只有一张 base64 logo 和若干'下载'引导图，无任何视频条目文字。
solution: ① 区分'首屏 SSR 是否含列表'：先用 WebFetch 探首页，若拿到骨架/下载引导即判定为纯 CSR，需 headless 浏览器（Playwright/Puppeteer）等待渲染，或调用站点公开
  JSON API；② 目标列表常驻'专用 SSR 端点'：该社交平台热搜实际由 /top/summary 这类服务端渲染页提供，直接抓该端点即可拿到带排名+热度值的完整
  50 条，无需渲染；③ 视频站排行榜（如 B站 rank 页）首屏 SSR 已含完整 100 条，WebFetch 直接成功——并非所有'动态站'都需渲染，要逐页验证再决定是否上浏览器。
result: 命中社交平台热搜专用 SSR 端点后，一次抓取即得到 50 条带热度值的热搜词；视频站排行榜首屏即含 100 条，WebFetch 直出。纯 CSR
  的短视频首页则需 headless/API，WebFetch 无解。
retrospective: 动态站先探 SSR 端点再决定是否上 headless，别一上来就开浏览器烧资源。
skills:
- web-fetch
- ssr-endpoint-probing
- headless-fallback
- json-api
harness: WebFetch（只读）；建议 headless 浏览器作为 CSR 兜底
hardware: 云端托管抓取（无本地浏览器）
agent_config: model=Hy3；策略=先探测端点后渲染
verified: true
status: published
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

想抓某社交媒体平台的热搜榜列表与某视频站的排行榜，直觉用 WebFetch 直接抓首页，期望拿到可枚举的条目列表。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
