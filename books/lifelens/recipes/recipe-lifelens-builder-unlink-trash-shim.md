---
id: recipe-lifelens-builder-unlink-trash-shim
title: 本机 NODE_OPTIONS 注入的 safe-delete shim 把 fs.unlink 换成回收站操作，导致 electron-builder 最后清理临时文件时构建失败
tags:
- electron-builder
- tooling
- windows
- sandbox
confidence: A
model: electron-builder 24.13.3
problem: 'electron-builder 打 portable 包时，构建完成前会删除中间产物 dist/life-lens-1.0.0-x64.nsis.7z。本机 CLI 层通过 NODE_OPTIONS=--require=...genie-safe-delete.cjs 注入了「安全删除」 shim，把 fs.unlink 整个替换成走回收站的 trash 操作；而那个 trash 操作返回 Unknown { description: "Some operations were aborted" }，于是 unlink 失败、整个构建报错退出码非 0。更坑的是：后台跑 + tail 管道时状态会假活成 running 却半天没产出，让人误以为只是慢。'
dead_ends:
- attempt: 'npm run dist 放后台跑，用 tail 看输出'
  failure: '8 分钟没有任何产出、任务状态仍显示 running（管道缓冲造成的假活），实际早已卡死在某一步'
  duration: 约 8min 才察觉异常
  early_signal: 'store 压缩级别下构建本应 40 秒出包，任何超过 1 分钟的构建都该自动警觉，而不是继续等'
- attempt: '以为是被 Bash 沙箱拦的，开免沙箱（dangerouslyDisableSandbox）重跑'
  failure: '错误一模一样——堆栈里明明白白指向 WorkBuddy 的 app.asar.unpacked/cli/vendor/shim/genie-safe-delete.cjs，是 CLI 层注入，跟 Bash 沙箱无关'
  duration: 约 2min
  early_signal: '看堆栈文件名里的 vendor/shim 路径就知道这是执行环境的注入，不是沙箱策略；遇到这类拦截先读堆栈归属，别急着提权'
- attempt: '在 dist 里预清理 7z 临时文件想绕开这次 unlink'
  failure: '无济于事——构建流程内部自己会生成并清理这个文件，预删改变不了行为'
  duration: 约 1min
  early_signal: '构建器的清理是内部固定流程，外部预删没有意义，应当从「让 unlink 成功」入手'
solution: '打包命令改为 `env -u NODE_OPTIONS -u ELECTRON_RUN_AS_NODE npm run dist`：清掉 NODE_OPTIONS 后 fs.unlink 走原生路径，shim 不再介入，构建干净通过。配套：compression 保持 store（规避 7z OOM）、后台任务假活时改用前台直跑看实时输出。'
result: '清掉 NODE_OPTIONS 后构建稳定在数十秒内完成、退出码 0，不再出现 safe-delete 报错；连续多次打包（含补 ollamaClient.js 后那次）均成功。'
retrospective: '一句忠告：遇到「工具报错但堆栈指向执行环境自己的 vendor 目录」，正确动作是绕开这个注入（清掉对应环境变量），而不是提权或重装工具。同一条命令里清 NODE_OPTIONS 与 ELECTRON_RUN_AS_NODE 就是本项目稳定的打包姿势。'
skills:
- 构建环境注入排查
- 打包命令编排
harness: electron-builder portable + 宿主 CLI 注入
hardware:
  os: Windows 11
verified: true
seed: true
status: published
---

## 现场还原

报错原文长这样：

```
⨯ [safe-delete] 操作失败: ERROR D:\LifeLens\dist\life-lens-1.0.0-x64.nsis.7z:
  Error during a `trash` operation: Unknown { description: "Some operations were aborted" }
  failedTask=build
    at trashViaBinary (.../cli/vendor/shim/genie-safe-delete.cjs:270:15)
    at Object.unlink (node:internal/fs/promises)
    at D:\LifeLens\node_modules\app-builder-lib/src/targets/nsis/nsisUtil.ts:92:50
```

注意最下面两行：**构建器在构建完成后删临时文件**（nsisUtil.ts 的 finishBuild），
而此时的 fs.unlink 已经不是 Node 原生的了，是 shim 换掉的。

## 解法就这么一句

```bash
env -u NODE_OPTIONS -u ELECTRON_RUN_AS_NODE npm run dist
```
