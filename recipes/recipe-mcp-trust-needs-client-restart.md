---
id: recipe-mcp-trust-needs-client-restart
title: 改完 MCP 配置并点了信任，当前会话仍看不到工具——MCP 在客户端启动时加载，必须重启或开新会话
tags:
- mcp
- tooling
- config
- agent
confidence: A
model: 与客户端相关，与模型无关
problem: '把一个新的 MCP server 写进客户端配置文件、并在连接器面板点了信任（Trust）之后，在当前会话里问 AI「你能用某某工具吗」，它的工具列表里根本没有这个 server。配置 JSON 完全合法，用命令行直接启动这个 server 也一切正常、工具正常返回——但 AI 就是看不见。'
dead_ends:
- attempt: 以为点完信任就立刻生效，直接在当前会话追问 AI 能不能用
  failure: 工具列表里没有这个 server，AI 甚至不知道它存在，会如实回答「我没有这个工具」
  duration: 约 5min
  early_signal: 授权（Trust）与加载（Load）是两件事——授权只是「允许它运行」，不会让已经在跑的会话重新加载工具列表
- attempt: 反复检查配置 JSON 是不是格式写错了
  failure: JSON 完全合法（能被 JSON.parse），格式没有任何问题
  duration: 约 10min
  early_signal: 先用命令行直接 spawn 一次这个 server，能起来、能返回工具列表，就说明配置没错——问题在加载时机，不在配置
solution: '1) 先排除配置本身：在命令行直接跑一次 server（如 printf 一行 initialize 报文 | node mcp/server.js），能加载并返回工具列表就证明配置无误。2) 确认客户端已经在连接器面板点了信任。3) 重启客户端，或重开一个会话——MCP server 在客户端启动时一次性加载，运行中新增的不会自动进工具列表。4) 重启后再用工具检索接口验证一次，命中大于 0 才算真的通了。'
result: '命令行直连验证：主库加载 61 条配方、5 个工具全部就绪；配置文件 JSON 合法、客户端已回写确认。当前会话（未重启）工具列表中查无此 server；需在重启后的新会话中复验。'
retrospective: '一句话忠告：MCP 的信任授权与进程加载是两步，别把「点了信任」当成「已经生效」。排查顺序应当是——先用命令行验证 server 本身能跑，再怀疑客户端加载时机，最后才回头查配置格式。'
skills:
- MCP 客户端配置
harness: WorkBuddy（同理适用于其它支持 MCP 的客户端）
verified: true
status: published
seed: true
contributor_id: anon-2f183a
---

## 背景

给客户端新增了一个本地 MCP server（stdio 传输），配置文件写入后客户端会自动读取并回写（补上 `disabled: false` 之类的字段），连接器面板也能看到、可以点信任。

但当前会话里的 AI 工具列表中查不到它，用工具搜索接口也只能搜到其它已加载的 server。

## 为什么会发生

MCP server 是在**客户端启动 / 会话初始化时**一次性加载进工具列表的。运行过程中新增的配置，属于「下一次启动才会生效」——这与信任授权无关，信任只是解除安全拦截。

## 排查口诀

1. **命令行直连**：能起来 → 配置没问题
2. **面板信任**：授权了 → 拦截解除了
3. **重启 / 新会话**：加载了 → 工具列表里才真的有它
