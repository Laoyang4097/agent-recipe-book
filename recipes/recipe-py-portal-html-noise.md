---
id: recipe-py-portal-html-noise
title: requests 抓某新闻门户首页：导航/平台入口/广告噪声占七成，正则取 <a> 当标题不可用
tags:
- scrape
- selector
model: Agent+Python requests
problem: 用 requests 抓某新闻门户首页想提取文章标题，结果一个页面上 649 个链接里只有约 30% 像文章，大量导航、平台入口、广告位、多频道入口和重复模板混在一起，用正则或『抓所有
  <a>』根本分不出正文。
dead_ends:
- attempt: 正则抓所有 <a>...</a> 的文字当文章标题
  failure: 200 条带文字的链接里，排前面的全是导航/平台入口而非新闻：如 '828企业服务平台'、'灵境·人民艺术馆'、'中组部12380举报网'、'传播内容认知全国重点实验室'；真正新闻标题被彻底淹没
  duration: 1 次抓取 0.1s + 正则清洗（实测该门户响应极快）
  early_signal: a_with_text=200，但前 12 条样本里 0 条是新闻标题，全是机构/平台入口
- attempt: 用『链接总数』估算文章数（把 total_href 当条目数）
  failure: total_href=649 严重虚高：真正 article_like（URL 含 /20xx/ 日期段）仅 194 条（29.9%），nav_like
    150 条，external 605 条 —— 直接当文章数会有约 3 倍误差
  duration: 秒级
  early_signal: Top hosts 是 finance/world/opinion/ent 等 5 个子频道域名，说明多频道入口全混在一页
- attempt: 忽略 script/style，直接把整页 HTML 丢进清洗
  failure: script+style 占 HTML 字节 21.6%（noise_ratio=0.216），页面含 33 个 <script>、9 个 <style>、143
    个 <img>、229 个 <div>；不剥离则正文与 JS/CSS 混作一团
  duration: 秒级
  early_signal: count_script=33、script_bytes=19513，噪声占比 >20%
solution: 可跑要点：① 先用 URL 模式筛『文章』而非抓全部 <a>——本例文章 URL 含日期段，正则如 `/\d{4}/\d{2}-\d{2}/`
  或 `/20\d{2}/`，可把 649 条压到 194 条候选。② 限定域名/频道前缀（如只取 www 主站的栏目路径），排除子频道与其他机构外链。③ 先剥离
  <script>/<style>/<iframe> 再解析。④ 对重复链接文本去重（实测有 8 组重复模板文本）。⑤ 生产环境建议改用解析器 + 容器选择器按列表区块取条目，别全文正则。
result: 对某新闻门户首页实测：HTML 113637 字节、649 个链接；按日期段过滤得 article_like=194（29.9%），nav_like=150，external=605，重复链接文本
  8 组；script+style 占 21.6%。正则取 <a> 无法定位正文，必须用 URL 模式过滤 + 去重。
retrospective: 门户首页不是『一页文章』而是一张导航地图：链接数 ≠ 文章数（本例虚高 3 倍）。先定型 URL 再写解析，比先写正则再打补丁省事得多；另外该门户同样命中
  r.encoding=ISO-8859-1 / apparent=utf-8 的编码坑，取 r.text 前要修编码。
harness: Python requests
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

用 requests 抓某新闻门户首页想提取文章标题，结果一个页面上 649 个链接里只有约 30% 像文章，大量导航、平台入口、广告位、多频道入口和重复模板混在一起，用正则或『抓所有 <a>』根本分不出正文。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
