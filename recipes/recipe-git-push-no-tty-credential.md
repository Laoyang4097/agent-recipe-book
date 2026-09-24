---
id: recipe-git-push-no-tty-credential
title: Git Bash 无 tty 下推 GitHub：extraheader 被忽略、credential-manager 弹不了窗
tags:
- git
- github
- windows
- tooling
- pat
confidence: A
model: WorkBuddy agentic Bash（本机 Windows / Git Bash / PortableGit）
problem: 手上有 fine-grained PAT，想在无人值守的 Git Bash 里推 GitHub。
  连试两条"标准做法"都失败，且失败信息都指向同一个假象——git 在问"你的 username 是什么"。
  本条与 recipe-git-pat-push 是同一件事的第二层：那条记录了 Bearer 头无效（HTTP 层），
  这条记录了凭据获取层在无 tty 环境下同样走不通。
dead_ends:
- attempt: '沿用在文档里见过的 `git -c http.extraheader="Authorization: Bearer $TOK" push origin main`（整段含冒号，故此处整体加引号）'
  failure: 仍然报 `could not read Username for 'https://github.com'`。
    注意这条与 recipe-git-pat-push 记录的症状完全一致——**同一个坑隔了几天的第二次踩**。
    当时那条配方的解法是「把 PAT 嵌在 URL 里当 Basic Auth」，这次没照做，直接走了错的那条路。
  duration: 5min
  early_signal: '凡是要靠 `-c` 传 http 头的写法，都只在单次调用里生效，且不落盘；
    一旦 git 需要向凭证子系统追问（而不是从 header 拿到），它就会退回交互问用户名'
- attempt: 什么都不配，指望 PortableGit 自带的凭据管理器自己弹窗要 token
  failure: '报 `bash: line 1: /dev/tty: No such device or address` +
    `error: failed to execute prompt script (exit code 1)` +
    `fatal: could not read Username for "https://github.com"`。
    根因是 PortableGit 的 credential.helper 指向
    `git-credential-manager.exe`（Win10 凭据管理器 GUI 弹窗），
    而 agentic / 非交互 shell 没有 tty，弹不出来 → 直接判失败。'
  duration: 15min
  early_signal: '非交互环境里凡是「弹窗」类的解法的共同失败点是 /dev/tty 不存在。
    先确认 credential.helper 指向什么：`git config --list --show-origin | grep -i credential`'
- attempt: 把 PAT 写进 ~/.git-credentials 后，用 Python `os.chmod(path, 0o600)` 收紧权限
  failure: 写完复查权限位仍是 0o666——Windows 没有 POSIX 权限位，chmod 是空操作。
    好消息是 Windows 下该文件默认只属于当前用户，实际风险可控，但**别以为 chmod 过就安全了**。
  duration: 2min
  early_signal: 'Windows 上 os.chmod 对 .git-credentials 无效；若在意，
    改放到只有自己能读的位置，或用 `icacls file /reset` 显式设置 ACL'
solution: '① 绕开凭据管理器：`git config --local credential.helper store`
  （写仓库本地配置，不污染全局）；
  ② 在 `~/.git-credentials` 写一行 `https://<username>:<PAT>@github.com`；
  ③ 正常 `git push origin main`，git 会自己去凭据文件里取。
  好处是此后所有 push 都不必再带 token，也不用在 .git/config 里留下明文 remote URL。'
result: 三条死路走完后按上述解法一次推送成功（`317a861..cff2801`），
  CI 与 GitHub Pages 均正常触发。
retrospective: 这个坑被记录过一次，第二次还是踩了——**因为读配方的人（当时的我）没有把
  解法抄进自己的流程，只是记住了"有这条坑"**。配方库的价值不在「机械地罗列坑」，
  而在「下次动手前先看一眼 solution」。凡是 solution 里有可以直接复制的一行命令的坑，
  就别只把它当故事读。另外，「非交互环境」是一个应单独记档的约束维度：
  它让几乎所有「弹窗 / 交互确认」类的标准解法同时失效。
skills:
- git
- github
- windows
harness: WorkBuddy agentic Bash（Windows / Git Bash / PortableGit）
hardware:
  os: win32 (Git Bash)
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-25'
---

## 背景与卡点

手上有一枚 fine-grained PAT，要在无人值守的环境里推 GitHub。前一条配方
（`recipe-git-pat-push`）已经记录过「Bearer 头无效、必须 Basic Auth」这一层，
但**没有覆盖凭据获取层**——而在非交互 shell 里，正是这一层挡住了路。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。

### 这次的新信息

旧配方记的是 HTTP 层的坑（header 无效）。这次暴露的是**同一件事的第二层**：
即使解决了 header 问题，git 仍会去问「username 是什么」，而它问的这个动作，
在非交互环境里必然失败——因为获取 username 的动作被委派给了凭据管理器的 GUI 弹窗。

所以判断标准要换成：**不是「git 认不认这个 token」，而是「git 拿凭证的这个动作，
在当前的/tty 环境下是否可完成」**。

### 一条可复制的命令

```bash
git config --local credential.helper store
# ~/.git-credentials 写一行：
# https://<username>:<PAT>@github.com
git push origin main
```
