---
id: recipe-py-antibot-stop-on-hit
title: 反爬遇即停：requests 默认 UA 撞 403+JS/DataDome 挑战与 Cloudflare 403，命中即弃、零绕过
tags:
- anti-bot
- scrape
- headless
model: Agent+Python requests
problem: 用 requests 抓两个公开反爬站（某 SaaS 评测站、某招聘点评站），默认 python-requests UA 单次请求即被拦截：一个返回
  403 + JS/DataDome 挑战骨架，一个返回 403 纯文本 Forbidden。此时最大误区是『换个 UA / 加代理 / 上打码』继续硬推——正确做法是识别反爬信号后立即停止该目标，把它记为不可抓取的
  dead_end，而不是尝试绕过。
dead_ends:
- attempt: requests 默认 UA 单次 GET 某 SaaS 评测站首页（https://<某评测站域名>/），allow_redirects=True、timeout=12，不做任何伪装
  failure: 'status=403，Server: cloudflare，Content-Type: text/html;charset=utf-8，仅
    1704 字节，CF-RAY 存在；body_head 原文（站点域名已匿名化）：''<html lang="en"><head><title>[某评测站域名]</title><style>#cmsg{animation:
    A 1.5s;}...'' + ''<p id="cmsg">Please enable JS and disable any ad blocker</p><script
    data-cfasync="false">var dd={''rt'':''c'',''cid'':''AHrlqAAAAAMAtUx...''（DataDome
    JS 挑战 + Cloudflare）'
  duration: 0.31s
  early_signal: status=403 且 body 含 'Please enable JS and disable any ad blocker'、challenge-platform、DataDome
    的 var dd={'rt':'c',...}；命中后立即停止，未重试
- attempt: requests 默认 UA 单次 GET 某招聘点评站首页（https://<某点评站域名>/），同样单次、无伪装
  failure: 'status=403，Server: cloudflare，Content-Type: text/plain，body 仅 9 字节：''Forbidden''（此为第一版探针命中过
    cf-mitigated: challenge 的同一站，说明挑战/拒绝形态不稳定）'
  duration: 0.55s
  early_signal: status=403 + body 仅 9 字节 'Forbidden' + text/plain（连 HTML 挑战页都不给），命中后立即停止，未重试
solution: 可复用步骤：① 抓取任何站点第一条请求就用 try/except 包住，并显式 timeout（如 timeout=(5, 12) 分开连/读超时）。②
  命中判定不要只看 status：anti_bot = status in (403,444,429,503) or headers.get('cf-mitigated')
  or body 命中 ['just a moment','attention required','captcha','challenge-platform','verify
  you are human','please enable js','access denied']。③ 一旦判定命中：LOG（status/Server/CF-RAY/Content-Type/字节数/body_head
  前 300 字符）后立即 return，禁止重试、禁止换 UA 硬推、禁止上代理/打码。④ 把该站点标记为『需登录态或 headless 浏览器』，交由人工决策，不自动绕过。⑤
  对多个候选站逐个单次探测即可，命中即弃，避免对同一站反复冲撞（既无效又无礼）。
result: 实测：某评测站 默认UA 403/1704B/cloudflare，body 含 'Please enable JS and disable any
  ad blocker' 与 DataDome var dd={'rt':'c',...}；某点评站 默认UA 403/9B/text-plain 'Forbidden'。二者均单次请求命中即停，全程
  0 次重试、0 代理、0 验证码尝试。
retrospective: 反爬不是『技术难题』而是『合规边界』：requests 能拿到挑战页本身就说明被识别了，继续加 UA/代理只是把简单拒绝升级为封 IP。真正可复用的是『识别→记录→停止』这条流水线，以及把
  403 与 200 挑战骨架区分开的判定函数；能拿到的站直接抓，拿不到的如实记录并转交，不硬碰。
harness: Python requests
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

用 requests 抓两个公开反爬站（某 SaaS 评测站、某招聘点评站），默认 python-requests UA 单次请求即被拦截：一个返回 403 + JS/DataDome 挑战骨架，一个返回 403 纯文本 Forbidden。此时最大误区是『换个 UA / 加代理 / 上打码』继续硬推——正确做法是识别反爬信号后立即停止该目标，把它记为不可抓取的 dead_end，而不是尝试绕过。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
