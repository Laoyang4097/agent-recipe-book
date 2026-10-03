---
id: recipe-xhs-playwright-persistent-login-msedge
title: '要留下登录态就必须用持久化上下文，可浏览器下载卡死：直接复用系统里的 Edge，别硬下 150MB'
tags:
- playwright
- headless
- browser
- session
- windows
model: Playwright (Python) + Microsoft Edge
problem: 这一环的要求是"开着看得见的浏览器 → 人扫码登录 → 登录态留在本机 → 之后每次冷启动都能接着用"。
  Playwright 里只有持久化上下文（launch_persistent_context）能把登录态留在磁盘上，而它默认要额外下载一个
  自带 chromium（约 150MB），这条链路里下载又被卡住。项目自带的"连接已有浏览器"开关是关着的——两条路都不通，
  看起来只能放弃持久化登录态。
dead_ends:
- attempt: 先把 playwright 包装上，指望它顺带把 chromium 拉下来
  failure: 包装上了，chromium 的下载始终不动；就算侥幸下完，持久化上下文还会为这个 profile 再起一整套浏览器
    进程，等于又多出一个要下载的东西
  duration: 约 10min 后放弃
  early_signal: 接口体积和依赖体积差着一个量级时，先问一句"这台机器现成有没有能用的浏览器"
- attempt: 先让人手动登录一遍，然后打开 CDP 模式去连那个已经开着的浏览器
  failure: 项目配置里"连接已有浏览器"是关着的，在沙箱化的执行环境里改开也连不上，反而多了一个失败点、
    还把原来的持久化路线冲掉了
  duration: 约 15min
  early_signal: 想绕开下载就先别引入第二种连接方式，否则失败点翻倍
- attempt: 改成无头模式加临时目录，指望不登录也能抓
  failure: 目标站点对未登录态直接回"登录已过期"，一条数据都拿不到——这里要抓的内容本来就必须登录才看得见
  duration: 约 10min
  early_signal: 抓的东西必须登录才可见时，登录态就不是可选项是硬前提
solution: 走"用系统现成的浏览器"这条路：launch_persistent_context 加 channel="msedge"，让 Playwright 直接驱动
  系统里已经装好的 Microsoft Edge（Windows 上基本都有），既不用下载任何浏览器，登录态照样落在持久化目录里；
  同时把"连接已有浏览器"这条开关保持关闭（两种连接方式必须二选一，同时开只会互相打架）。另外这条链路需要看得见的
  浏览器（人要扫码），启动必须脱离沙箱后台执行，否则浏览器根本起不来；跑的过程中人别把窗口关掉——关掉窗口会直接
  把这一批抓取中断，日志里只会留下一个看起来像代码 bug 的浏览器关闭异常。
result: 启动后日志出现登录成功的界面判定，持久化目录里留下登录态；之后冷启动直接复用、不用再扫码，单次抓取稳定
  产出几十条样本。中途被人关窗一次，日志只报浏览器被关闭而不是业务报错，据此确认这类任务需要人在场。
retrospective: '我要持久化登录态和必须下载一个浏览器之间，本来就没有必然关系——先看系统里现成有什么，再决定要不要
  拉依赖。另外凡是需要人扫码的长任务，本身就是不可无人值守的，把它当一次性人工步骤排期，而不是塞进自动流水线。'
skills:
- python
- playwright
- windows
harness: launch_persistent_context
hardware:
  os: Windows 11
verified: true
status: published
confidence: A
---

## 背景与卡点

详见 frontmatter 结构化字段；此处供人深读。
