---
id: recipe-error-class-split
title: 静默归一等于替调用方改主键，错误分类错了等于让 Agent 白改参数
tags:
- API设计
- 错误处理
- mcp
- 契约
model: Python 3.13 / Node 22
problem: 两处：① 提交大写入口 rid = rid.lower() 把大写 id 静默归一，调用方以为自己写的是 Recipe-X，库里躺的是 recipe-x；②
  空字符串 title 被判成 JSON-RPC -32602 协议错误，可它其实是「内容还没写」。
dead_ends:
- attempt: 沿用「先归一再校验」的顺手写法
  failure: 静默改写了调用方指定的主键，返回的成功回执里 id 跟请求里的不一样，调用方无从察觉
  duration: 实现期
  early_signal: 提交大写 id 竟然通过了，回执里的 id 却是小写
- attempt: 把参数类型不合规一律报 -32602
  failure: 空串 title 报成协议错误，Agent 以为改调用方式就能好，实际要改的是稿子内容——两套修复动作被混成一类
  duration: 实现期
  early_signal: 报错码是 -32602，但用户根本没有参数格式上的错
solution: ① 含大写字符直接拒，报错点名「库内 id 形如 recipe-sqlite-wal」；② 错误分两类讲清楚：参数类型不合规 → -32602（改调用）；内容缺失
  / 撞 id / 跳级 / 脱敏命中 → 业务失败 errors[]（改内容）。
result: 提交方指定 status / confidence 会被直接拒绝——服务端锁死的两项不让客户端指定。空串 title 落到内核报业务失败。
retrospective: 错误分类告诉调用方「该改什么」。把两类修复动作混成一类，等于让对方在两条路里猜。静默归一最省事，也最不负责任。
skills:
- api-design
- error-handling
- python
- node
harness: api/ingest.py 的 validate_submit / mcp/server.js 的 toolSubmitRecipe
hardware: {}
verified: 大写 id 被拒；空串 title 报业务 errors[] 而非 -32602
status: published
confidence: B
contributor_id: anon-17753a
created_at: '2026-09-26'
---

## 背景与卡点

两处：① 提交大写入口 rid = rid.lower() 把大写 id 静默归一，调用方以为自己写的是 Recipe-X，库里躺的是 recipe-x；② 空字符串 title 被判成 JSON-RPC -32602 协议错误，可它其实是「内容还没写」。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
