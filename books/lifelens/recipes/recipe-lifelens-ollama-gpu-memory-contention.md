---
id: recipe-lifelens-ollama-gpu-memory-contention
title: 本地 Ollama 默认把视觉模型整个塞进 GPU 显存，抢走用户 RTX 4060 的显存，必须在每个请求里强制 num_gpu_layers=0
tags:
- ollama
- gpu
- vlm
- performance
confidence: A
model: qwen3-vl:4b-instruct
problem: 'LifeLens 用本地 qwen3-vl:4b 做截屏视觉分析。Ollama 的 API 在 options 不指定的时候，num_gpu_layers 默认取「尽可能多」，于是 3.3GB 的模型权重整个加载进用户那张 RTX 4060 8GB，和用户同时跑的其它 AI 项目抢同一张卡——用户侧的体验就是「开着 LifeLens 就没法同时跑别的 AI 项目」。更要命的是项目里有 5 处独立调用点（视觉分析、命名校验、10 分钟汇总、日记、问答），每一处都只传了 temperature 一个参数，等于 5 个口子全在吃显卡。'
dead_ends:
- attempt: '想用环境变量 OLLAMA_USE_GPU=false 让 Ollama 全局走 CPU'
  failure: '部分 Ollama 版本直接忽略该变量，显存照样被吃满，GPU 占用没有变化'
  duration: 约 20min
  early_signal: '环境变量是进程级全局开关，无法按请求调节；而且它不是 Ollama 的正式参数名——看到「显存没降」就应该换到 API options 层试'
- attempt: '在 serve 进程级限制并发 / 常驻模型数，试图降低整体占用'
  failure: '只能影响并发度，管不住单个请求把模型塞进 GPU；其它调用方也会被连带降级'
  duration: 约 30min
  early_signal: '需求本质是「这一次请求别占显存」，不是「全局降级」，在进程级做必然夹不干净'
- attempt: '只改 analyzer.js 一处（以为是单点问题）'
  failure: '改完发现汇总、日记、问答几处仍在吃 GPU——模型调用点分散在多个模块，单点修复等于没修'
  duration: 约 15min
  early_signal: 'grep 计数发现 5 个 fetch("/api/chat") 调用点，说明该抽共享模块而不是逐个改'
solution: '1) 抽出共享模块 ollamaClient.js，导出两个函数：buildModelOptions(cfg, temperature) —— analysisGpuMode 为 cpu（默认）时强制写入 num_gpu_layers: 0（完全不占 GPU 显存）与 num_thread = 物理核一半（给其它程序留 CPU 余量）；withModelGate(fn) —— 全局链式互斥，任意时刻最多 1 个推理在飞。 2) 把 5 个调用点（analyzer 2 处、summary、diary、qa）的 options 一律换成 buildModelOptions()，请求体包进 withModelGate。 3) 配置化 analysisGpuMode / cpuThreads，gpu 模式显式标注「会和你其它 AI 任务抢卡」。 4) config 层把浏览器、聊天类软件从 titleAlwaysModelApps 移出，走窗口标题规则分类，直接砍掉大量模型调用。'
result: '冒烟测试确认 CPU 模式产出 {"temperature":0.2,"num_gpu_layers":0,"num_thread":8}；GPU 模式不加限制参数；互斥闸门 3 个并发任务实测串行执行（并发峰值 = 1）。5 个调用点全部接入护栏，新 asar 核验通过。'
retrospective: '一句话忠告：Ollama 的 GPU 行为只能在单次 API 请求的 options 里强制，环境变量不可靠；而「别让用户电脑卡」这类需求，得先把散落各处的模型调用点收敛到一个共享模块，否则永远修不干净。'
skills:
- Ollama API options
- GPU 显存配额
harness: Electron + Ollama
hardware:
  os: Windows 11
  gpu: RTX 4060 8GB
  ram: 32GB
verified: true
status: published
---

## 现场还原

Ollama 的 /api/chat 请求体长这样：

```json
{ "model": "qwen3-vl:4b-instruct", "stream": false,
  "options": { "temperature": 0 } }
```

注意 options 里只有 temperature —— Ollama 于是用默认值 num_gpu_layers = 尽量多，
把模型整个搬上 GPU。一张 8GB 的卡，就这么被一个后台截图工具占满了。

正确姿势是在 options 里写死 `num_gpu_layers: 0`：模型在内存里跑 CPU 推理，
GPU 显存占用归零，代价只是慢一点——而对「事后回溯我今天干了啥」这种场景，慢完全可接受。
