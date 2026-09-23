---
id: recipe-py-session-cookie-lost
title: requests.get 之间 cookie 静默丢失：Set-Cookie 挂在 302 跳上、r.cookies 却是空的，只有 Session
  才真正保留
tags:
- session
- scrape
model: Agent+Python requests
problem: '抓某公开 HTTP 测试服务时，先请求一个『设置 cookie 并 302 跳到回显页』的标准回显端点(路径如 /cookies/set)，再用
  requests.get 单独请求回显端点(/cookies)想读回 cookie，结果拿到空对象 {''cookies'': {}}。直觉以为『requests
  会自动保存并带上 cookie』，实际每一次 requests.get 都是彼此独立的一次会话，cookie 不会跨调用保留；更阴的是，想拿第一次响应的 r1.cookies
  手动搬运，r1.cookies 也是空的。'
dead_ends:
- attempt: 直接连续两次 requests.get：先 GET /cookies/set?sid=abc123&t=xyz（服务端 302 跳 /cookies
    回显），再 GET /cookies 读 cookie
  failure: '第二次返回 {''cookies'': {}}——cookie 完全丢失，请求里根本没带上去；第一次之所以在响应里看到 {''sid'':''abc123'',''t'':''xyz''}，只是因为
    302 跳转是在同一次调用内部完成的'
  duration: 实测单次约 0.29s / 1.28s（r.elapsed），排查加改方案合计约 8min
  early_signal: 第二次响应体是空对象 {}，而第一次有值；两次是独立的 get 调用，没有共享 jar
- attempt: 想用首次响应对象手动搬运：requests.get(..., cookies=r1.cookies)
  failure: '仍然是 {''cookies'': {}}——因为 Set-Cookie 挂在 302 那一跳上，而 r1.cookies 只反映『最终』响应（跳转后的
    200 回显页）的 cookie 集合，回显页本身并不 Set-Cookie，故 r1.cookies 为空'
  duration: 秒级（一次请求）
  early_signal: r1.cookies == {} 但 r1.history == [302]，真正带 cookie 的是 r1.history[0].cookies
- attempt: '改从重定向链汇总 cookie 再手动塞回下次请求：jar={} ; for h in r1.history: jar.update(h.cookies)
    ; requests.get(''/cookies'', cookies=jar)'
  failure: '这次确实拿到了 {''cookies'': {''sid'': ''abc123''}}，但要手工遍历 history、拼 jar，一旦站点有多次跳转/多组
    Set-Cookie/HttpOnly 属性，手工搬运极易漏项，且 cookie 轮换后即失效'
  duration: 约 3min 才把 history 汇总写对
  early_signal: 需要写循环遍历 r.history 才能凑齐 cookie，说明思路已经偏了——正确做法是让库来管
solution: '可跑要点：① 需要跨请求保留 cookie/登录态时，用 requests.Session()，同一次 s.get() 序列会自动共享 cookie
  jar：s.get(set); s.get(''/cookies'') -> {''cookies'': {''sid'': ''abc123''}}。② 别把
  requests.get 当成会自己记 cookie 的浏览器；每个顶层 get 都是独立会话。③ 若确实要手动搬运，注意 Set-Cookie 可能在重定向的中间响应上（r.history[i].cookies），而不是最终响应
  r.cookies。④ 抓需登录/多步交互的页面前，先确认是否 Session；无 Session 反复 get 会一轮一个新身份。⑤ 不要手写 Cookie
  请求头硬编码值——轮换/过期即坏。'
result: '实测同一公开测试服务：直觉两次独立 get -> 第二次 {''cookies'': {}}（丢失）；改用 Session -> {''cookies'':
  {''sid'': ''abc123''}}（保留）；手动 cookies=r1.cookies -> 仍 {}（因 r1.cookies 为空，Set-Cookie
  在 r1.history[0] 的 302 上，history=[(302, {''sid'':''abc123''})]）；手动汇总 history 再搬运
  -> 才成功。'
retrospective: 三条忠告：a) requests.get 不等于浏览器，cookie 不跨调用；要状态就用 Session。b) 看 Set-Cookie
  时要意识到它可能落在重定向链的中间响应上，最终响应的 .cookies 未必有你想要的。c) 能交给库管理的状态（cookie jar、连接池、默认头）就不要手工搬运，手工方案在真实站点上必然漏项。
harness: Python requests
verified: true
status: published
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

抓某公开 HTTP 测试服务时，先请求一个『设置 cookie 并 302 跳到回显页』的标准回显端点(路径如 /cookies/set)，再用 requests.get 单独请求回显端点(/cookies)想读回 cookie，结果拿到空对象 {'cookies': {}}。直觉以为『requests 会自动保存并带上 cookie』，实际每一次 requests.get 都是彼此独立的一次会话，cookie 不会跨调用保留；更阴的是，想拿第一次响应的 r1.cookies 手动搬运，r1.cookies 也是空的。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
