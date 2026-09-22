---
id: recipe-0001
title: 误删 shell 环境变量后快速还原（不重装）
tags: [env, recovery, powershell]
model: Hy3
problem: 在 Windows 上误执行覆盖 PATH 的操作，导致当前会话命令行找不到 node/python，重启终端后仍不完整。不想重装任何环境。
dead_ends:
  - attempt: 手动 set PATH 把记得的路径一个个拼回去
    failure: 漏掉散落路径（npm global、python scripts、git bin），每次跑新命令又报"不是内部或外部命令"
    duration: 40min
    early_signal: 系统级 PATH 其实还在注册表里，直接从"环境变量"面板复制即可，不必手拼
  - attempt: 用 refreshenv（旧 Chocolatey 命令）刷新
    failure: 本机没装 Chocolatey，命令不存在
    duration: 5min
    early_signal: 应先 where refreshenv 确认命令是否存在
solution: 先取系统级 PATH 回灌当前会话；永久修复写回用户变量；动 PATH 前先备份。
result: 实测回灌后命令全部恢复，无需重装。
retrospective: 先分清会话级 vs 系统级 PATH——系统级没丢，回灌即可；任何环境变量被改坏都可从系统级回灌。
skills: [find-skills]
harness: WorkBuddy
hardware: {os: Windows 10 19045, cpu: Intel i5-10210U, gpu: NVIDIA RTX 4060 8GB, ram: 8GB}
agent_config: 偏好"先诊断再修复、给可复制命令"的助手（已脱敏）
verified: true
status: published
contributor_id: anon-example-0001
created_at: 2026-09-23
---

## 解法步骤（可复制命令）

### 临时恢复当前会话
```powershell
$sys = [Environment]::GetEnvironmentVariable("PATH","Machine")
$usr = [Environment]::GetEnvironmentVariable("PATH","User")
$env:PATH = "$sys;$usr"
```

### 永久修复
Windows 搜索"编辑系统环境变量" → 高级 → 环境变量，确认系统变量 PATH 完整；或一行写回用户变量：
```powershell
[Environment]::SetEnvironmentVariable("PATH", "$sys;$usr", "User")
```

### 防再犯
动 PATH 前先备份：
```powershell
[Environment]::GetEnvironmentVariable("PATH","Machine") | Out-File paths-backup.txt
```
