---
id: recipe-atomic-write-half-file
title: 边写边渲染会留 0 字节烂尾文件
tags:
- 原子写
- 文件IO
- python
- 数据完整性
model: Python 3.13 / api/ingest.py
problem: 写配方落盘时先 open(path, "w") 截断文件、再写 f.write(render_md(record))。render_md 一旦抛错，文件已被截成
  0 字节，磁盘上留下一个读不出来的空壳，且没任何东西提示写入失败。
dead_ends:
- attempt: 用 try/except 兜住 render 异常，继续往下走
  failure: 异常时的目标文件已是 0 字节——截断发生在渲染之前，顺序反了
  duration: 实现期写落盘内核时命中
  early_signal: 磁盘上出现一个存在但内容为空的配方文件，全库文件数却没变
solution: 先把正文算成完整字符串 text = render_md(record)，再 open 落笔；渲染失败则一个字节都不碰。另外加一道 _roundtrip_ok
  回读校验，不通过就删掉刚写的文件并报错。
result: 失败路径不留半成品；成功路径落盘内容可被原样读回。
retrospective: 原子性不是「写错了再删掉」，是「根本不让半成品存在」。截断与渲染的先后顺序，决定了异常时你是干净的还是烂的。
skills:
- python
- 文件IO
harness: api/ingest.py 的 _write_recipe
hardware: {}
verified: 渲染异常时不产生任何文件；往返校验失败时删除残留
status: published
confidence: B
contributor_id: anon-17753a
created_at: '2026-09-26'
---

## 背景与卡点

写配方落盘时先 open(path, "w") 截断文件、再写 f.write(render_md(record))。render_md 一旦抛错，文件已被截成 0 字节，磁盘上留下一个读不出来的空壳，且没任何东西提示写入失败。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
