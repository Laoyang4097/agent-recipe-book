# 配方（Recipe）字段规范 v1.0

每条配方是一个独立的 Markdown 文件，存放于 `recipes/` 目录，文件名用 `kebab-case` 并带 `example-` 前缀（示例）或你的命名空间前缀。

本规范刻意对齐 **Anthropic Agent Skills** 的开放标准（纯 Markdown、无 SDK 即可被 30+ Agent 产品读取），因此每条配方头部采用 YAML frontmatter。

## 字段定义

```yaml
---
id: recipe-0001                # 全局唯一，建议 recipe-XXXX 自增
title: 简短描述这条配方解决什么
tags: [browser-automation, login, playwright]   # 小写连字符，便于聚类
model: Hy3                     # 解题用的主模型，如 Hy3 / Deepseek-V4.1-flash
skills: [agent-browser, find-skills]   # 用到的 skill 列表（可空）
harness: WorkBuddy             # 运行环境/客户端，如 WorkBuddy / Cursor / Claude Code
hardware:                      # 尽量完整，助复现
  cpu: Intel i5-10210U
  gpu: NVIDIA RTX 4060 8GB
  ram: 8GB
  os: Windows 10 19045
contributor: anonymous         # 可填 anonymous / 昵称 / 脱敏后的标识
created_at: 2026-09-23
source_conversation: null      # 可选：脱敏后的会话摘要或片段链接
---
```

## 正文结构（Markdown）

正文必须包含以下四级标题，顺序不限但建议一致：

### ## 问题
清晰描述你原本想解决什么、约束是什么。避免含糊，要让读者 30 秒看懂"卡在哪"。

### ## 环境
- **模型**：主模型及版本（如 Hy3、Deepseek-V4.1-flash）。
- **Skills**：用到的 skill（如 `agent-browser`、`find-skills`）。
- **Harness**：运行客户端（如 WorkBuddy、Cursor）。
- **Soul / Agent.md**：脱敏后的角色设定要点（**必须洗掉个人标识、真实姓名、专属路径**）。
- **硬件**：见 frontmatter 的 `hardware` 字段。

### ## 死胡同（重点）
这是配方最值钱的部分。每个失败尝试用一个子列表，结构化记录：

```
1. 尝试：<你做了什么>
   - 失败现象：<报什么错 / 行为偏离预期的具体表现>
   - 卡了多久：<分钟/小时/天>
   - 本可提前避开的信号：<回头看，哪个早期迹象能让你少走弯路>
```

复杂情况允许 3–5 个死胡同条目，不要省略关键细节。

### ## 最终解法
给出可复用的具体步骤（命令、配置、Prompt 要点），让后人照做能破局。

### ## 复盘
- 这次为什么能成（与死胡同的对比）。
- 哪些经验可泛化到其他场景。
- 给后来者的 1 句忠告。

## 脱敏红线（写入前必查）

| 必须清洗 | 处理方式 |
|---|---|
| 真实姓名、学号、工号 | 替换为 `anonymous` / 昵称 |
| API Key / Token / 密码 | 一律删除，绝不留痕 |
| 内网 URL、内部系统地址 | 删除或泛化（如 `internal-portal` ） |
| 绝对文件路径含用户名 | 改为相对路径或 `<USER>` 占位 |
| 含他人隐私的聊天原文 | 征得同意或脱敏后引用 |

硬件规格（CPU/GPU/RAM/OS）**不是敏感信息**，请完整保留——它是可复现性的关键。

## 兼容性说明

- 头部 frontmatter 供机器解析；正文 Markdown 供人类与 Agent 共读。
- 遵循 Agent Skills 约定后，本仓库的 `recipes/*.md` 可被直接当作 skill 引用，无需改写。
- `llms.txt` 会把所有配方索引给外部 Agent。
