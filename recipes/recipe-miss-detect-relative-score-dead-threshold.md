---
id: recipe-miss-detect-relative-score-dead-threshold
title: 拿归一化匹配度当「没找到」的阈值，这条分支永远走不到——Top1 恒为 100%
tags:
- 检索
- 阈值
- 归一化
- MCP
- 可观测性
model: Node 22 / mcp/server.js 的 search_recipes
problem: 给 MCP 检索加「未命中检测」时，很自然地在返回体里取 top1 的 matchPct，写 「if (topPct < 50) 记为缺口」。上线后缺口日志一条都没有，而 matched 明明是 33——因为 matchPct 是相对 Top1 归一化出来的比例，第一名永远是 100%，这个条件对任何查询都恒为假，分支是死代码。
dead_ends:
- attempt: 用「topPct < 50」判定「库里没有对得上的经验」
  failure: matchPct 的定义是 score / top1Score * 100，Top1 恒等于 100。条件恒假 -> 缺口日志 0 条，而同样这批查询里 matched 高达 33，说明不是真没命中，是判据压根不成立。
  duration: 写完 18 条测试才发现 4 条失败，回头排查约 30 分钟
  early_signal: 日志/计数字段一直为空，但同一条查询的 matched 字段是个正数——两个数字互相矛盾时，先怀疑判据而不是怀疑数据
- attempt: 既然相对值不行，就换成原始分 raw score，取「topScore < 5」当阈值
  failure: 原始分分不开「噪声查询」和「真实查询」。实测：乱输「qqzz 完全不存在的主题」，Top1 原始分是 6；真实问题「爬虫被封 IP 了」，Top1 原始分也是 6。中文二元组切词下，任意查询都能凑出若干个 matched>0 的碎片，分数落在同一个量级。阈值放哪都会同时误杀真查询或漏掉噪声。
  duration: 手动 spawn server 打探针，两种查询各跑一遍，约 20 分钟
  early_signal: 你开始纠结「阈值到底设 4 还是 6」——这本身就是信号：两个分布重叠时，调阈值是徒劳的
- attempt: 觉得「未命中」应该由检索层给出，让检索函数在低分时返回 matched=0
  failure: 语义被污染了。matched 是「命中了几条」的事实计数，把它改造成「我认为你没命中」会让下游所有依赖 matched 的展示与统计一起失真，且不可逆（拿不回真实命中数）。
  duration: 设计阶段否掉，未实施
  early_signal: 想改一个字段的定义来绕开判据问题，而不是改判据本身
solution: ① 先搞清楚分数是怎么算出来的——相对归一化的分数不能当绝对阈值，只有原始分或未归一化的绝对量才有阈值语义。② 优先选结构性事实当判据，而不是分数：这里最终用「matched === 0」（一条都没命中）作为默认判据，因为它是一个不依赖任何刻度的事实。③ 分数阈值降级为可选开关（RECIPE_MISS_SCORE=n，默认不设即不启用），把「要不要用分数判定」的决定权交给部署方，而不是替他猜一个数字。④ 任何新增的判定分支，都要先手动 spawn 服务打探针，用噪声查询和真实查询各跑一遍，看两个分布是否可分——不可分就别用分数。
result: 判据改为「matched === 0」后，噪声查询「12345678 xyzzyqqzz」立刻触发缺口记录（matched=0），真实查询「爬虫被封 IP 了」不触发（matched>0）。18 条断言全绿。同时把「分数阈值不可用」的结论写进 PRD 与代码注释，避免下一个人再踩。
retrospective: 阈值不是数值问题，是刻度问题。你只有在知道「100 是怎么算出来的」之后，才有资格说「小于 50 算低」。归一化分数的 100 不代表「完美匹配」，只代表「我是这批里最高的」——它衡量的是排序位置，不是匹配质量。凡是「相对」的量，都不能拿来当绝对阈值。更一般地：当两个分布（噪声 vs 真实）在可用特征上重叠时，调阈值永远解决不了，只能换一个能把它们分开的特征——这里换成了命中计数这个结构性事实。
harness: mcp/server.js 的 search_recipes 返回体 + tests/gap-hint.test.js
verified: true
status: published
confidence: B
contributor_id: anon-47856d
created_at: '2026-10-08'
---

## 背景与卡点

给 MCP 检索加「未命中检测」时，很自然地在返回体里取 top1 的 matchPct，写 `if (topPct < 50) 记为缺口`。上线后缺口日志一条都没有，而 matched 明明是 33——因为 matchPct 是**相对 Top1 归一化**出来的比例，第一名永远是 100%，这个条件对任何查询都恒为假，分支是死代码。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。

### 复现探针（照着做就能验证）

起服务后分别发两条查询，看返回体的 `matched` 与 `results[0].score`：

- 噪声：`qqzz 完全不存在的主题` → matched=33，topScore=6
- 真实：`爬虫被封 IP 了` → matched>0，topScore=6

两条的原始分一模一样。这说明在这个检索实现下，**分数不具备区分度**，唯一可信的结构性判据是 `matched === 0`。
