---
id: recipe-ratelimit-threshold-not-relative
title: 配方里的绝对阈值会被跨站照抄：`remaining<10 就停` 搬到 Limit=5 的站点上，等于抓一条就收手
tags:
- rate-limit
- recipe-quality
- negative-transfer
- prompt-injection
model: 配方库 A/B/C/D 对照实验，弱模型（glm-4-flash）配方注入组
problem: 库内一条限流配方（来源站 X-RateLimit-Limit=60）给出的解法是：用 X-RateLimit-Remaining 递减做「还剩多少预算」的硬判据，「逼近阈值（如
  <10）就主动停」。把它注入到一个 X-RateLimit-Limit=5 的靶站任务上时，remaining 永远小于 10 —— 于是照抄这条判据的模型认为「已经逼近阈值」，抓第一条数据就主动停手。弱模型
  5 次运行全部 0/5，stdout 是 `Approaching rate limit threshold, stopping.` 加一条 D-01；而靶站侧
  429 计数为 0，说明**根本没触发限流，是它自己放弃的**。同任务上裸模型（无注入）反而不会主动停。
dead_ends:
- attempt: 配方里写死绝对阈值（`remaining < 10 就主动停`），当作可直接复用的判据
  failure: 阈值是相对站点配额才有意义的量。靶站 Limit=5 时该条件恒为真，等价于「立刻停止」。模型照抄 → 一次有效抓取都没完成 → 判分 0 分。
  duration: 注入即触发，无需等待
  early_signal: 模型输出里出现配方原句的措辞（如 stopping / 阈值 / 预算），但站点侧根本没有出现限流信号（429 计数为 0）
- attempt: 只用弱模型验证配方的「可读性」，不看它被字面执行后会发生什么
  failure: 同一条配方在强模型上表现正常：强模型把它改造成「remaining 低就 sleep 等待再抓」而不是「停手」，5/5 通过。于是配方在评审时看起来「没问题」，缺陷要等到换成弱模型才暴露。
  duration: 跨模型差异，单模型验证发现不了
  early_signal: 同一配方在大模型上被改写成相对判据（如 remaining<=max(1,int(Limit*0.2)) 后 sleep），在小模型上被原样照抄成绝对判断
- attempt: 把配方当「参考文档」整段注入，不标注适用前提与参数来源
  failure: 配方缺了「这些数字是从哪个站量出来的」这一层，读者无法判断能否迁移。经验卡越是具体（有数字、有时长），越容易被当成通用结论照搬。
  duration: 长期隐患，量不出来
  early_signal: solution 段出现绝对值但没有说明它随什么变化（配额大小 / 窗口长度 / 站点策略）
solution: ① 配方里的阈值一律相对化：`remaining <= max(1, ceil(Limit * 0.2))`，并先读 X-RateLimit-Limit
  再算，禁止写死绝对值。② 配方必须写明适用前提：这条经验的站点参数是什么、哪些量会变、迁移时需要先确认什么。③ 把「语义是停手还是等待」显式写出来 —— 逼近限流应当「等待/退避后继续」，只有身份/权限类失败（401/403）才该「停止重试」。④
  消费侧（Agent）注入配方前先核对参数与目标站是否匹配，不匹配就只取方法不取数值。⑤ 评审配方时增加一条检查：把配方交给一个弱模型照抄，看它会不会做出与意图相反的动作。
result: 同一条配方、同一道限流题：弱模型组 0/5（stdout 明确打印 stopping 且只拿到 1/12 条、靶站 429 计数为 0），强模型组
  5/5（其中一次输出 `[budget] remaining=2, sleep` —— 把「停」正确改造成「等」）。差异完全来自模型是否会适配参数，而不是配方讲得对不对。
retrospective: 经验卡最大的风险不是「写错了」，而是「写对了但不可迁移」——绝对数值是隐式上下文，跨站即失效。配方要写成可参数化的形式，否则会出现一个很坏的分布：强者能适配所以看不出问题，弱者会照抄所以受伤最重
  —— 而配方库本来就是给弱者兜底的。这也说明配方评审不能只问「对不对」，还要问「照抄会怎样」。
harness: 配方文本注入 + 本地令牌桶靶站（容量 5，每 1.2s 补 1）
verified: true
status: published
confidence: A
contributor_id: anon-602c63
created_at: '2026-10-01'
---

## 背景与卡点

库内一条限流配方（来源站 X-RateLimit-Limit=60）给出的解法是：用 X-RateLimit-Remaining 递减做「还剩多少预算」的硬判据，「逼近阈值（如 <10）就主动停」。把它注入到一个 X-RateLimit-Limit=5 的靶站任务上时，remaining 永远小于 10 —— 于是照抄这条判据的模型认为「已经逼近阈值」，抓第一条数据就主动停手。弱模型 5 次运行全部 0/5，stdout 是 `Approaching rate limit threshold, stopping.` 加一条 D-01；而靶站侧 429 计数为 0，说明**根本没触发限流，是它自己放弃的**。同任务上裸模型（无注入）反而不会主动停。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
