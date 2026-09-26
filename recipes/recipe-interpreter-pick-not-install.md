---
id: recipe-interpreter-pick-not-install
title: 不是缺依赖是挑错了解释器：默认配置下开闸必然失败，而测试全绿
tags:
- python
- mcp
- 环境
- 测试
- 假绿
model: Node 22 / Git Bash / Windows 10
problem: 写侧 MCP 开闸后 submit_recipe 100% 失败，回执写着「❌ 未安装 pyyaml，无法安全渲染 frontmatter，请先
  pip install pyyaml」。但 venv 里明明装了 pyyaml，命令行直接跑 api/ingest.py 也完全正常——唯独经由 MCP 调用必挂。
dead_ends:
- attempt: 按报错字面处理，认定是依赖缺失，去 pip install pyyaml
  failure: 装了也没用：缺的依赖根本不在报错提及的那个解释器里，换一个解释器就能跑通同一个脚本
  duration: 跨 2 轮（M2 加固 + 现场验收）
  early_signal: 同一个脚本命令行能跑、经 MCP 就失败，矛盾点不在「装没装」，在「跑的是哪个解释器」
- attempt: 给 server.js 解析器回退链写成 process.env.PYTHON || "python"
  failure: PATH 上的 python 是不带 pyyaml 的 managed 解释器，带 pyyaml 的在另一个 venv；按名字猜必猜到错的那个
  duration: 跨 2 轮
  early_signal: 报错信息伪装成依赖问题，把排查引向完全错误的方向
- attempt: 只在测试进程里加解释器挑选（按能否 import yaml 筛），测试就绿了
  failure: 12 项断言全过，但用户拿到的默认配置下一次都跑不通——测试进程替用户把环境准备做掉了
  duration: 跨 2 轮
  early_signal: 验收脚本第一次调 submit_recipe 就失败，而同一套 npm test 刚刚 exit=0
solution: ① 按能力筛不按名字猜：候选逐个试 `python -c "import yaml"`，能 import 的才选；② 把挑选逻辑下沉到 lib/pybin.js，读写侧与测试共用同一份，不再各挑各的；③
  选中的解释器打到 stderr，让人看得到它选了谁；④ 挑不出可用解释器时，报错直接点名是哪个解释器、候选有哪些，而不是回一句「未安装 pyyaml」。
result: 现场验收六幕全过：投稿落盘并进隔离池 → 主检索搜不到 / list_quarantine 看得到 → 脱敏命中被拦且命中词打码 → promote
  B 成功 → rebuild 后检索搜得到 → recipes/ 零残留。npm test exit=0。
retrospective: 「测试绿了」只证明在测试自己的环境配置下能跑通，不证明用户拿到手的默认配置能跑通。测试进程里做的环境准备，等于替用户把坑填了。验收要看用户真正拿到的那个配置。这条教训在当天重复出现了三次。
skills:
- python
- node
- mcp
- 测试策略
harness: WorkBuddy agentic Bash + Node 22.22.2 + Git Bash
hardware:
  python: 3.13.12 managed + venv（两个都能叫 python）
  os: win32 (Git Bash)
agent_config: RECIPE_BOOK_WRITE=1 开写闸；RECIPE_BOOK_PYTHON 可强制指定解释器
verified: 现场验收六幕实测通过，不含推断
status: published
confidence: B
contributor_id: anon-17753a
created_at: '2026-09-26'
---

## 背景与卡点

写侧 MCP 开闸后 submit_recipe 100% 失败，回执写着「❌ 未安装 pyyaml，无法安全渲染 frontmatter，请先 pip install pyyaml」。但 venv 里明明装了 pyyaml，命令行直接跑 api/ingest.py 也完全正常——唯独经由 MCP 调用必挂。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
