---
id: recipe-validate-without-assign
title: 校验了却忘了赋值：类型检查过了，交下去的内容还是空的
tags:
- bug
- mcp
- 数据流转
- 契约
model: Node 22 / mcp/server.js
problem: submit_recipe 里对 tags 与 dead_ends 做了类型校验，校验分支之外没把值赋进 payload，结果是内核收到一份缺 tags、缺
  dead_ends 的稿子，报「缺必填字段」。看起来像用户没填，实际是这层悄悄吞了。
dead_ends:
- attempt: 照错误提示让用户补字段
  failure: 字段确实传了，补多少遍都有缺——问题在这一层校验完没往下游传
  duration: 实现期当场命中
  early_signal: 客户端明明传了 tags，回执却说没传
solution: 校验与赋值配对写：类型不合规就抛 -32602，合规就原样写进 payload，不留一个只校验不落值的分支。
result: 经 MCP 投稿与经 CLI 投稿走同一份载荷，行为一致。
retrospective: 「校验」和「赋值」是同一个动作的两半。拆成两个分支写，中间那步就容易被漏掉——而漏掉它，报错还会伪装成用户的问题。
skills:
- node
- api-design
- 调试
harness: mcp/server.js 的 toolSubmitRecipe
hardware: {}
verified: A-1 经 MCP 投稿成功入池，回执含 id / contributor_id / status / confidence
status: published
confidence: B
contributor_id: anon-17753a
created_at: '2026-09-26'
---

## 背景与卡点

submit_recipe 里对 tags 与 dead_ends 做了类型校验，校验分支之外没把值赋进 payload，结果是内核收到一份缺 tags、缺 dead_ends 的稿子，报「缺必填字段」。看起来像用户没填，实际是这层悄悄吞了。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
