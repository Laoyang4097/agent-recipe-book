---
id: recipe-lifelens-asar-files-whitelist-miss
title: electron-builder 的 build.files 是显式白名单，新增共享模块没登记就打包，产物能构建成功但运行时 require 直接崩
tags:
- electron-builder
- packaging
- asar
- node
confidence: A
model: electron-builder 24.13.3
problem: '抽出 ollamaClient.js 作为统一模型护栏后，5 个调用点都改完、node -c 语法检查全过、甚至 rebuild 也“成功”了——但打包后的 exe 一跑就该崩：那个文件根本没进 app.asar。electron-builder 的 build.files 是逐项显式白名单（不是目录通配），新增的顶层模块必须手工登记，否则打包器静默跳过，直到运行时 require 抛 MODULE_NOT_FOUND 才暴露。'
dead_ends:
- attempt: '只信源码 grep——确认 analyzer.js / summary.js / diary.js / qa.js 里都写了 require("./ollamaClient")'
  failure: 'grep 全绿、语法全过、npm run dist 也退出 0，看上去一切正常；直到用 @electron/asar 的 listPackage 核验才发现 ollamaClient.js 压根不在归档里，extractFile 直接抛 "ollamaClient.js was not found in this archive"'
  duration: 秒级暴露（构建后核验阶段）
  early_signal: 'grep 只能证明源码写了 require，证明不了文件进了包。凡是有「文件清单」概念的打包器，打包后必须抽样核验产物而不是信源码'
- attempt: '以为 files 里已有的 "renderer/**/*" 之类通配符能顺带覆盖根目录新 js'
  failure: '通配符只对其自身那条规则生效，根目录零散的平铺 js 不在通配范围内'
  duration: 约 5min
  early_signal: '白名单是精确路径匹配 + 有限的通配语法，新增文件必须单独登记这一行'
solution: '1) package.json 的 build.files 里补一行 "ollamaClient.js"（与 analyzer.js 等平铺模块并列）。 2) 把「打包后抽样核验」固化成习惯：用 @electron/asar 的 listPackage 列出归档、extractFile 分别抓 main.js / 新增模块 / renderer/index.html，确认都取得到且字节数合理。 3) 结论层面：以后每新增一个顶层模块，先改 files 再打包。'
result: '补进 build.files 后重新打包，asar listPackage 含 ollamaClient.js，extractFile 可取回；此前那版「构建成功但缺文件」的 exe 从根上消除。'
retrospective: '一句忠告：打包产物必须抽样验证。源码 grep 通过、语法检查通过、构建退出码为 0，这三件事都不等于「文件真的进了包」——这条链上任何一环单独成立都不够。'
skills:
- electron-builder 文件清单
- 打包产物核验
harness: electron-builder portable
verified: true
status: published
---

## 现场还原

build.files 长这样：

```json
["main.js","preload.js","config.js",...,"analyzer.js",
 "foreground.js","summary.js",  "renderer/**/*", ...]
```

它是**白名单**，不是「打包整个目录」。
新增一个 `ollamaClient.js` 而不加这一行 → 打包器安静地把它丢在门外。

## 那怎么发现

靠「构建成功后立刻核验产物」：

```js
const list = asar.listPackage("dist/win-unpacked/resources/app.asar");
list.includes("/ollamaClient.js")   // false 就是漏了
```
