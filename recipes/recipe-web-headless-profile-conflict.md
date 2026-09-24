---
id: recipe-web-headless-profile-conflict
title: 连续跑多个 headless 实例报 exit 23：用户数据目录被抢占
tags:
- tooling
- headless
confidence: A
model: Deepseek-V4.1-Flash
problem: 连续截两张图，第二张报 exit code 23、截图文件根本不生成。
dead_ends:
- attempt: 原样重跑同一个命令
  failure: 仍报 exit 23，文件依旧不生成
  duration: 5min
  early_signal: 第一张成功、第二张失败，说明是实例之间的相互干扰而非命令本身错
- attempt: 怀疑页面渲染太慢导致超时
  failure: 增大等待时间无效，退出码仍是 23
  duration: 8min
  early_signal: exit 23 是浏览器进程启动阶段的失败，不是渲染超时
solution: 给每个 headless 实例指定独立的 --user-data-dir（如 ./_edgeprofile1、./_edgeprofile2），避免争夺同一个
  profile 目录。
result: 加独立 --user-data-dir 后连续多次截图全部成功。
retrospective: headless 不等于无状态 —— 它仍然会去抢用户数据目录并加锁。批量跑截图时必须隔离 profile。
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

连续截两张图，第二张报 exit code 23、截图文件根本不生成。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
