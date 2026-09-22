---
id: recipe-0001
title: 误删 shell 环境变量后快速还原（不重装）
tags: [env, recovery, hy3, powershell]
model: Hy3
skills: [find-skills]
harness: WorkBuddy
hardware:
  cpu: Intel i5-10210U
  gpu: NVIDIA RTX 4060 8GB
  ram: 8GB
  os: Windows 10 19045
contributor: anonymous
created_at: 2026-09-23
source_conversation: null
---

## 问题
在 Windows 上误执行了覆盖 `PATH` 的操作（某脚本或手抖命令），导致当前会话命令行找不到 node / python，重启终端后部分恢复但仍不完整。不想重装任何环境。

## 环境
- **模型**：Hy3
- **Skills**：find-skills（查恢复方法）
- **Harness**：WorkBuddy
- **Soul**：偏好"先诊断再修复、给可复制命令"的助手
- **硬件**：Intel i5-10210U / RTX 4060 8GB / 8GB RAM / Win10 19045

## 死胡同
1. 尝试：手动 `set PATH` 把记得的路径一个个拼回去
   - 失败现象：漏掉散落路径（npm global、python scripts、git bin），每次跑新命令又报"不是内部或外部命令"
   - 卡了多久：约 40 分钟
   - 本可提前避开的信号：系统级 PATH 其实还在注册表里，直接从"环境变量"面板复制即可，不必手拼
2. 尝试：用 `refreshenv`（旧 Chocolatey 命令）刷新
   - 失败现象：本机没装 Chocolatey，命令不存在
   - 卡了多久：5 分钟
   - 本可提前避开的信号：应先 `where refreshenv` 确认命令是否存在

## 最终解法
- 临时恢复当前会话：先取系统级 PATH，再拼回用户级
  ```powershell
  $sys = [Environment]::GetEnvironmentVariable("PATH","Machine")
  $usr = [Environment]::GetEnvironmentVariable("PATH","User")
  $env:PATH = "$sys;$usr"
  ```
- 永久修复：Windows 搜索"编辑系统环境变量" → 高级 → 环境变量，确认"系统变量 PATH"完整；或一行写回用户变量：
  ```powershell
  [Environment]::SetEnvironmentVariable("PATH", "$sys;$usr", "User")
  ```
- 防再犯：动 PATH 前先备份 `[Environment]::GetEnvironmentVariable("PATH","Machine") | Out-File paths-backup.txt`

## 复盘
- 为什么能成：先分清"会话级 vs 系统级"PATH——系统级其实没丢，只是当前会话被改，回灌即可。
- 可泛化：任何"环境变量被改坏"都可从系统级变量回灌，不必重装。
- 忠告：动 PATH 前先备份，别等坏了才找。
