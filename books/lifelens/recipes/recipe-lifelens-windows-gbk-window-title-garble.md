---
id: recipe-lifelens-windows-gbk-window-title-garble
title: Windows 中文窗口标题经 PowerShell 传给 Node 变乱码，需走 base64 跨代码页传输
tags:
- electron
- windows
- encoding
- powershell
confidence: A
model: qwen3-vl:4b-instruct
problem: 'LifeLens 要记录前台窗口标题（大量中文）。主进程用 PowerShell 取前台窗口的进程名与标题，再交给 Node 落库。中文系统下 PowerShell 默认走 GBK(936) 代码页，Node 侧按 UTF-8 解管道，结果「图片视频」变成 `ͼƬ����Ƶ` 这种不可逆乱码，沉淀进 data/*.json 后整条活动记录报废。'
dead_ends:
- attempt: '让 PowerShell 直接输出中文字符串（System.Windows.Forms 取 Text），Node 用 utf8 读管道'
  failure: '落库出现 `ͼƬ����Ƶ`——GBK 字节被当 UTF-8 解码，U+FFFD 替换符反复出现，中文标题全部损坏'
  duration: 跨 8/2 与 8/4 两轮，约 3 小时
  early_signal: '同一段中文在不同 Charset 输出下表现不一致；中文 Windows 的 PowerShell 默认代码页是 936(GBK)，不是 UTF-8——看到标题里的中文「半截」就该警觉是代码页问题'
- attempt: '改 Node 侧解码 charset（试各种 fallback / iconv 重新编码补救）'
  failure: '不同 charset 下同一段中文结果仍不一致，且出现过的 U+FFFD 无法还原——源头字节已经丢了，解码端永远补不回来'
  duration: 约 1 小时
  early_signal: 'U+FFFD 替换符一旦出现就是不可逆损坏标记。它出现意味着「修复方向应该是别处」而不是继续调解码参数'
- attempt: '修好 foreground.js 的 base64 链路后，用户仍报「好像又有乱码」'
  failure: '代码明明改对了，新数据照样乱码：启动日志显示同一秒 createWindow() 出现两次，旧 exe 持有单实例锁不退出，继续往库里写脏数据'
  duration: 约半天（8/4 全天反复）
  early_signal: '乱码文件的 mtime 在我刚跑完修复后仍在跳动；启动日志里 main.js loaded 与 createWindow() 各出现两次——这是「跑的不是新代码」的直接证据'
solution: '1) 传输层根治：PowerShell 侧 `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s))` 只输出纯 ASCII，Node 侧 `Buffer.from(line.slice(idx+1),"base64").toString("utf8")` 还原，彻底不碰系统代码页。 2) 防御层：新增 sanitize() 在落库前剥离 U+FFFD（正常中文/emoji 不受影响），加在 foreground.js 解码后、main.js 的 buildTitleActivity 与模型输出、summary.js 的 parseSummaryResponse 三处。 3) 清理层：reanalyze.js 定点重算被污染的记录。 4) 根上层：单实例锁改为能杀掉残留旧实例，否则旧 bug 版本永远在写脏数据。'
result: '全库遍历 data/ 下所有 .json，U+FFFD 字段计数归零；base64 链路对抗测试通过；sanitize 对抗测试 6/6（替换符剥离、中文与 emoji 完好）。'
retrospective: '两条忠告：① 跨代码页传中文，base64 是金标准，永远不要赌 PowerShell/Node 的管道编码；② 「修了 bug 但现象还在」时，先质疑「用户跑的到底是不是新代码」，而不是反复改同一处——单实例锁让旧进程永不退是这类「修复不生效」的系统性陷阱。'
skills:
- 跨代码页编码
- 防御式数据清洗
harness: Electron + PowerShell + Ollama
hardware:
  os: Windows 11
  gpu: RTX 4060 8GB
verified: true
status: published
---

## 现场还原

前台窗口标题是 LifeLens 最敏感的数据源——它决定「你在用哪个软件、在看什么文件」。
而 Windows 中文环境下，PowerShell 与 Node 的沟通天然存在代码页鸿沟。

## 为什么 base64 是解

base64 把任意字节流变成纯 ASCII 字符串，管道里传的只有字母数字和 `+/=`，
不经过任何「按代码页解释」的环节。等 Node 拿到再用 UTF-8 解回来，中文原样还原。
