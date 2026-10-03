---
id: recipe-lifelens-portable-execpath-temp-trap
title: portable 自解压版 exe 的 process.execPath 指向 %TEMP% 临时目录，写进自启和快捷方式会导致开机弹窗与双击失效
tags:
- electron-builder
- portable
- windows
- autostart
confidence: A
model: Electron 33 + electron-builder 24.13.3
problem: 'dist/LifeLens.exe 是 electron-builder 产出的 portable 自解压壳，体积 294MB。双击后它把真正可运行的程序解压到 %TEMP%<随机名>\ 再执行，因此运行期 process.execPath 永远指向那个临时目录（约 189MB 的真身在那儿）。代码里把 process.execPath 当作「程序自己的路径」写进注册表开机自启和桌面 .lnk，于是自启项和快捷方式全指向一个随时会被系统清理、且每次运行名字都变的临时路径——开机时 Windows 去启动已失效的 exe，弹出 cmd 报错窗口；桌面图标也会「没反应」。'
dead_ends:
- attempt: '先怀疑是病毒扫描器锁文件 / 文件占用，让构建方等待解锁重试'
  failure: 'electron-builder 打出 output file is locked for writing (maybe by virus scanner) => waiting for unlock，等了一会依旧失败，且该文件根本没人占用'
  duration: 约 20min（7 月一次构建）
  early_signal: '构建器自己提示 waiting for unlock 但全程无人占用该文件——说明锁不是真因；真正该问的是「为什么构建器要删这个文件、删不掉意味着什么」'
- attempt: '改用 PowerShell COM（WScript.Shell）读取并修正桌面 .lnk 与注册表自启项'
  failure: '工具链直接拦截：COM object instantiation can run arbitrary code (e.g. WScript.Shell)，命令一片空白'
  duration: 约 15min
  early_signal: '同类 COM 调用连续被拦，说明该通道被硬封；读 .lnk 应改走二进制解析而不是 COM'
- attempt: '用 strings 从 .lnk 二进制里抓目标路径字符串'
  failure: 'strings: command not found；改用 iconv + UTF-16 转码后仍然 grep 不到路径（.lnk 内嵌路径为 UTF-16LE 且不在容易命中的偏移上）'
  duration: 约 10min
  early_signal: 'Git Bash 是精简环境、没装 binutils。遇到「命令不存在」应先换用 Python 正则扫 UTF-16LE 字节序列，而不是反复试字符串工具'
solution: '1) 代码层加统一解析器 resolveSelfPath()：process.env.PORTABLE_EXECUTABLE_DIR 存在（electron-builder 便携版会注入该环境变量）时返回 path.join(dir, "LifeLens.exe") 即固定安装路径，否则回退 process.execPath（开发模式）。 2) 用它替换全部三处 process.execPath：buildDesktopShortcut 的 lnk TargetPath、托盘菜单开机自启、whenReady 里的 setLoginItemSettings。 3) 手动把注册表 HKCU\\...\\Run 的 electron.app.LifeLens 改写为 "D:\LifeLens\dist\LifeLens.exe" --hidden。 4) 删掉指向旧 Temp 路径的桌面 .lnk（新 exe 首次运行会自动重建正确的），并清理 %TEMP% 下残留的解压目录（约 280MB）。'
result: '注册表自启项核实为 `"D:\LifeLens\dist\LifeLens.exe" --hidden`；新 asar 内 resolveSelfPath 函数、PORTABLE_EXECUTABLE_DIR 定位、三处替换全部为 true，旧的 `path: process.execPath` 写法已清零；Temp 残留目录清理成功。'
retrospective: '一句话忠告：portable 版 Electron 的 process.execPath 永远是 %TEMP% 里的解压路径，任何需要长期有效的路径（开机自启、桌面快捷方式、更新器、日志落盘）都必须用 PORTABLE_EXECUTABLE_DIR 重新定位。这也顺带解释了此前「快捷方式双击没反应」这类反复出现的诡异现象。'
skills:
- electron-builder portable 行为
- Windows 启动项与 .lnk
harness: Electron + electron-builder portable
hardware:
  os: Windows 11
  cpu: 16 核
  gpu: RTX 4060 8GB
verified: true
seed: true
status: published
---

## 现场还原

同一个 exe 有两个身份：
- 磁盘上那个 294MB 的**自解压壳**（`D:\LifeLens\dist\LifeLens.exe`）
- 运行时被它解压出来的 189MB **真身**（`%TEMP%\3I6Mz...\LifeLens.exe`）

`process.execPath` 永远返回后者。而 `PORTABLE_EXECUTABLE_DIR` 由打包器注入，
值恒为 `D:\LifeLens\dist`——这才是我要的「固定身份」。

## 排查顺序

1. `reg query HKCU\...\Run` 看自启项到底指向谁
2. 从 .lnk 二进制里扫 UTF-16LE 找出实际 TargetPath
3. 两者都指向 %TEMP% → 定位为 portable 路径陷阱，而非病毒/权限问题
