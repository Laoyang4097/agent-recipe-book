---
id: recipe-tmp-gitbash-vs-windows-python
title: Git Bash 的 /tmp 和 Windows Python 眼里的 /tmp 不是同一个目录
tags:
- git-bash
- windows
- 临时目录
- 跨层调用
model: Git Bash + Windows Python 3.13
problem: '测试脚本按 Linux 习惯往 /tmp 写临时 JSON 再喂给 Python，Python 报 FileNotFoundError: ''/tmp/o1.json''
  —— 在 Git Bash 里 /tmp 被翻译成它自己的目录，在 Windows 解释器眼里 /tmp 根本不存在。'
dead_ends:
- attempt: 改成相对路径 ./tmp/o1.json
  failure: 两边对当前目录的理解又不一样，问题平移而非消失
  duration: 实现期
  early_signal: 同一个路径在 bash 和 python 里解析出两个地方
solution: 改用两边都认的临时目录绝对路径，测试里统一用它，不再写 /tmp。
result: 跨 Git Bash 与 Windows Python 的取数不再出错。
retrospective: 凡是 bash 层与 Python 层共享的路径，都得挑「两边都认」的那个。Linux 的路径直觉在 Windows 上是要付费的。
skills:
- bash
- windows
- python
harness: tests/write-mcp.test.js 与 CLI 提交均走该目录
hardware:
  os: win32 (Git Bash)
verified: 实测双向可用
status: published
confidence: B
contributor_id: anon-17753a
created_at: '2026-09-26'
---

## 背景与卡点

测试脚本按 Linux 习惯往 /tmp 写临时 JSON 再喂给 Python，Python 报 FileNotFoundError: '/tmp/o1.json' —— 在 Git Bash 里 /tmp 被翻译成它自己的目录，在 Windows 解释器眼里 /tmp 根本不存在。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
