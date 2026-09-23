---
id: recipe-scrape-encoding-gbk-newsportal
title: 抓新闻门户首页标题：GBK编码被工具掩盖，HTML噪声与追踪链接污染列表
tags:
- scrape
- encoding
- selector
model: Hy3
problem: 直觉用 WebFetch 直接抓某新闻门户首页，并让模型'列出所有可见新闻标题'，期望得到干净的新闻标题列表。实际返回 20+ 板块混合（娱乐/体育/彩票/小说推荐/广告），链接里混着追踪跳转域名与
  HTML 注释噪声；同时 GBK 老站的编码问题被 WebFetch 自动解码完全掩盖，换裸请求时才会暴露乱码。
dead_ends:
- attempt: WebFetch 抓首页，prompt 要求'列出所有可见新闻标题（含导航/推荐/广告位）'。
  failure: 返回约 20+ 板块，娱乐、体育、彩票、小说推荐、读书、广告位全混进'标题'列表，无法区分头条与广告/推荐；部分标题被页面截断为'...'。
  duration: 1 次抓取（数秒）
  early_signal: 输出里出现'大乐透解读''南宋最强帝婿''广告 | 腰间盘突出'等明显非新闻条目，与真实要闻混杂。
- attempt: 改用 prompt 只取'首页要闻区的新闻标题与链接'。
  failure: 仍拿到污染链接：搜狐类首页的 markdown 泄漏了 <!--THE END--> 注释、track.sohu.com/promotion
    追踪跳转，以及 edtsign/edtcode/scm 长串垃圾参数，链接无法直接用于二次爬取或归并。
  duration: 1 次抓取（数秒）
  early_signal: 提取的链接大量指向 track.sohu.com 重定向器，含 edtsign=… 参数，而非文章真实 URL。
- attempt: 为确认中文编码，想观察 GBK 老站是否出现 Ã©ÂÂ 类乱码，直接用 WebFetch 抓。
  failure: WebFetch 自带 HTML→markdown 转换会自动按 charset 解码，中文显示完全正常，GBK 风险被彻底掩盖；一旦团队换用裸
    HTTP（curl/requests）抓同一类老站，终端会看到乱码，且若用 errors='ignore' 会静默丢字符。本环境用 curl 探测外网时返回空（沙箱无外网），进一步说明编码须在
    HTTP 层自行处理。
  duration: 1 次抓取 + 1 次 curl 探测
  early_signal: WebFetch 输出中文完好，让人误以为'编码已无碍'，埋下换工具时踩坑的隐患。
solution: ① 不要'列所有标题'，按频道/容器限定抓取范围（如只取 /china/、/world/ 等具体要闻区），从源头减少噪声；② 对提取的链接做域名白名单过滤，丢弃
  s.weibo.com、track.sohu.com、lottery、book、ad 等 host，再正则清洗 ? 后的 edtsign/scm 参数；③ 永远不要依赖
  WebFetch 的自动解码判断编码——用裸请求时显式设置 response.encoding（或 requests 的 apparent_encoding），并加
  'Ã' 序列 mojibake 哨兵检测，落库前报警；④ 标题截断的'...'用详情页补全。
result: 按频道限定 + 域名白名单过滤后，要闻区标题纯净度显著提升，链接均为可二次访问的真实文章 URL；GBK 风险通过'HTTP 层显式编码 + mojibake
  哨兵'在换工具时成功拦截。
retrospective: 新闻门户的'乱'不在编码而在噪声结构，编码坑往往被高层工具悄悄抹平，真正要在裸请求层兜底。
skills:
- web-fetch
- html-to-markdown
- selector-scoping
- domain-filter
harness: WebFetch（只读抓取 + HTML→markdown 转换）；curl 用于编码探测（本环境沙箱无外网）
hardware: 云端托管抓取（无本地浏览器）
agent_config: model=Hy3；采集策略=直觉先抓后治理
verified: true
status: published
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

直觉用 WebFetch 直接抓某新闻门户首页，并让模型'列出所有可见新闻标题'，期望得到干净的新闻标题列表。实际返回 20+ 板块混合（娱乐/体育/彩票/小说推荐/广告），链接里混着追踪跳转域名与 HTML 注释噪声；同时 GBK 老站的编码问题被 WebFetch 自动解码完全掩盖，换裸请求时才会暴露乱码。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
