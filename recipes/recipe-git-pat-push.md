---
id: recipe-git-pat-push
title: 用 fine-grained PAT 推 GitHub：Bearer 头被 git 忽略，必须 URL 内嵌 token 当 Basic Auth
tags:
- git
- ci
- auth
- tooling
model: Git 2.x + GitHub fine-grained PAT
problem: '用 fine-grained PAT 推 GitHub 时，想用 git -c http.extraheader=Authorization:
  Bearer <token> 免输凭证，结果 git 仍要 username、推送失败。后来发现 git 的 smart-HTTP 走 Basic Auth，Bearer
  头被忽略，必须把 token 嵌进 URL 当 Basic 凭据；推完还得把 remote URL 里的 token 还原，否则 token 明文留在 .git/config。'
dead_ends:
- attempt: 'git -c http.extraheader=Authorization: Bearer <pat> push origin main'
  failure: 'git 仍弹出 username 提示或直接 remote: Invalid username or password；Bearer 头没被当作凭据'
  duration: 约 10min
  early_signal: git smart-HTTP 走 Basic Auth 而非 Bearer；extraheader 设了，但 git 内部用空白 username
    发 Basic，自然 401
- attempt: 把 remote URL 写成 https://<pat>@github.com/owner/repo.git 直接 push
  failure: 推送成功，但发现 token 明文留在 .git/config，公开或协作即泄漏
  duration: 秒级
  early_signal: URL 内嵌 token 能推，但 push 后必须立刻 git remote set-url origin <无 token 地址>
    还原
- attempt: fine-grained PAT 缺对应 scope 时去写 .github/workflows/
  failure: 403 Resource not accessible by integration；一度以为是 token 错
  duration: 排查约 20min
  early_signal: 403 可能是 scope 不足（Workflows 需单独授予），不是 token 失效；看错误里的 Resource not accessible
solution: ① git smart-HTTP 用 Basic Auth，Bearer 头无效；正确做法是把 PAT 嵌 URL（git push https://<pat>@github.com/owner/repo.git），推完立刻
  git remote set-url origin https://github.com/owner/repo.git 抹掉 token。② 不想碰本地 credential，可走
  Git Data API（blobs→tree→commit→PATCH ref），token 仅经环境变量、完全不落盘。③ fine-grained PAT
  写 workflow 文件需单独授予 Workflows 权限，否则 403。
result: 实测：Bearer extraheader 失败；URL 内嵌 token 推送成功；推完 set-url 还原后 .git/config 无 token
  残留；走 Git Data API 推送全程 token 不落盘、不污染 remote URL。
retrospective: a) git 不是带 token 的普通 HTTP 客户端，它守 Basic Auth 老规矩。b) 任何把 token 写进 URL/配置的方案，推完必须还原。c)
  写 workflow 文件前先确认 PAT 有 Workflows scope。d) 不想碰 credential 就把 token 当环境变量喂 API 脚本，比塞
  URL 安全。
skills:
- git
- github-api
harness: Git + GitHub
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

用 fine-grained PAT 推 GitHub 时，想用 git -c http.extraheader=Authorization: Bearer <token> 免输凭证，结果 git 仍要 username、推送失败。后来发现 git 的 smart-HTTP 走 Basic Auth，Bearer 头被忽略，必须把 token 嵌进 URL 当 Basic 凭据；推完还得把 remote URL 里的 token 还原，否则 token 明文留在 .git/config。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
