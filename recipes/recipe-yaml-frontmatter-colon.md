---
id: recipe-yaml-frontmatter-colon
title: 手写 YAML frontmatter 时 failure 含冒号被当键值分隔符，渲染/回读直接崩——改用 yaml.safe_dump
tags:
- yaml
- serialization
- tooling
model: Python + PyYAML
problem: '渲染配方 .md 的 YAML frontmatter 时，为图省事用字符串拼接（f-string / 手拼 key: value），结果 dead_ends[].failure
  里出现 ImportError: No module named yaml 这种带冒号的值，被 YAML 当成 ImportError 键、No module
  named yaml 值，整段 frontmatter 解析错位；rebuild 回读报错，新配方没进索引。'
dead_ends:
- attempt: '用 f-string 手拼 frontmatter，如 f''failure: {row[failure]}'''
  failure: '值里含 xxx: yyy 时 YAML 把冒号当分隔符，后续字段整体偏移、解析出非法结构'
  duration: 排查约 15min
  early_signal: 只要 failure/problem 文本里出现冒号（报错信息、URL、时间 12:30 等）就会触发，不是偶发
- attempt: 给值加单引号保护
  failure: 引号配对与内部转义（反斜杠、嵌套引号）又出新错，且不同字段规则不一致难维护
  duration: 约 10min
  early_signal: 手拼引号是打地鼠，根本解法是别手拼 YAML
- attempt: 渲染后没回读校验，直接 commit
  failure: 坏 .md 入库，rebuild 生成的 experiences.json 缺这条、llms.txt 也没它，下游静默缺数据
  duration: 直到下次 rebuild 才发现
  early_signal: 缺一道渲染→回读→断言的闸门，坏文件就能落地
solution: ① frontmatter 永远用 yaml.safe_dump(dict) 生成，它按值类型正确加引号与转义，冒号不再是问题。② 渲染完立刻回读
  yaml.safe_load(frontmatter) 做一次 roundtrip 断言；失败就删文件报错，坏 .md 不入库。③ 不要把生成 YAML 当字符串拼接活——YAML
  是数据格式不是文本。
result: 改用 yaml.safe_dump 后，含冒号、引号、换行的 failure 值全部正确往返；加 roundtrip 闸门后，任何坏渲染在 commit
  前就被拦下。
retrospective: a) 凡要产出结构化文本格式（YAML/JSON/CSV），用库序列化别手拼。b) 渲染→回读双关校验是防止脏数据入库的廉价保险。c)
  报错信息、时间、URL 是最常见的冒号陷阱，别假设值里没有。
skills:
- pyyaml
- serialization
harness: Python + PyYAML
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

渲染配方 .md 的 YAML frontmatter 时，为图省事用字符串拼接（f-string / 手拼 key: value），结果 dead_ends[].failure 里出现 ImportError: No module named yaml 这种带冒号的值，被 YAML 当成 ImportError 键、No module named yaml 值，整段 frontmatter 解析错位；rebuild 回读报错，新配方没进索引。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
