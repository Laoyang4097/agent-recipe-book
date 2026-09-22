---
id: recipe-0002
title: browser-use 自动化卡在登录墙的破局
tags: [browser-automation, login, playwright, browser-use]
model: Hy3
skills: [agent-browser]
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
用 browser-use（或 agent-browser skill）让 Agent 自动登录某站点抓数据，但页面有验证码 / 二次验证 / 弹窗，Agent 反复重试失败，陷入死循环，还差点触发风控锁号。

## 环境
- **模型**：Hy3
- **Skills**：agent-browser
- **Harness**：WorkBuddy
- **Soul**：强调"遇到拦截先停，不要盲试，向用户要一次性凭证"
- **硬件**：RTX 4060 8GB / Win10 19045

## 死胡同
1. 尝试：让 Agent 自己填账号密码反复提交
   - 失败现象：触发风控，账号被临时锁，且 Agent 不报错只是"继续重试"
   - 卡了多久：约 20 分钟，直到锁号
   - 本可提前避开的信号：连续 2 次 401 就该停，而不是继续硬刚
2. 尝试：Agent 截图 OCR 识别验证码
   - 失败现象：滑块 / 点选类验证码 OCR 根本识别不了，且违反站点 ToS
   - 卡了多久：15 分钟
   - 本可提前避开的信号：这类验证码本就不该让 Agent 去攻破

## 最终解法
- 把"需要登录的抓取"改成"用户先手动登录，Agent 接管已登录 session"：用持久化 browser profile 或 cookie 注入。
- 在 skill / 工作流里加护栏：连续 N 次非 2xx，或出现 `验证码 / captcha / 安全验证` 关键词 → 立即暂停并输出"需要你手动完成这步"，而非盲试。
- 对纯公开数据，优先找官方 API / RSS / 静态页，避免走登录抓取。

## 复盘
- 为什么能成：把"Agent 攻破登录"换成"人过关键门槛、Agent 做重复劳动"，职责分离。
- 可泛化：任何带 auth 的自动化都应设计"人过关键门槛，Agent 接手后续"。
- 忠告：给自动化 Agent 设失败熔断，别让它替你硬刚风控。
