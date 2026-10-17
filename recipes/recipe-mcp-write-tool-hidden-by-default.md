---
id: recipe-mcp-write-tool-hidden-by-default
title: MCP 默认只读把投稿工具藏了起来：工具列表里根本看不到「投稿」，只能手写 md 绕过写入契约
tags:
- MCP
- 写侧
- 投稿
- 契约
- 默认配置
model: Node 22 / mcp/server.js + ~/.workbuddy/mcp.json
problem: 写侧能力由环境变量开关控制：只有显式设了 RECIPE_BOOK_WRITE=1，submit_recipe 与 promote_recipe 才会出现在 tools/list。而默认 MCP 配置里没设这个 env，于是 Agent 连上后工具列表里只有只读工具，压根不存在「投稿」这个可调用项——不是不想投，是看不到入口。结果本次 5 条前端配方全部靠手写 recipes/*.md + 手动 rebuild 落库，完全绕开了脱敏自检、隔离池与晋升闸门。
dead_ends:
- attempt: 想投稿时先 tools/list 看有什么，没找到投稿就自己手写 .md 文件
  failure: 绕开 MCP 写入契约 = 同时绕开三道治理：脱敏自检（绝对路径 / token 可能直接入库）、隔离池（手写即是 published，跳过了 draft 等人复核）、id 与字段格式校验。数据进去了，治理全丢了。
  duration: 本次 5 条配方全程走这条路，事后复盘才发现
  early_signal: 你在用文件写入工具造 recipes/*.md，而不是调用 submit_recipe
- attempt: 以为「工具列表里没有」就等于「这个库不支持写入」
  failure: 能力是存在的，只是被配置藏起来了。从工具列表反推能力会得出错误结论，而且这个错误结论会导向更坏的动作（绕过）。
  duration: 判断发生在连接后的头几秒，不会有人复核
  early_signal: 你在用「我看到什么」判断「它能做什么」
- attempt: 决定先手动 rebuild 把库更新了，投稿的事以后再说
  failure: rebuild 本身也是静默的（见 recipe-ingest-rebuild-silent-skip-bad-md）：坏文件被剔除但不报错。绕过路径因此是双重不可靠——既丢了治理，又拿不到失败信号。
  duration: 叠加在 RT-G1 上，直到人工核对条数才发现
  early_signal: 你的落库路径里没有任何一步会告诉你「失败了」
solution: ① 部署方：默认租户显式设 RECIPE_BOOK_WRITE=1，让投稿入口出现在 tools/list（改完需重启会话，见 recipe-mcp-trust-needs-client-restart）。② 实现方：能力开关不能只体现在「工具是否出现在列表」，还必须在只读工具描述或 initialize 的 instructions 里写明「此连接为只读，开启方式是 X」，让 Agent 知道入口存在、只是没开。③ Agent 侧：若 tools/list 里没有 submit_recipe，不要手写文件绕过，先告诉用户「当前连接只读，需要开启 RECIPE_BOOK_WRITE=1 并重启会话」。④ 兜底：万不得已要手写落盘，也必须跑 ingest.py check 预检，并在 rebuild 后核对条数变化。
result: 反馈确认：默认配置下 5 条配方全部经手写落库，submit_recipe 一次都没被调用——这 5 条本身就成了「默认配置下 Agent 无法走正规投稿通道」的证据。修复方向（打开默认写开关 + 在只读态明示开启方式）已列入 P0。
retrospective: 一个能力的「存在」和「可见」是两件事。用开关把工具从列表里摘掉，等于把「能不能写」的判断成本转嫁给调用方，而调用方唯一能看到的就是工具列表——它必然得出「不能写」，然后自己造一条路。更糟的是那条自造的路绕开了全部治理闸门。**凡是能力开关，都要在可见层留一句说明**（「此连接为只读，开启方式是 X」），否则使用者不是绕过去，就是干脆不用。
harness: mcp/server.js 的 WRITE_ENABLED 与 tools/list + ~/.workbuddy/mcp.json
verified: true
status: published
confidence: B
contributor_id: anon-7b2e4d
created_at: '2026-10-18'
---

## 背景与卡点

写侧能力由环境变量开关控制：只有显式设了 `RECIPE_BOOK_WRITE=1`，`submit_recipe` 与 `promote_recipe` 才会出现在 `tools/list`。而默认 MCP 配置里没设这个 env，于是 Agent 连上后工具列表里只有只读工具，压根不存在「投稿」这个可调用项——**不是不想投，是看不到入口**。结果本次 5 条前端配方全部靠手写 `recipes/*.md` + 手动 rebuild 落库，完全绕开了脱敏自检、隔离池与晋升闸门。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。

### 一句话记忆

能力的**存在** ≠ 能力的**可见**。开关摘掉工具的同时，必须在可见层留一句「怎么打开」。
