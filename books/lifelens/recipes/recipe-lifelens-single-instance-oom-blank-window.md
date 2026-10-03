---
id: recipe-lifelens-single-instance-oom-blank-window
title: 单实例锁竞态造成双实例并存，各自截屏分析导致内存翻倍，渲染进程被挤爆后白屏
tags:
- electron
- ipc
- memory
- concurrency
confidence: A
model: Electron 33
problem: '用户报「打开显示空白」且「占内存很多」。当时有两个 LifeLens 同时在跑：旧「升级式单实例锁」的写法是先 requestSingleInstanceLock() 抢锁，抢不到才去 tasklist 找出其他 LifeLens PID 杀掉、再抢一次锁。这个「抢锁→杀旧→再抢」的竞态窗口里，两个实例会短时并存，各自建窗口、各自跑截屏轮询与模型分析，内存直接翻倍；其中一个进程被内存挤压，渲染进程 OOM 崩溃，页面 did-finish-load 永不触发，窗口就是纯白。'
dead_ends:
- attempt: '先怀疑 GPU 进程初始化失败，给 BrowserWindow 加 disable-gpu 强制软件渲染'
  failure: '白屏照旧——8/6 那版构建已经带 disable-gpu，did-finish-load 仍然不触发，说明病根不在 GPU'
  duration: 约 1 天（8/6 全天排查）
  early_signal: '日志里 disable-gpu 确实生效了，但 did-finish-load 依旧不出现——「开关生效但症状不变」意味着方向错了，应该去找「有没有第二个进程在抢资源」'
- attempt: '反复重打包、重跑数据修复脚本，指望刷新掉白屏'
  failure: '白屏与乱码交替出现，始终没意识到 tasklist 里其实有两组进程；过程耗掉大量时间'
  duration: 约半天
  early_signal: '启动日志里 main.js loaded 与 createWindow() 在 09:23:01 同一秒各出现两次——进程数异常是白屏最该先查的一项'
- attempt: '用 --remote-debugging-port 开 CDP 端口抓渲染进程实时报错'
  failure: 'Electron 直接报 bad option，当前构建不接受这个开关，根本起不来调试端口'
  duration: 约 20min
  early_signal: 'Electron 33 便携构建不接受 --remote-debugging-port；抓渲染错误前应先确认开关是否被构建接受，而不是反复重试'
solution: '1) 去掉「先抢锁、再杀旧、再抢一次」的竞态写法，改为启动时先 killOtherInstances()（tasklist 列出其他 LifeLens.exe 的 PID 后 taskkill /F，正则 /^LifeLens\\.exe\\s+(\\d+)/ 不依赖会话名 "Console"），再用单次 app.requestSingleInstanceLock()；抢不到就 app.quit()，由已有的 app.on("second-instance") 把已有窗口聚焦出来。 2) 保留 disable-gpu 作为无害兜底。 3) 清掉残留进程后重新打包。'
result: '修复后进程列表只剩一组 LifeLens.exe（主进程 + 渲染/GPU 辅助进程，Electron 标准结构），内存恢复正常，白屏消失。对照依据：诊断日志里 createWindow() 由「同一秒两次」回到「一次」。'
retrospective: '两条忠告：① 「内存爆 + 白屏」常常是同一个病根的两个症状（多实例），不要分开治、更不要把白屏归咎于 GPU；② 写单实例锁时，先清场再抢锁是唯一稳的次序，「抢不到才补救」必然留下竞态窗口。'
skills:
- Electron 单实例
- 渲染进程崩溃定位
harness: Electron
hardware:
  os: Windows 11
  ram: 32GB
verified: true
status: published
---

## 现场还原

Electron 的单实例锁是个「看起来很简单、写错就慢性自杀」的东西。
旧写法自以为很聪明——用户又开一个时，把旧的杀掉自己顶上——
但「杀旧」发生在「抢锁失败之后」，这中间那几百毫秒，两个进程都活着。

而 LifeLens 是常驻后台记录仪，只要活着就会轮询前台窗口、跑模型分析。
两个实例 = 两份轮询 + 两份模型推理 = 内存翻倍，然后其中一个被挤崩。

## 正确的次序

```
启动 → 先杀掉所有其他 LifeLens.exe → 再单次 requestSingleInstanceLock()
     → 抢不到就 quit（已有实例会收到 second-instance 事件把窗口聚焦）
```
