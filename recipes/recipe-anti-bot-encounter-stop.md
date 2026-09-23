---
id: recipe-anti-bot-encounter-stop
title: 采集某房产信息站遇 Access denied 人机验证，立即停手不绕过
tags:
- anti-bot
- scrape
model: Hy3
problem: 需用 WebFetch 采集一个以反爬著称的公开站点作为练习，预期可能遇到 403/验证码/挑战页；合规要求一旦遇到反爬拦截必须立即停，不得硬破解或绕验证码、不得换
  UA 对抗。
dead_ends:
- attempt: 直接 WebFetch 该房产信息站首页（某房产信息站），期望拿到公开房源列表内容。
  failure: 返回明确反爬拦截页：标题 'Access to this page has been denied'，正文 'Press & Hold to
    confirm you are a human (and not a bot)'，并附 Reference ID。
  duration: 约 1 次请求（数秒）。
  early_signal: 页面标题即写明 'Access to this page has been denied' 且要求人机确认 → 是 bot 检测挑战，不是
    404 也不是限流，应立即停。
- attempt: 为确认是否仅首页被拦，再 WebFetch 该站子路径（某房产信息站/homes/）一次以观察拦截范围。
  failure: 子路径同样返回 'Access to this page has been denied' + 人机确认提示（新 Reference ID），说明是站级
    bot 防护。
  duration: 约 1 次请求（数秒）。
  early_signal: 两处路径均被同一挑战拦截 → 站级防护，单点重试/换路径无意义；依据合规红线停止该采集任务。
solution: 1) 见到 'Access denied / confirm you are a human / CAPTCHA / Just a moment'
  等任一反爬信号，立刻停止对目标的所有后续请求，绝不尝试换 UA、破解或绕验证码。2) 将该站标记为'反爬/需人工验证'，域名匿名化（某房产信息站）后归档为 dead_end。3)
  若业务必须数据，改走官方 API、授权数据源或征得许可的合规渠道，而非对抗式爬取。4) 用控制站点（example.com）验证采集通道本身正常，排除'误把反爬当成工具故障'。
result: 确认该站启用站级人机验证反爬，按红线零绕过、零重试对抗，任务安全终止；未获取任何站内数据，符合合规要求。
retrospective: 反爬即停不是'失败'，而是正确的合规终止。把'遇到反爬'本身当作一条有价值的死胡同记录，比硬刚更有用，也避免触碰法律与伦理红线。
harness: WebFetch；返回为人机验证挑战页而非 403 状态码，需靠页面文案判定。
agent_config: model=Hy3; 只读首页 + 一次子路径确认; 遇挑战即停，无后续对抗请求。
verified: true
status: published
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

需用 WebFetch 采集一个以反爬著称的公开站点作为练习，预期可能遇到 403/验证码/挑战页；合规要求一旦遇到反爬拦截必须立即停，不得硬破解或绕验证码、不得换 UA 对抗。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
