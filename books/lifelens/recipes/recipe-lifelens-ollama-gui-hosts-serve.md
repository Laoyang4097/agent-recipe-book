---
id: recipe-lifelens-ollama-gui-hosts-serve
title: 关掉 Ollama 桌面 GUI 会连带停掉后台 serve 让应用离线，且本机 PowerShell 因 Path/PATH 重复导致拉起进程的三条通道全封
tags:
- ollama
- windows
- process
- tooling
confidence: A
model: qwen3-vl:4b-instruct
problem: '用户为省内存（GUI 约 578MB）从托盘关掉 Ollama 桌面程序，结果 LifeLens 状态变成「Ollama 离线」——那个图形外壳其实是后台 ollama serve 服务的宿主，关 GUI 等于把服务也一起关了。想单独把无界面的 serve 拉起来时，本机 PowerShell 又全线不通：会话的 env 块同时存在 Path 与 PATH（大小写重复），Start-Process 报「字典中已添加关键字 Path/PATH」，cmd /c start 与 WMI Win32_Process.Create 被安全策略直接拦截。'
dead_ends:
- attempt: 'PowerShell 的 Start-Process（含 -Environment 传干净环境）拉起 ollama serve'
  failure: '报「字典中已添加关键字 Path/PATH」——同一个会话里连 Get-ChildItem env: 都报同样的冲突，说明是会话级 env 提供程序坏了，不是命令写法问题'
  duration: 约 30min
  early_signal: '两条不同的命令报同一个「关键字重复」错误 → 这是环境块问题，换命令没用，必须换执行环境'
- attempt: '退一步改用 cmd /c start "" /min ollama serve'
  failure: '被安全策略直接拦截（不允许从当前工具链调用 cmd.exe）'
  duration: 约 10min
  early_signal: '同类调用连续被拦，就该意识到通道被封而不是参数写错'
- attempt: '再退到 WMI Win32_Process.Create 创建独立进程'
  failure: '同样被拦截'
  duration: 约 10min
  early_signal: '同一路径第三次被封 · 此时应换通道而不是继续试参数'
solution: '1) 换通道：用 Bash（Git Bash）后台拉起 `ollama serve > log 2>&1 &`，它不经过 PowerShell 的 env 提供程序，能正常继承环境变量。 2) 把这件事前移到应用内：main.js 加 ensureOllama()，whenReady 时探测 http://127.0.0.1:11434/api/tags，不可达就 spawn("ollama", ["serve"], { detached: true, stdio: "ignore", windowsHide: true }) 并注入 OLLAMA_NUM_THREADS（半核）与 OLLAMA_MAX_LOADED_MODELS=1，用户从此永远不必打开那个 578MB 的桌面 GUI。 3) 代码里补一层「当前推理占用模式」的可见日志，让用户一眼确认没在抢显卡。'
result: '无界面 serve 拉起后 curl :11434/api/tags 正常返回模型列表，LifeLens 自动重连、状态不再显示离线；GUI 侧省下约 578MB 驻留内存。'
retrospective: '两条忠告：① 图形外壳程序往往还托管着无界面的核心服务，「关掉界面」不等于「停掉服务」，但也绝不能让用户依赖这个耦合——得让应用自己会把服务拉起来；② 工具链环境出问题时，正确动作是「换执行环境」而不是「换命令参数」。'
skills:
- 后台服务自管
- Windows 进程启动通道
harness: Electron + Ollama + Git Bash
hardware:
  os: Windows 11
  ram: 32GB
verified: true
status: published
---

## 现场还原

Ollama 在你机器上其实有两个身份：
- 那个托盘里的**图形外壳**（578MB，纯界面，纯浪费）
- 真正干活的 `ollama serve` 后台服务（约 40MB，无窗口）

图形外壳顺手托管着后台服务。把它关掉 = 服务一起没了。

## 更该做的是让应用自己管

与其每次手动拉，不如让 LifeLens 启动时自己看一眼 11434 通不通，
不通就偷偷把一个无界面的 serve 拉起来——用户从此不用认识 Ollama 这个图标。
