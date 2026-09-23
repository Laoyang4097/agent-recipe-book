---
id: recipe-py-highlevel-tool-fake-pitfall
title: 用高层抓取工具产出的坑多半是假的：11 条配方被整批拒收
tags:
- scrape
- tooling
model: Deepseek-V4.1-Flash
problem: 用高层 WebFetch 工具批量抓公开页来生成「采集踩坑」配方。产出的 11 条结构完整、看着也像模像样，但复盘时发现它们根本不能代表真实采集场景。
dead_ends:
- attempt: 用高层 WebFetch 工具批量抓公开页，把返回结果里的异常当作「目标站的坑」写成配方
  failure: 11 条整体不合格：死胡同大多是 WebFetch 工具自身的限制（自动解码、自动转 markdown、无头不可控），换成真实 HTTP 客户端根本复现不了
  duration: 复盘时整批发现（非单点阻塞）
  early_signal: 若一条「坑」换掉工具就消失，那它是工具的坑，不是目标站的坑
- attempt: 接受工具返回的「已解码 / 已转 markdown」内容，直接当原始响应来分析
  failure: 基于二次加工后的内容得出的结论全部失真（误判编码问题、误判反爬行为）
  duration: 复盘时整批发现
  early_signal: 高层工具会替你吃掉底层细节，而这些细节恰恰是采集坑的全部内容
- attempt: 配方 frontmatter 统一标注 model 为 Hy3
  failure: 与实际执行者不符，属事实性错误标注
  duration: 复盘时发现
  early_signal: model 这类元字段要如实填写实际执行者，不能沿用模板占位值
solution: 弃用高层工具产配方。改用真实 Python requests 脚本逐条重跑采集任务，基于原始响应（状态码 / 响应头 / 字节流）判定坑点；原
  11 条整批移入 docs/deprecated/webfetch-noise/ 留痕而非静默删除，另产出 12 条可复现配方。
result: 重跑产出的 12 条配方全部可用真实 requests 复现；被拒的 11 条归档保留，可追溯「哪些被否掉、为什么否掉」。
retrospective: 用高层封装工具采集，采到的是「工具层的坑」而非「目标站点的坑」。要产出可直接复用的采集经验，必须用裸 HTTP 客户端拿到未经二次加工的原始响应
  —— 否则你记录的只是你所依赖的那个工具的行为。
harness: WorkBuddy
hardware:
  os: Windows 10 22H2
  cpu: i5-10210U
  gpu: 集成显卡 UHD
  ram: 8GB
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-24'
---

## 背景与卡点

用高层 WebFetch 工具批量抓公开页来生成「采集踩坑」配方。产出的 11 条结构完整、看着也像模像样，但复盘时发现它们根本不能代表真实采集场景。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
