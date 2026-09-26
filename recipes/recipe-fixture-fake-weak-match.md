---
id: recipe-fixture-fake-weak-match
title: 自己造的弱命中探针是假的：断言自己实现了自己的期望值
tags:
- 测试
- 假绿
- 检索
- 断言质量
model: Node 22 / lib/search.js
problem: 想测「匹配度不够的 C 级被压住、不返回」，造了一条只在 problem 里蹭到关键词的 C。结果它跟强命中同分，matchPct 恒 100%——断言绿得毫无意义，等于什么都没验。
dead_ends:
- attempt: 把关键词写进探针的 title 里凑内容
  failure: 那两个字吃到标题权重（+2），和强命中配方打平，弱命中根本没弱下来
  duration: M2 加固期当场命中
  early_signal: 断言通过得意外地顺——一个本该失败的场景一次就过了，通常说明构造本身有问题
- attempt: 直接用关键词去查全库，想找个零命中的词
  failure: '''zzz-nonexistent-word-绝无此词'' 被切成二元组，组里两字都命中了真实配方，命中了不该命中的东西'
  duration: 紧接上一轮
  early_signal: 「绝无此词」居然 matched=true
solution: ① 关键词绝不出现在探针的 title 里，只放在 problem/body；② 定断言前先把 raw 分数打出来量一遍，确认弱命中确实弱；③
  选一个在真库里零命中的词做「全库无命中」探针。
result: R-1..R-5 五条破例露头规则全部得到真实覆盖，25/25 通过。
retrospective: 假绿比红危险。红灯会逼你去看实现，绿灯让你以为看过了。凡是「该失败却一次就过」的断言，先怀疑测试自己。
skills:
- 测试
- node
- 检索
harness: tests/search-quarantine.test.js 的 R-1..R-5
hardware: {}
verified: 分数实测：弱命中 < 阈值，强命中 > 阈值，破例露头仅 Top1
status: published
confidence: B
contributor_id: anon-17753a
created_at: '2026-09-26'
---

## 背景与卡点

想测「匹配度不够的 C 级被压住、不返回」，造了一条只在 problem 里蹭到关键词的 C。结果它跟强命中同分，matchPct 恒 100%——断言绿得毫无意义，等于什么都没验。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
