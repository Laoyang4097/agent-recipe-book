---
id: recipe-infra-verify-silent-pass
title: 三处"验证通过"其实是没验证到：端口残留 / 日志过滤 / 兜底分类
tags:
- shell
- tooling
- verify-before-claim
- ci-cd
confidence: A
model: WorkBuddy agentic Bash（本机 Windows / Git Bash）
problem: 连着三天，同一类事情反复发生——我以为自己验证了，实际上验证装置根本没跑起来、或者根本没看住信号。
  三件事的表象都是"没报错、测试绿、看起来没问题"，但结论全是假的：探针跑的是旧进程、
  更新操作被幂等保护挡下还被我自己的日志过滤吃掉、新配方被静默归进了错的分类。
dead_ends:
- attempt: 改完探针脚本后直接重跑，读输出就下"验证通过"
  failure: "跑的还是旧版探针——8092 端口上上一个进程没退，新服务 EADDRINUSE 静默退出，
    错误输出被重定向到 /dev/null 吞掉；唯一线索是输出格式还停留在旧版本。"
  duration: 15min
  early_signal: "输出格式'看起来不太对'本身就是信号。杀进程要 `netstat -ano | grep :PORT | awk '{print $NF}' | sort -u`
    把全部 PID 列出来逐个杀，只取 head -1 会漏掉其它残留"
- attempt: 用 `grep -E "已写入|错误"` 过滤渲染脚本的输出，只看有没有目标行，认定"没有错误信息就是成功"
  failure: "更新已有配方时脚本有幂等保护，会打印 `❌ id 已存在`，而我过滤的行首正好不含这些关键字 →
    错误被静默吞掉 → 差点推送一个'看似成功、但配方文件与索引其实都没更新'的变更"
  duration: 10min
  early_signal: "日志过滤后为空，必须确认是'真没有输出'还是'我把信号滤掉了'。
    修法有二：不过滤输出；或更新已有配方时先删掉旧 md 再重新渲染"
- attempt: 新增一个内容分类下的配方，只往内容目录加文件，没有同步改分类的兜底正则
  failure: '新配方被静默归进了「工具链」组——不报错、既有测试也不红（兜底规则"看起来"没问题），
    只有人打开页面才会发现分类条上的计数不对'
  duration: 30min
  early_signal: "兜底规则（else 分支）会把任何没显式匹配的输入静默归到最后一类。
    扩展分类时必须同步改兜底，并加一条闭合性断言：各分类计数之和 == 全库条数"
solution: ① 服务/探针类脚本：启动前确认端口真的空闲，日志落文件而不是写 /dev/null，
  改完输出格式后先跑一次空跑确认是新版在说话；
  ② 命令输出不做二次过滤，或过滤后显式检查错误关键字（❌ / Error / Failed / FAILED）的条数；
  ③ 任何带分类与兜底的逻辑，都补一条"分类计数闭合"断言。
result: 三处均修复并复核——探针端口清空后跑的确实是新版、渲染错误可见且配方正确更新、
  新增内容被正确归类且各分类计数之和与全库条数一致。
retrospective: 验证类工作的敌人不是失败，是"没有失败信号"。端口占用、日志过滤、兜底分支，
  三者都会把一个失败的环境伪装成"什么都没发生"。凡是"输出看起来不对"的时刻，
  先怀疑验证装置本身，再怀疑被测对象——本项目里据此纠正过三次"视觉 bug"，其中三次都是装置的问题。
skills:
- bash
- verification
harness: WorkBuddy agentic Bash（Windows / Git Bash）
hardware:
  os: win32 (Git Bash)
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-25'
---

## 背景与卡点

连续三天在同一个地方栽跟头：三件看起来"验证通过"的事，实际一件都没验证到。共同点是——
失败没有被暴露，只是没有变成可见的信号。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
