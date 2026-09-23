---
id: recipe-git-api-push-stale-ref
title: 走 API 推送后本地显示 ahead N：本地 origin 指针的陈旧假象
tags:
- git
- tooling
- ci
model: Deepseek-V4.1-Flash
problem: 用 Git Data API 直接向远端提交后，本地 git status 一直显示领先远端若干个提交，看起来像「还有东西没推上去」。
dead_ends:
- attempt: 按 git status 的 ahead 计数判断本地还有未推送内容
  failure: 误导性结论：API 推送不会更新本地远端跟踪引用，ahead 是假象，内容其实早已同步
  duration: 15min
  early_signal: 推送走的是 API 而不是 git push，本地引用自然不会被刷新
- attempt: 在受限网络里直接 git fetch 想把指针拉回来
  failure: 目标站点被网络策略节流，fetch 走不通
  duration: 10min
  early_signal: 推送能通不代表 fetch 能通：两者可能走不同域名（API 域 vs 站点域），受限程度不同
- attempt: 拿远端 commit 的 SHA 作为本地 diff 基准
  failure: 'fatal: bad object —— 远端 commit 不在本地对象库里，git 无法解析'
  duration: 10min
  early_signal: 本地没有的对象不能当 diff 基准；应改用本地已有的父提交
- attempt: 用同一个 API 推送脚本处理「含 git mv（重命名/移动文件）」的提交
  failure: FileNotFoundError：脚本按变更清单逐个读取本地文件，而被移动/删除的旧路径在本地已不存在，直接抛异常、推送中断
  duration: 5min
  early_signal: git diff-tree --name-only 给出的是「变更清单」而不是「现存文件清单」——被删除的路径也会出现在里面，读文件前必须先判断存在性
solution: '① 用「内容比对」而非「引用计数」判断同步：逐文件对比本地内容与远端 API 返回内容，或对比 tree SHA；② diff 基准改用本地
  HEAD~1 等本地存在的提交；③ 推送脚本对每个变更路径先判断本地是否存在：存在则上传 blob，不存在则在 tree 中以 "sha": null 表示删除；④
  网络恢复后在正常网络执行一次 git fetch && git reset --hard origin/main 把指针对齐。'
result: 内容层面确认本地与远端零差异（本地有远端无 = 无、远端有本地无 = 无）；推送脚本改为运行时动态获取远端 SHA 作父提交、并按存在性区分「上传」与「删除」，含文件移动的提交也能一次推成功。
retrospective: git 的本地引用是缓存而非真相。绕过 git 推送时本地状态会失真 —— 判断同步与否要看内容，不要看计数器。同理，git 输出的「变更清单」是变更视角、不是现状视角：含删除/移动时，必须按存在性分支处理，否则脚本会在最不该崩的地方崩（推送中途）。
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

用 Git Data API 直接向远端提交后，本地 git status 一直显示领先远端若干个提交，看起来像「还有东西没推上去」。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
