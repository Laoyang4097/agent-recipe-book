---
id: recipe-py-ratelimit-silent-headers
title: 连续请求限流观察：18 次全 200、0 个 429，限流却藏在 X-RateLimit-Remaining（57→43）与 CDN HIT/MISS
  里
tags:
- scrape
- rate-limit
- timing
model: Agent+Python requests
problem: 判断『连续抓取会不会被限流』时，最容易只看 HTTP 状态：连续 15-18 次请求全部 200、没有 429，就下结论『该站不限流』。真跑发现这个结论不可靠——一个站用响应头静默计数限流（耗尽才拒绝），另一个站前
  16 次全被 CDN 缓存挡下、根本没打到源站，状态码和耗时都毫无信息量。
dead_ends:
- attempt: 对某静态站（CDN 托管）连续发 18 次请求（URL 带不同 ?probe=N 参数），全部返回 200，据此判定『站点无速率限制』
  failure: 'status_counts={''200'': 18}、saw_429=False，看似无限流；但逐条看响应头：cf-cache-status
    为 16×HIT、2×MISS，且两次 MISS（第 17、18 次）耗时 1240ms、1211ms，是 HIT 平均耗时（≈286ms）的 4 倍多。说明
    18 次请求里绝大多数被 CDN 缓存直接挡下、并未真正抵达源站，『全 200』无法证明源站不限流'
  duration: 18 次共约 7s（ms 249~1240，avg 386）
  early_signal: cf-cache-status=HIT/MISS 混杂；MISS 两次耗时骤增至 1200ms+；响应体恒为 559 字节、sha1
    全同
- attempt: 对某公开 API 站连续发 15 次请求，没看到 429/403 就认为『该站不限流，可以随便抓』
  failure: 'status_counts={''200'': 15}、saw_429=False，但响应头 X-RateLimit-Remaining 从
    57 逐次递减到 43（每请求 -1；X-RateLimit-Limit=60，X-RateLimit-Reset=1790151929）。限流一直在静默计数，只是额度没耗尽才没拒绝——按这个速率再发约
    43 次就会撞墙'
  duration: 15 次共约 3.2s（ms 165~490，avg 210）
  early_signal: X-RateLimit-Remaining 单调递减 57→56→…→43；响应恒 200、body 恒同（distinct_sha1=1）
solution: 可复用步骤：① 判限流别只看 status——同时记录并比对四类信号：(a) 状态码是否出现 429/403/503；(b) 响应头 X-RateLimit-Remaining
  / Retry-After 是否递减或出现；(c) 逐次耗时 ms 是否随请求数抬升；(d) 响应体长度/sha1 是否突变（内容降级）。② 用 X-RateLimit-Remaining
  递减做『还剩多少预算』的硬判据，逼近阈值（如 <10）就主动停。③ 看到 cf-cache-status=HIT 要知道请求没到源站，别把 CDN 缓存命中当成『站方不限流』。④
  退避策略：命中 Retry-After 优先按它等待；否则指数退避 sleep = base * 2^n（base 0.5~1s，加 jitter），并对 429/403/503
  停止重试。⑤ 连续探测给每条请求加唯一查询参数避免缓存误判，同时用 time.sleep 控制节奏。
result: 实测：静态站 18 次全 200、0×429，cf-cache-status 16×HIT+2×MISS，MISS 耗时 1240/1211ms vs
  HIT≈286ms；API 站 15 次全 200、0×429，X-RateLimit-Remaining 由 57 递减至 43（Limit=60）。两站均未触发硬限流，但均存在可观测的限流/缓存信号。
retrospective: 『没被限流』和『没看到限流信号』是两回事。真限流往往先静默计数（响应头）、再降速、最后才 429；而 CDN 缓存会把『压力测试』变成『读缓存』，让你误以为畅通。观察限流要盯响应头+耗时的趋势，而不是单看某一次的状态码。
harness: Python requests
verified: true
status: published
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

判断『连续抓取会不会被限流』时，最容易只看 HTTP 状态：连续 15-18 次请求全部 200、没有 429，就下结论『该站不限流』。真跑发现这个结论不可靠——一个站用响应头静默计数限流（耗尽才拒绝），另一个站前 16 次全被 CDN 缓存挡下、根本没打到源站，状态码和耗时都毫无信息量。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
