---
id: recipe-web-headless-setinterval-timeout
title: 无头 DOM 桩回归前端轮播 JS 时 setInterval 让进程永不退出，须 spawnSync(timeout) 包一层
tags:
- web-test
- headless
- web-debug
confidence: B
model: "与模型无关（纯 Node/测试事实，任何模型都能复现）"
problem: 用 Node 迷你 DOM 桩无头跑前端轮播/动画 JS 做回归，代码里有 setInterval 驱动轮播，进程因定时器常驻而不退出，CI/串联脚本卡死。
dead_ends:
- attempt: 跑完断言后 process.exit(0)
  failure: setInterval 的定时器句柄仍挂起，Node 事件循环不空，exit 不触发或退出码异常，父脚本拿不到输出就挂等
  duration: 30min
  early_signal: 脚本「跑完却不返回」十有八九是定时器/监听没清
- attempt: 在桩里把 setInterval 桩成空函数
  failure: 轮播逻辑依赖定时器推进，桩空后逻辑不前进，断言全假阴性
  duration: 15min
  early_signal: 不能为了退出而删掉被测逻辑依赖
solution: "用 spawnSync(childCmd, {timeout: N}) 包一层跑桩进程，超时强制回收；桩内保留真实 setInterval 让逻辑前进，靠外层 timeout 截断常驻。"
result: spawnSync(timeout:5000) 包住后，桩跑完断言即被回收，父脚本稳定拿到 stdout 不卡死。
retrospective: 无头回归里「常驻定时器」是隐形挂起源；让被测逻辑照常跑，用外层硬超时截断，别去阉割定时器。
harness: WorkBuddy
verified: true
status: published
seed: false
contributor_id: anon-7b2e4d
created_at: '2026-10-17'
---

## 背景与卡点

用 Node 迷你 DOM 桩无头跑前端轮播/动画 JS 做回归，代码里有 setInterval 驱动轮播，进程因定时器常驻而不退出，CI/串联脚本卡死。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
