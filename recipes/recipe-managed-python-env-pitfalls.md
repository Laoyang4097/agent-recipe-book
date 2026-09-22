---
id: recipe-managed-python-env-pitfalls
title: 在 WorkBuddy 托管 Python 环境跑依赖脚本的坑（缺包 / 丢 git 身份 / cwd 不持久 / YAML 日期序列化）
tags:
- python
- venv
- git
- workbuddy
- yaml
- ci-cd
model: Hy3
problem: 要在 WorkBuddy 沙箱里跑一个 Python 脚本（项目里的 api/ingest.py，需要 pyyaml 解析 frontmatter），并把改动提交推到
  GitHub。结果连踩几个环境坑：脚本跑不起来、commit 被拒、路径解析错位、JSON 序列化崩。
dead_ends:
- attempt: 直接 `python api/ingest.py rebuild`，指望 managed python 已带 pyyaml
  failure: 'ImportError: No module named yaml，rebuild 直接退出，experiences.json 没生成'
  duration: 2min
  early_signal: 托管环境默认只有标准库，第三方包要先装；报错第一行就说了
- attempt: 装完 pyyaml 后直接 `git commit`，没想身份问题
  failure: 'fatal: Author identity unknown，commit 被拒'
  duration: 1min
  early_signal: 沙箱每次新会话 git 全局身份会丢，commit 前先给本仓库设局部 user.name/email
- attempt: 用相对路径 `api/ingest.py` 跑，以为 cwd 还停在仓库目录
  failure: can't open file '.../api/ingest.py'：路径解析到了工作区根而非子目录
  duration: 3min
  early_signal: Bash 工具的 cwd 不保证跨调用持久，脚本一律用绝对路径或先 cd 到仓库根
- attempt: 装好 pyyaml 跑 rebuild，以为这次稳了
  failure: 'json.dump 抛 TypeError: Object of type date is not JSON serializable，experiences.json
    只写一半(2066字节残档)'
  duration: 5min
  early_signal: 'YAML 把 `created_at: 2026-09-22` 解析成 date 对象，json 无法直接序列化；render/parse
    后给 json.dump 加 default=str 兜底'
solution: ① 建隔离 venv 装依赖：`python -m venv .../envs/default && .../Scripts/pip install
  pyyaml`；② 给本仓库设局部 git 身份 `git config user.name/user.email`（仅本仓库，不污染全局）；③ 所有脚本调用用绝对路径或先
  `cd` 到仓库根；④ 在 json.dump 加 `default=str` 兜底 YAML 日期对象。最终 `ingest.py rebuild` 正常生成
  experiences.json + llms.txt，commit + PAT 内嵌 push 成功。
result: ingest 闭环完整跑通：提交 JSON → 渲染 .md → 重建索引（experiences.json 含 3 条、llms.txt 公开 3
  条），并已 push 到 GitHub main。
retrospective: 托管/隔离 Python 环境的第一性原理：标准库之外啥都没有，依赖要先显式装；git 身份、cwd 这些'我以为还在'的状态在沙箱会话间并不持久。把它们当'每次都要显式初始化'，而不是'应该已经在'。
skills:
- bash
- git
- python-venv
harness: WorkBuddy agentic Bash + managed Python 3.13.12
hardware:
  python: 3.13.12 managed
  os: win32 (Git Bash)
verified: true
status: published
contributor_id: anon-47856d
created_at: '2026-09-23'
---

## 背景与卡点

要在 WorkBuddy 沙箱里跑一个 Python 脚本（项目里的 api/ingest.py，需要 pyyaml 解析 frontmatter），并把改动提交推到 GitHub。结果连踩几个环境坑：脚本跑不起来、commit 被拒、路径解析错位、JSON 序列化崩。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
