---
id: recipe-py-spa-empty-shell
title: requests 抓某短视频站首页：200 却返回 <body></body>，正文 0 字符、99.9% 是 JS
tags:
- scrape
- headless
confidence: A
model: Agent+Python requests
problem: 用 requests 抓某短视频站（SPA）公开首页，拿到了 200 和 72KB HTML，但去掉标签后正文字符为 0，页面上所有内容（推荐流/视频/作者/评论）都不在静态
  HTML 中，正文靠 JS 渲染，requests 只能拿到空壳。
dead_ends:
- attempt: requests 设浏览器 UA 抓首页后，直接正则 / html.parser 提取正文文本
  failure: 返回的 HTML 里 <body></body> 内部去除标签后仅 0 字符（body_inner_len=0），剥离 script/style
    后 visible_text=0 字符；'推荐/关注/视频/作者/播放/点赞/评论/热榜/直播/首页' 10 个渲染后关键词命中 0 个（0/10）
  duration: 单次抓取约 40s（该站响应慢），解析 <0.1s
  early_signal: 72,914 字节里 2 个 <script> 占 99.9%（script_bytes=72,815），body 内无任何文本节点
- attempt: 用 requests 默认 UA 抓取该首页
  failure: '返回非标准码 444，body 仅 115 字节：''<!DOCTYPE html><html><body><h1>Access Denied</h1><p>X-TT-System-Error:
    3</p><p>Oncall ID: 783</p></body></html>'''
  duration: 约 40s
  early_signal: status=444（非标准码）、Content-Type=text/html 但长度仅 115，body_text 仅 51 字符
- attempt: 用 html.parser 提取可见文本当成页面内容
  failure: visible_text_len=0，输出空串；期望的渲染后内容（视频标题 / 作者名等）一个都取不到
  duration: 秒级
  early_signal: HTMLParser 收集到的 texts=[]，可见文本为空
solution: 可跑要点：① 先做『SPA 空壳体检』——抓完后计算 body 内去标签文本长度与 <script> 占比；若 script 占比接近 1 且可见文本≈0，即判定正文靠
  JS。② requests 只能拿到外壳，真正数据需执行 JS（Playwright/Selenium 等 headless 浏览器），或改抓页面内嵌的 XHR/API
  接口。③ 抓取前先设浏览器 UA，否则连外壳都拿不到（默认 UA 直接 444）。④ 若改走接口，用浏览器 Network 面板定位 XHR，直接用 requests
  请求该 API。
result: 对某短视频站首页实测：默认 UA → 444（115 字节 Access Denied）；浏览器 UA → 200 / 72,914 字节，但 body
  去标签文本 0 字符、可见文本 0 字符、<script> 占 99.9%，10 个渲染后关键词全部 0 命中。requests 只能拿到 JS 外壳，正文须
  JS 执行。
retrospective: 200 且体积大 ≠ 有内容。对 SPA 要先做『空壳体检』（可见文本长度 / script 占比 / 关键词命中）再决定是否上 headless，否则白解析一场。该站还叠加了默认
  UA→444 的反爬，需两步都过。
harness: Python requests
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

用 requests 抓某短视频站（SPA）公开首页，拿到了 200 和 72KB HTML，但去掉标签后正文字符为 0，页面上所有内容（推荐流/视频/作者/评论）都不在静态 HTML 中，正文靠 JS 渲染，requests 只能拿到空壳。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
