---
id: recipe-rate-limit-proxy-misattribution
title: 高频采集公开站全报 fetch failed：误判限流，实为采集代理对部分域名静默拦截
tags:
- scrape
- rate-limit
model: Hy3
problem: 想通过对同一公开站点（某技术百科站）连续发起约 20 次 WebFetch 来观察目标站频率限制/封禁信号，结果所有请求返回 'fetch failed'，没有
  429、没有减速、没有任何 HTTP 状态码，无法判断到底是目标限流还是采集链路自身问题。
dead_ends:
- attempt: 对同一公开站点（某技术百科站）连续发起 5 次 WebFetch，并用 ?probe=1..5 变化查询参数模拟真实源站请求，期望触发 429/限流信号。
  failure: '5 次全部返回 ''Error during web fetch: fetch failed''，既无 HTTP 状态码也无任何限流提示，内容缺失。'
  duration: 约 20 秒（单批次并行 5 次）。
  early_signal: 同环境下 example.com 可正常返回，而该站每次必失败 → 不是目标限流（限流会有 429/Retry-After/内容降级），而是采集侧拦截。
- attempt: 假设是瞬时网络抖动，单独重试该站首页（不带参数）若干次验证是否偶发。
  failure: 重试仍稳定返回 'fetch failed'，错误文案完全一致、瞬时返回，没有任何一次间歇成功。
  duration: 约 30 秒。
  early_signal: 错误确定性强、无随机性 → 是确定性拦截（代理/域名 allowlist/TLS egress），不是偶发限流，加 sleep 重试无助于解决。
solution: 1) 在怀疑'限流'前，先对已知可达宿主（如 example.com）做控制请求；若控制成功但目标稳定失败，根因在采集代理/沙箱对该域名的 egress
  拦截，而非目标限流。2) 用'控制站点对比法'区分：限流=有 429/Retry-After/内容降级；代理拦截=无状态码、错误瞬时且跨参数稳定。3) 只有确认是真限流才上退避；若是代理拦截应换可达宿主或检查
  egress，盲目加 sleep 只会拖慢且无效。
result: 确认本次失败非目标限流，转用可达宿主继续采集；该站的高频限流信号因代理静默拦截而未能观察到。
retrospective: 直觉把'请求失败'直接等同于'被限流'，忽略了采集工具本身也会静默拦截部分域名。先控制变量（控制站点对比）再下结论，避免把代理故障误当限流去退避。
harness: WebFetch（含 15 分钟自清理缓存）；同环境 example.com 可达，en.wikipedia.org / bbc.com 被静默
  fetch failed。
agent_config: model=Hy3; 并发 WebFetch; URL 变化参数(?probe=N)绕缓存以产生真实源站请求。
verified: true
status: published
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

想通过对同一公开站点（某技术百科站）连续发起约 20 次 WebFetch 来观察目标站频率限制/封禁信号，结果所有请求返回 'fetch failed'，没有 429、没有减速、没有任何 HTTP 状态码，无法判断到底是目标限流还是采集链路自身问题。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
