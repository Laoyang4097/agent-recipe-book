---
id: recipe-redact-rules-true-corpus-first
title: 脱敏规则落地前先拿真库跑一遍：一个文档保留段就废了整条规则
tags:
- 正则
- 脱敏
- 安全
- 验收
- 回归
model: Python 3.13 / 本仓库 recipes/ 44 条
problem: 照 PRD 把 SENSITIVE_PATTERNS 接进 validate() 当闸门。接线前照例在真库上跑了一遍，结果 44 条现有配方里 5
  条被误伤，其中 3 条（讲 PAT / token 怎么用）恰恰是讲凭据的——按原样当闸门，这 5 条永远升不了级。
dead_ends:
- attempt: 把 10.x 整段当私网 IP 拦
  failure: 10.255.255.1 同时是 RFC 1918 私网段和 RFC 5737 文档保留段，现有配方正拿它做「模拟国内不可达」实验，被判定为内网
    IP 误伤
  duration: 实现期当场命中
  early_signal: 误伤清单里三条都在讲 token 用法——规则在拦「讲安全」的配方
- attempt: 把私钥头塞进外层词边界组一起匹配（外层套了词边界锚点）
  failure: 它以连字符开头，前面加词边界锚点后，锚点只存在于非词字符与词字符之间，这类串永远匹配不上，私钥形同虚设
  duration: 实现期当场命中
  early_signal: 写完拿真凭据样本测，RSA / OPENSSH 头零命中
solution: 收紧的是「识别方式」不是「判断标准」：把裸关键词列表改成认凭据形态——键值赋值（键名后紧跟等号或冒号再接若干字符）、各家云厂商的密钥前缀与 Bearer
  头、家目录绝对路径、内网 IP、内网域名。10.x 整段放行，只拦 192.168 与 172.16-31。改完在全库上复跑，零误伤。
result: 全库 44 条零误伤；10 类真实凭据形态全部拦下；讲原理的正常内容不误伤。
retrospective: 写「该拦什么」之前先量「会误伤多少」。规则没在真数据上跑过就接线，等于拿线上当实验场。误伤清单是最好的测试用例——它逼你回答「这条为什么要拦」。另：写这条配方时自己又连撞两脚。第一脚是
  solution 里照抄了几种密钥前缀与家目录绝对路径，被自家规则拦下、不落盘，报错里的命中词还打成了打码标记——一道能拦住写它的人的红线，才算真接上了。第二脚更蠢：为了把正则写进
  frontmatter 我给它套了单引号，以为单引号能保护反斜杠，结果 frontmatter 整个解析不了。实测下来 YAML 单引号只取消引号自身的转义对，其它反斜杠序列照样被解释成退格符一类不可打印字符，正解是写双反斜杠。
skills:
- regex
- 安全
- python
harness: api/ingest.py validate() + api/ingest_write.test.py 的 T1a/T1b/T1c
hardware:
  corpus: recipes/*.md 44 条
verified: 全库零误伤 + 10 类真凭据全拦，both sides 实测
status: published
confidence: B
contributor_id: anon-17753a
created_at: '2026-09-26'
---

## 背景与卡点

照 PRD 把 SENSITIVE_PATTERNS 接进 validate() 当闸门。接线前照例在真库上跑了一遍，结果 44 条现有配方里 5 条被误伤，其中 3 条（讲 PAT / token 怎么用）恰恰是讲凭据的——按原样当闸门，这 5 条永远升不了级。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
