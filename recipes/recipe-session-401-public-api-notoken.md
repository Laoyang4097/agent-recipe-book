---
id: recipe-session-401-public-api-notoken
title: 抓需 token 的公开 API：WebFetch 无法带 Authorization 头，裸请求 401，必须换能设请求头的工具
tags:
- session
- auth-wall
- scrape
model: Hy3
problem: 直觉用 WebFetch 直接抓'需鉴权的公开 API'（如取当前用户的 REST 端点、按城市查天气的端点），以为公开 API 也能像普通网页一样裸抓。实际：这类端点必须带
  token/API key，WebFetch 既无法在请求里加 Authorization 头、也无法可靠传 query token，结果一律 401/空响应。
dead_ends:
- attempt: WebFetch 直接抓某公开代码托管平台的 REST API 的'当前用户'端点（/user），不带任何 token。
  failure: '返回 HTTP 401，JSON 体为 {message: ''Requires authentication'', status: 401}，拿不到任何用户数据。'
  duration: 1 次抓取（秒级）
  early_signal: 状态行直接是 401，body 明确说需要鉴权，而非返回空列表或重定向——说明是鉴权缺失而非限流。
- attempt: 想'糊弄'过鉴权：在同一端点 URL 后加 ?access_token=<编造的假 token> 再 WebFetch。
  failure: '依旧 401，JSON 体仍为 {message: ''Requires authentication'', status: 401}——该端点不认
    query 里的假 token，或仍被当作未认证。'
  duration: 1 次抓取（秒级）
  early_signal: 假 token 既没让请求变成已认证，也没变成 403（无效 token），而是维持 401，提示 WebFetch 这一层根本没法把有效凭据送进去。
- attempt: 换某公开天气数据 API 的 /weather 端点（按城市查天气），同样不带 appid，并在 prompt 里'假装'带了 key。
  failure: '返回 401 JSON：{cod: 401, message: ''Invalid API key...''}，确认又一类公开 API 需要
    key，且 WebFetch 透传不了 key。'
  duration: 1 次抓取（秒级）
  early_signal: 错误码 401 + 'Invalid API key'，与代码托管平台 401 同源——公开 API 的'需 key'是普遍约束，不是单站特例。
solution: '① 识别''公开 API 但需 token/key''这类端点：裸抓必 401，先读其文档确认鉴权方式（Header Bearer / Query
  key）。② WebFetch 无法设置自定义请求头，所以即便手里有合法 token 也塞不进去——必须换能设头的工具：curl -H ''Authorization:
  Bearer <TOKEN>'' 或 Python requests.get(url, headers={...})。③ token 一律放环境变量/密钥库，绝不写进配方或硬编码；本任务全程只用编造的假
  token 与纯公开端点，绝不碰需真登录的页面、绝不获取他人私密 token。④ 401 与 403 要区分：401=没带/带错凭据（补 token），403=带了但无权限（换账号/降权），不要混为一谈重试。⑤
  反爬/鉴权遇阻即停。'
result: 确认 WebFetch 对'需鉴权公开 API'无解（无自定义头能力），改用 curl/requests 带 Authorization 头即可正常取数；全程零真实凭据、零登录页接触，符合安全边界。
retrospective: WebFetch 是'无头只读浏览器'，不是 HTTP 客户端——它擅长抓网页、不擅长调 API。凡是'要在请求头里塞东西'的采集，第一时间换
  curl/requests，别在 WebFetch 上耗。
skills:
- web-fetch
- http-header
- api-auth
- token-management
- curl
harness: WebFetch（只读抓取，不支持自定义请求头）；对照用 curl/requests 思路（未实际执行真实凭据请求）
hardware: 云端托管抓取（无本地浏览器）
agent_config: model=Hy3；采集策略=直觉先裸抓后补鉴权
verified: true
status: published
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

直觉用 WebFetch 直接抓'需鉴权的公开 API'（如取当前用户的 REST 端点、按城市查天气的端点），以为公开 API 也能像普通网页一样裸抓。实际：这类端点必须带 token/API key，WebFetch 既无法在请求里加 Authorization 头、也无法可靠传 query token，结果一律 401/空响应。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
