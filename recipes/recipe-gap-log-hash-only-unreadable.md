---
id: recipe-gap-log-hash-only-unreadable
title: 缺口日志只存 hash 不存原文：隐私保住了，但维护者回头看不出「大家到底在搜什么」
tags:
- 可观测性
- 隐私
- 缺口日志
- 权衡
model: Node 22 / mcp/server.js 的 gap 记录
problem: 缺口日志只记 query_hash（SHA256 前 12 位）+ 长度 + 分数 + tag，绝不存查询原文——隐私设计是对的。但副作用是：维护者回看 gaps.jsonl 时看不出检索主题，只能靠 tag 猜。实测 2026-10-17 的三条 0 命中记录，全靠 tags 里的 frontend / css 才推断出「这是前端坑」，而其中两条 tag 不同、其实是同一主题的连续检索，光看 tag 拼不出全貌。
dead_ends:
- attempt: 为了看懂就默认打开 RECIPE_GAP_LOG_RAW=1 记原文
  failure: 检索词里常含项目名、绝对路径、内网域名，原文入库等于把用户输入存进仓库。隐私设计正是为此才默认关的，为了可读性把它打开是本末倒置。
  duration: 一次开关的事，但影响不可逆（日志已落盘）
  early_signal: 你在用「我看不懂」论证「应该存原文」
- attempt: 靠 tag 反推检索主题
  failure: tag 由检索方传入，常常为空或过宽（如只传了 frontend）。同一主题的连续检索会打出不同的 tag，靠 tag 聚类会低估缺口频次。
  duration: 每次看 gaps 都要猜
  early_signal: 你在用 tag 反推「用户到底想问什么」
- attempt: 干脆不看 gaps.jsonl，凭直觉决定补什么配方
  failure: 记录的成本已经付了，收益没拿到——缺口日志白记。
  duration: 长期
  early_signal: 你有一个数据源，但从来不读它
solution: ① 默认仍只存 hash，隐私优先不动摇。② 补一层「主题指纹」：把检索词切成词后取其中的通用技术词（剔掉专名、数字、路径），只存这层摘要——既可读又不泄隐私。③ 维护者模式：需要时开 RAW，但必须经 scrubForGap 打码（数字 / 路径 / IP / 邮箱）后再落。④ 定期把高频 tag 聚类成「待写清单」，让缺口驱动创作。⑤ 关键原则：别在「全存」和「全不存」之间二选一，先问「哪一半是敏感的」。
result: 实测：三条 0 命中记录只能靠 tag 推断主题，其中两条 tag 不一致但实际同源，缺口频次被低估。修复方向已列入 P2：增加打码后的主题摘要层。
retrospective: 隐私与可观测性不是二选一，而是「要多少可观测性、愿意用什么代价换」。只存 hash 是零隐私风险 + 零可读性，存原文是完整可读性 + 完整隐私风险——两个极端都不合适，中间地带是脱敏后的主题摘要。更一般的教训：当你为了某个价值砍掉一个能力时，先问一句「能不能只砍掉有风险的那一半」。原文里敏感的是专名和数字，技术主题词本身并不敏感，把它们和专名一起砍掉是过度保守。
harness: mcp/server.js 的 recordGap + api/gaps.jsonl
verified: true
status: published
confidence: B
contributor_id: anon-7b2e4d
created_at: '2026-10-18'
---

## 背景与卡点

缺口日志只记 `query_hash`（SHA256 前 12 位）+ 长度 + 分数 + tag，绝不存查询原文——隐私设计是对的。但副作用是：维护者回看 `gaps.jsonl` 时看不出检索主题，只能靠 tag 猜。实测 2026-10-17 的三条 0 命中记录，全靠 tags 里的 `frontend` / `css` 才推断出「这是前端坑」。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。

### 一句话记忆

别在「全存」和「全不存」之间二选一——先问**哪一半是敏感的**。原文里敏感的是专名和数字，技术主题词不敏感。
