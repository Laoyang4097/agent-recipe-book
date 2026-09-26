---
id: recipe-unreachable-branch-in-engine
title: 生产路径走不到的分支也要单测它：否则又是一段没人走的死代码
tags:
- 测试
- 死代码
- 内核
- 覆盖率
model: Python 3.13 / api/ingest.py
problem: promotion_errors() 里「dead_ends 四段不全不能升 B」这条分支，按常规路径根本走不到——submit_recipe 的
  validate_submit 已经把四个子字段卡死，投稿时过不来的东西晋升时不可能缺。按正常路径写测试，直接被 submit 挡了回来。
dead_ends:
- attempt: 照着正常链路写 promote 测试：先 submit 一份缺字段的稿、再 promote
  failure: submit 阶段就报「缺 early_signal」，promote 根本没被调用——测的是 submit 的门禁，不是晋升的门禁
  duration: M2 加固期
  early_signal: 报错来自 submit 而不是 promote，日志里的函数名不对
solution: 单测直接打 promotion_errors()，绕开上游门禁单独验证这条分支：既要证明它还在守门，也不能因为从入口测不到就当它不存在。
result: 39/39 通过，晋升门槛每条分支都有断言守着。
retrospective: 这正是当年 SENSITIVE_PATTERNS 写成死代码的同一个坑：规则写好了、没人调用、没人发现。凡是「上游已经拦了」才显得多余的分支，恰恰是最容易悄悄失效的地方——它是最后一道门，不是多余的那道。
skills:
- 测试
- python
- 内核设计
harness: tests/ingest_write.test.py 的 T5k/T5l/T5m
hardware: {}
verified: 直接单测 promotion_errors 各分支均返回预期 field
status: published
confidence: B
contributor_id: anon-17753a
created_at: '2026-09-26'
---

## 背景与卡点

promotion_errors() 里「dead_ends 四段不全不能升 B」这条分支，按常规路径根本走不到——submit_recipe 的 validate_submit 已经把四个子字段卡死，投稿时过不来的东西晋升时不可能缺。按正常路径写测试，直接被 submit 挡了回来。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
