---
id: recipe-xhs-upstream-patch-drift-manual-apply
title: '一键脚本里的补丁打不上却只报成功：上游依赖已更新，只能按补丁意图手工对齐配置'
tags:
- patch
- upstream
- python
- git
- environment
model: MediaCrawler 上游框架 + git apply
problem: 项目自带一个"一键装采集器"脚本，做的事是把上游采集框架改成自家配置——关掉"连接已有浏览器"、
  导出格式改成 CSV、单次抓条数上限、关掉评论抓取、用本机已有的 Edge。脚本内部先 clone 再 git apply，
  结果 apply 阶段失败（上游已经更新，上下文行对不上），可脚本对外只吐一段成功日志，真正的问题是补丁压根没进。
dead_ends:
- attempt: 直接重跑一键脚本，让它自己重试 apply
  failure: clone 阶段被"路径已存在 / 目录空"这两件事反复卡住，根本走不到 apply；即便走到也仍然只报同一个
    hunk 失败，而退出码里看不到失败痕迹
  duration: 约 20min
  early_signal: 脚本把"clone 成功 + apply 失败"压成一条成功日志——失败信息不在退出码里，就等于没失败
- attempt: apply 之前先把上游 checkout 到旧版本再打
  failure: 依赖是 zip 取的、上游目录里没有 .git，压根没有可回退的历史，这条路当场断掉
  duration: 约 5min
  early_signal: 依赖来源决定了你能不能回退，先确认来源再看能不能打补丁，别先动手
- attempt: 用 patch -p1 --fuzz=3 强行模糊匹配，能落多少落多少
  failure: 能落下一部分 hunks，但上游已经把这些配置键改名或新增了，fuzz 出来的结果是"改了一个不存在的
    键"，程序不报错、配置也不生效，变成一个更难发现的问题
  duration: 约 10min
  early_signal: 模糊匹配成功不等于语义对齐，改完必须回读目标文件逐行核对
solution: 放弃"让补丁文件生效"，改成读意图 → 手工改 → 语法校验 → 关键行复核四步：① 先把补丁文件通读一遍，
  抽出它想改的配置键名和期望行为，这是唯一真值源；② 在目标仓库里逐条改对应行，每条留一句注释说明为什么这么改；
  ③ py_compile 把所有被改过的 .py 编译一遍，确认语法没问题；④ 用检索把最关键的常量逐个复核（开关应为 False、
  导出应为 csv、单次数上限、注释抓取开关、间隔秒数），确认落盘值就是意图值，而不是上游默认值。
  同时把那条不再能自动生效的一键脚本标注成"需手工对齐"，别让下游以为补丁已经自动打上了。
result: 手工改了 7 处（配置文件 5 处、采集核心文件 2 处），py_compile 全过；之后启动采集直接读到的是改造后的
  配置，上游默认值再也没机会悄悄覆盖回来。
retrospective: 补丁文件的价值是"表达改了什么"，不是"保证能打上"。上游在动、依赖来源又不受你控制时，把补丁当
  说明书读再手工落地；落地验收永远看目标文件里的最终值，不看补丁自己说改没改。
skills:
- python
- git
- patch
harness: git apply + py_compile
hardware:
  os: Windows 11
verified: true
status: published
confidence: A
---

## 背景与卡点

详见 frontmatter 结构化字段；此处供人深读。
