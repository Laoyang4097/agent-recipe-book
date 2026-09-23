---
id: recipe-py-ua-diff-nonbrowser
title: requests 默认 UA 遭差异对待：同 200 却 290 字符 vs 17626 字符正文，另有 403/444/跳登录
tags:
- anti-bot
- scrape
model: Agent+Python requests
problem: 用 requests 默认 UA（python-requests/2.34.2）抓公开页，站方按 UA 差异处理：同一搜索站同为 200 却返回被裁剪的骨架页；问答站直接
  403 JSON；短视频站 444；而有的站（代码托管）对 UA 完全不敏感。只看 status 会把残缺页当成功。
dead_ends:
- attempt: requests 默认 UA 抓某搜索站公开首页，按 status==200 认为成功
  failure: 默认 UA 返回 200 但仅 2,443 字节、去标签正文 290 字符；换浏览器 UA 后同一 URL 200 返回 29,506 字节、正文
    17,626 字符（≈60 倍），默认 UA 拿到的是残缺骨架
  duration: 每次约 42s（该搜索站响应慢）
  early_signal: 两 UA 的响应体 sha1 不同（3aea39f7fdb8 vs de6f7b406a8e），body_text 290 vs 17626
- attempt: 默认 UA 抓某问答站首页
  failure: 返回 403，Content-Type=application/json，body 214 字节：'{"error":{"message":"您当前请求存在异常，暂时限制本次访问。...","code":40362}}'
  duration: 约 42s
  early_signal: status=403 且响应体是 JSON 错误对象（非 HTML 页面）
- attempt: 默认 UA 抓某短视频站首页
  failure: '返回 444，body 仅 115 字节：''Access Denied / X-TT-System-Error: 3'''
  duration: 约 42s
  early_signal: status=444、body 115 字节、body_text 51 字符
- attempt: 以为『换浏览器 UA』是通用解，对所有站照搬
  failure: 某问答站换 UA 后不再 403，但改成 302 跳 '//<问答站域名>/signin?next=%2F'（撞登录墙）；某代码托管站两 UA
    结果完全相同（576,887 vs 576,888 字节、正文均 144,263 字符），UA 根本不影响
  duration: 秒级 ~ 42s
  early_signal: 问答站 status 403→302 且 Location 指向 signin；代码托管站两 UA 长度/正文几乎一致
solution: 可跑要点：① 抓取前统一显式设置浏览器 UA（Chrome UA + Accept/Accept-Language 头）。② 不要只看 status：同一
  200 下比对响应长度 / 正文长度 / 哈希，识别『骨架页 vs 完整页』。③ 换 UA 后仍 302 跳登录或 403 的，说明还需 Cookie/登录态或
  headless（本案例问答站）。④ 逐站判断，别假设 UA 万能（代码托管站为反例）。⑤ 遇 403/444 记录后立即停，不改用代理绕过。⑥ 附带：中文页默认编码常被误判为
  ISO-8859-1，取文本前要修。
result: 实测：某搜索站 默认UA 200/2,443B/正文290 vs 浏览器UA 200/29,506B/正文17,626；某问答站 默认UA 403
  JSON(214B) vs 浏览器UA 302→signin；某短视频站 默认UA 444(115B) vs 浏览器UA 200(72,914B)；某代码托管站
  两 UA 均 200 且正文均 144,263 字符（无差异）。
retrospective: UA 是『第一道门』：设了才有资格拿正常页；但设了不等于拿到内容——问答站仍撞登录墙、代码托管站根本不看 UA。判断成功与否要看正文长度/哈希而非
  status，且必须逐站验证。
harness: Python requests
verified: true
status: published
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

用 requests 默认 UA（python-requests/2.34.2）抓公开页，站方按 UA 差异处理：同一搜索站同为 200 却返回被裁剪的骨架页；问答站直接 403 JSON；短视频站 444；而有的站（代码托管）对 UA 完全不敏感。只看 status 会把残缺页当成功。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
