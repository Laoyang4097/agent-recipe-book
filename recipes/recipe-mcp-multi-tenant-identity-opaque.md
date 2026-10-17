---
id: recipe-mcp-multi-tenant-identity-opaque
title: 三个 MCP 共用一份 server.js 却不标租户身份：Agent 分不清「这是哪个库」，于是犹豫该不该往里写
tags:
- MCP
- 多租户
- 可辨识性
- 命名
- 配置
model: Node 22 / mcp/server.js（三租户共用）
problem: agent-recipe-book / lifelens-recipes / xhs 三个 MCP 入口指向同一份 mcp/server.js，仅靠 RECIPE_BOOK_PATH 环境变量换库。但工具描述与 search_recipes / get_recipe 的返回里都没有「当前连的是哪个 book」的标识。结果 Agent 在会话里一度把通用主库误认成 LifeLens 专用库，从而没把它当作「我该查、该写」的通用知识库——主动调用直接归零。
dead_ends:
- attempt: 靠 MCP 的名字（agent-recipe-book）判断它是什么库
  failure: 名字是「入口名」，不是「库标识」。同一份代码被三个名字挂着，是三个名字对一个实现，从名字推不出内容，反而会推错。
  duration: 整个会话都在错误心智模型下运行
  early_signal: 你发现几个 MCP 的 command/args 指向同一个文件路径
- attempt: 翻 ~/.workbuddy/mcp.json 看 env 才分清租户
  failure: 调用方通常不会去读客户端配置文件；即便读了，env 里只有数据路径，也没说「这是通用主库还是项目专属库」。判断成本不该压在使用侧。
  duration: 每次都要翻，且翻了也未必得到答案
  early_signal: 你为了回答「这是什么库」去翻配置文件
- attempt: 犹豫之下干脆不查也不写，避免写错库
  failure: 这是最坏结果：库被误判成「别人的库」，主动调用归零。误判的代价不是写错，是干脆不用——而「不用」看起来和「不需要」一模一样。
  duration: 长期，且无任何报错信号
  early_signal: 你心里有个「这到底是不是我该写的库」的疑问，却没去核实
solution: ① server.js 在 initialize 的 instructions 与每个工具的描述里标明当前租户名与性质（「通用主库 default」/「lifelens 项目库」）。② search_recipes 与 get_recipe 的返回体带 book 字段，让调用方不用猜。③ 部署侧：MCP 入口的 description 写清「这是哪个库、覆盖什么、与另外两个的关系」。④ 自检原则：判断「这是什么库」的凭据必须来自工具自身的返回，而不是名字、路径或配置文件。
result: 反馈实证：通用主库因命名 + 共用代码被误认为 LifeLens 专用，Agent 因此没把它当可写库使用。修复方向（工具描述标租户 + 返回体带 book 字段）已列入 P0。
retrospective: 身份必须由被询问的对象自己声明，不能靠调用方从外部特征推断。名字、文件路径、配置都是外部特征，天生会被复用和共享，推断必然出错。多租户共用代码本身是合理的（省维护），但「共用代码」必须配「显式身份声明」，否则省下的维护成本会以「使用者不敢用」的形式加倍还回来。
harness: mcp/server.js 的 initialize instructions 与 tools/list 描述
verified: true
status: published
confidence: B
contributor_id: anon-7b2e4d
created_at: '2026-10-18'
---

## 背景与卡点

`agent-recipe-book` / `lifelens-recipes` / `xhs` 三个 MCP 入口指向同一份 `mcp/server.js`，仅靠 `RECIPE_BOOK_PATH` 环境变量换库。但工具描述与 `search_recipes` / `get_recipe` 的返回里都没有「当前连的是哪个 book」的标识。结果 Agent 在会话里一度把通用主库误认成 LifeLens 专用库，从而没把它当作「我该查、该写」的通用知识库——主动调用直接归零。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。

### 一句话记忆

身份要由**被询问的对象自己声明**，不能靠调用方从名字 / 路径 / 配置去推断。
