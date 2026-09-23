# 阶段B 配方提交存档 · 2026-09-23

本目录存放 **阶段B 采集垂直配方的「写入契约」原始 JSON**（Agent 提交物）。
它们是 `recipes/recipe-py-*.md` 的**来源**：按 `recipe.schema.md` v3.0 契约提交 JSON，经 `api/ingest.py ingest` 渲染为 `.md`，再由 `rebuild` 重建索引。

> 单一真值源仍是 `.md` 的 frontmatter；本目录 JSON 仅作**溯源与复审**用，不参与构建。

## 提交清单（12 条）

| JSON | 主题 | tags |
|---|---|---|
| recipe-py-encoding-mojibake | 中文站默认编码 ISO-8859-1 致乱码 | encoding, scrape |
| recipe-py-portal-html-noise | 门户列表页 HTML 噪声（板块/广告混杂） | scrape, selector |
| recipe-py-pagination-ignored-param | 分页参数被静默忽略 + 去重 | pagination, scrape |
| recipe-py-spa-empty-shell | SPA 空壳（200 却正文 0 字符、99.9% JS） | scrape, headless |
| recipe-py-table-merged-cells | 表格合并单元格错位 | scrape, selector |
| recipe-py-ua-diff-nonbrowser | 默认 UA 遭差异对待（骨架/403/444） | anti-bot, scrape |
| recipe-py-antibot-stop-on-hit | 反爬 403 命中即停、零绕过 | anti-bot, scrape, headless |
| recipe-py-ratelimit-silent-headers | 限流走响应头静默反映（RateLimit-Remaining） | scrape, rate-limit, timing |
| recipe-py-http-redirect-timeout-tls | 重定向/超时/SSL/gzip 的 HTTP 层坑 | scrape, timing, session |
| recipe-py-session-cookie-lost | `requests.get` 间 cookie 丢失，Session 才保留（本轮新增） | session, scrape |
| recipe-py-content-encoding-double-decode | Content-Encoding 已自动解压，手动再解即崩；br 缺库静默乱码（本轮新增） | encoding, scrape |
| recipe-py-html-entities-not-decoded | 文本未 `html.unescape`，手写 replace 链顺序二次解码（本轮新增） | selector, encoding |

## 纪律

- **零编造**：每条 `dead_ends` 均来自真实 `requests` 执行记录（异常类型、字节数、哈希等可复算）。
- **零域名泄漏**：正文站点一律匿名化为「某 XX 站」；真实端点仅在本地证据脚本（不入库）中出现。
- **反爬遇即停**：命中 403/444/challenge 即记录停止，不换 UA 硬推、不上代理、不破验证码。

## 复现

```bash
# 用托管 venv（已装 pyyaml / requests）
VENV=C:/Users/ZhuanZ1/.workbuddy/binaries/python/envs/default
"$VENV/Scripts/python.exe" api/ingest.py ingest docs/submissions/2026-09-23-phaseB/<recipe>.json
"$VENV/Scripts/python.exe" api/ingest.py rebuild
```
