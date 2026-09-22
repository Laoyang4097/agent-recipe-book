---
id: recipe-0002
title: browser-use 自动化卡在登录墙的破局（人过门槛 Agent 接手）
tags: [browser-automation, login, playwright, browser-use]
model: Hy3
problem: 用 browser-use（或 agent-browser skill）让 Agent 自动登录某站点抓数据，页面有验证码/二次验证/弹窗，Agent 反复重试失败陷入死循环，还差点触发风控锁号。
dead_ends:
  - attempt: 让 Agent 自己填账号密码反复提交
    failure: 触发风控，账号被临时锁，且 Agent 不报错只是"继续重试"
    duration: 20min
    early_signal: 连续 2 次 401 就该停，而不是继续硬刚
  - attempt: Agent 截图 OCR 识别验证码
    failure: 滑块/点选类验证码 OCR 根本识别不了，且违反站点 ToS
    duration: 15min
    early_signal: 这类验证码本就不该让 Agent 去攻破
solution: 改成"用户先手动登录，Agent 接管已登录 session"（持久化 browser profile 或 cookie 注入）；加护栏连续 N 次非 2xx 或出现 captcha 关键词立即暂停；纯公开数据优先找官方 API/RSS/静态页。
result: 实测人工过登录门槛后，Agent 接管抓取稳定跑完，未再触发风控。
retrospective: 把"Agent 攻破登录"换成"人过关键门槛、Agent 做重复劳动"，职责分离；任何带 auth 的自动化都应设计失败熔断。
skills: [agent-browser]
harness: WorkBuddy
hardware: {os: Windows 10 19045, cpu: Intel i5-10210U, gpu: NVIDIA RTX 4060 8GB, ram: 8GB}
agent_config: 强调"遇到拦截先停，不要盲试，向用户要一次性凭证"（已脱敏）
verified: true
status: published
contributor_id: anon-example-0002
created_at: 2026-09-23
---

## 解法步骤（护栏示例）

### 人过关键门槛
用户手动登录目标站点，Agent 接管已登录的浏览器 session（持久化 profile 或注入 cookie）。

### Agent 侧护栏（伪代码）
```
if consecutive_non_2xx >= N or "captcha" in page_text:
    pause_and_ask("需要你手动完成这步，我不盲试")
```

### 优先公开数据
对纯公开数据，优先找官方 API / RSS / 静态页，避免走登录抓取。
