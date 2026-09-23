---
id: recipe-py-pagination-ignored-param
title: 分页靠路径数字：?page=2 被静默忽略仍返回第1页，跨页还有约17.8%重复需去重
tags:
- pagination
- scrape
model: Agent+Python requests
problem: 用 requests 抓某新闻门户『滚动新闻』列表翻 3 页时发现：改用 ?page=2 这类查询参数后服务端仍返回 HTTP 200、没有任何报错，内容却和第
  1 页一模一样——分页被静默忽略。正确分页其实靠 URL 路径里的数字（/scroll-news/news1.html…newsN.html）。
dead_ends:
- attempt: 用查询参数翻页：分别试 ?page=2、?pageNo=2、?p=2、?offset=30
  failure: 四种参数全部 status=200、响应长度 len=93693，且内容集合与第 1 页 identical_to_page1=true、overlap=133/133
    —— 参数被静默忽略，仍然返回第 1 页，无任何错误码或告警
  duration: 4 次请求，每次 ~0.1-0.5s
  early_signal: 响应长度与第 1 页字节完全一致（93693），状态码恒为 200，无法靠状态码区分
- attempt: 把 3 页条目直接拼接后入库，不做去重
  failure: 3 页 sum_naive=393 条，去重后 union_unique=323 条，dup_rate=0.178（约 17.8% 重复）；且
    p1∩p2、p2∩p3、p1∩p3 三组两两重叠均恒为 35 条，疑似每页都插入了同一块固定推荐模块
  duration: 3 次请求 + 集合比对
  early_signal: 任意两页重叠数恒等 35，说明重复不是随机边界，而是固定复用模块
- attempt: 以『返回 200 即翻页成功』为准，不校验内容是否变化
  failure: 被忽略的 ?page=2 同样返回 200 与完整 HTML，肉眼扫一眼难以发现；必须把每页 URL 提取成集合做签名比对，才发现返回的是同一页
  duration: 秒级
  early_signal: 所有翻页请求 status 均 200，长度相同
solution: 可跑要点：① 先确认分页形态——爬页面里『下一页』的锚点规律（本例为 /scroll-news/news{N}.html，纯路径数字），别想当然用
  ?page=。② 每页提取条目 URL 做集合签名；若换参数后集合相等即判定『参数被忽略』，别信状态码。③ 入库前对全部 URL 做跨页去重（本例重叠 17.8%，且含固定复用模块），推荐用
  set 或 URL 哈希。④ 固定复用/推荐模块可先按『在多页恒定出现』的特征识别并剔除。
result: 对某新闻门户滚动列表实测：正确路径页 news1/2/3.html 分别 133/129/131 条，去重后 union=323 条；?page=2、?pageNo=2、?p=2、?offset=30
  四种参数全部被静默忽略（identical_to_page1=true）；两两页重叠恒为 35 条，整体重复率 17.8%。
retrospective: 分页有几件事永远别假设：翻页参数名、参数是否生效、页间是否重复。最稳的做法是『换一页→比对条目集合是否变化』来验证参数真的生效，再靠
  URL 集合去重。这个门户接口对无效参数一律 200 且不报错，属于典型的静默失败，只有内容比对能抓到。
harness: Python requests
verified: true
status: published
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

用 requests 抓某新闻门户『滚动新闻』列表翻 3 页时发现：改用 ?page=2 这类查询参数后服务端仍返回 HTTP 200、没有任何报错，内容却和第 1 页一模一样——分页被静默忽略。正确分页其实靠 URL 路径里的数字（/scroll-news/news1.html…newsN.html）。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
