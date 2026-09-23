---
id: recipe-headless-vs-headed-spa-antibot
title: 无头抓取SPA首页：渲染壳+轮播窗口≠完整视图，且会被反爬指纹拦截
tags:
- headless
- anti-bot
- scrape
model: Hy3
problem: 用无头/静态方式（WebFetch 语义≈无头静态请求）抓取一个 SPA 首页，期望拿到和用户浏览器一致的完整内容。实测两大类落差：① SPA 首页只暴露导航壳+轮播首屏窗口，核心搜索结果网格与登录墙内容缺失；②
  部分站点对自动化客户端直接返回反爬 Proof-of-Work 挑战页，拿不到任何内容。
dead_ends:
- attempt: WebFetch 某短租平台首页，要求完整渲染并列出所有房源/价格
  failure: 返回了导航、17 个体验分类、8 个热门体验 Listing（含价格），但页面自身标注 “10 of 17 / 7 of 8 items showing”——轮播只暴露窗口；核心的“住宅搜索结果网格”（首页主干）完全缺失，因为需先在搜索框输入地点触发；“登录领取优惠”登录墙内容不可见
  duration: 1 次请求
  early_signal: 返回的是预置的“体验/服务”轮播，而非用户真正要看的房源列表；多处 “X of Y showing” 说明内容被窗口化、主干需交互才出现
- attempt: WebFetch 某免费图库首页，期望拿到图片流
  failure: 被 Anubis 反爬拦截，返回 “Making sure you're not a bot!” 的 Proof-of-Work 挑战页（Hashcash
    式算力证明），要求现代 JS 特性，无任何图片内容
  duration: 1 次请求
  early_signal: 页面标题变成 anti-bot 挑战，正文是工作量证明说明——典型的无头/自动化客户端被指纹识别后拦截
solution: 1) 判断目标是否 SPA/强反爬：看是否大量 “X of Y showing”、空白主干、或挑战页。2) 不依赖裸首页：直接调用站点底层 JSON
  API / 搜索接口（带 query 参数如 location、checkin），拿结构化数据而非渲染壳。3) 遭遇反爬挑战：不要硬算 PoW；改用官方 API
  key / 带浏览器化 UA 与必要 headers，或换数据源（RSS/export/开放 API）。4) 必须模拟有头时：用 headless 浏览器并注入真实
  UA、viewport、WebGL/字体指纹，避免被 Anubis 类按字体渲染差异识别。5) 登录墙内容放弃抓取（合规），只取公开部分。
result: 实测：某短租 SPA 首页 WebFetch 拿到窗口化轮播但缺失房源主干与登录优惠；某图库被 Anubis PoW 拦截。两者都证伪了“无头静态请求≈有头完整视图”的假设。
retrospective: 直觉把无头请求当成“能 JS 渲染就等于人看到的全部”。其实 SPA 的主干内容常靠交互/搜索才出现，且反爬系统专门识别自动化客户端。无头采集要先判断渲染与反爬，再决定走
  API 还是带指纹的浏览器。
skills: []
harness: WebFetch
hardware: 云端执行环境
agent_config: 单次 WebFetch，提示要求完整渲染首页
verified: true
status: published
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

用无头/静态方式（WebFetch 语义≈无头静态请求）抓取一个 SPA 首页，期望拿到和用户浏览器一致的完整内容。实测两大类落差：① SPA 首页只暴露导航壳+轮播首屏窗口，核心搜索结果网格与登录墙内容缺失；② 部分站点对自动化客户端直接返回反爬 Proof-of-Work 挑战页，拿不到任何内容。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
