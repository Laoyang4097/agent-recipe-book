---
id: recipe-py-encoding-mojibake
title: requests 抓中文站默认 r.encoding=ISO-8859-1 致乱码，用 apparent_encoding/content.decode
  修复
tags:
- encoding
- scrape
model: Agent+Python requests
problem: 用 requests 抓某政务站首页，r.text 取回的中文全是 'ä¸æ¿åºç½' 一类乱码；而 r.encoding 默认给出 ISO-8859-1，页面实际是
  UTF-8。坑点：当响应头 Content-Type 只有 'text/html'、不带 charset 时，requests 按 RFC 回退 ISO-8859-1，r.text
  就静默乱码，不报任何异常。
dead_ends:
- attempt: 拿到响应后直接读 r.text 取标题/正文
  failure: 标题读成 'ä¸æ¿åºç½_ä¸å¤®äººæ°æ¿åºé¨æ·ç½ç«'（UTF-8 字节被当 ISO-8859-1 解码的典型 mojibake），同一站正文任意中文片段均无
    CJK 命中，整个『中文』报废
  duration: 1 次抓取 60.2s（实测 r.elapsed=60.2s，该站响应慢）
  early_signal: r.encoding 打印为 ISO-8859-1，Content-Type 仅 'text/html' 无 charset；r.apparent_encoding
    却是 utf-8
- attempt: 按『中文站就是 GBK』的经验，用 r.content.decode('gbk') 硬解
  failure: '直接抛 UnicodeDecodeError: ''gbk'' codec can''t decode byte 0xad in position
    359: illegal multibyte sequence；换 gb2312 同样报 0xad@359；gb18030 改报 byte 0x9d in
    position 4556；ascii 报 0xe4@357 —— 一律解码失败'
  duration: 1 次抓取 + 4 种编码各试 1 次
  early_signal: decode 抛 UnicodeDecodeError（而不是返回乱码），说明『中文站=GBK』的假设对该站不成立
- attempt: 怕崩，用 r.content.decode('latin-1') 兜底强制解码
  failure: 确实不抛异常，但产物里 [\u4e00-\u9fff]{4,} 命中 0 条、全无中文（静默产出错误数据，比报错更危险）
  duration: 秒级
  early_signal: 无异常但正文中文为空，只有高位符号乱码
solution: 别信 r.encoding。可跑要点：① 先看响应头是否带 charset；无 charset 时 requests 会回退 ISO-8859-1。②
  首选 `r.encoding = r.apparent_encoding or 'utf-8'` 再取 r.text；或直接 `r.content.decode('utf-8')`。③
  更稳用 requests 自带依赖 charset_normalizer：`from charset_normalizer import from_bytes;
  enc = from_bytes(r.content).best().encoding`（本例实测检测为 utf_8）。④ 兜底 `r.content.decode(enc,
  errors='replace')` 防单个坏字节炸掉整页。⑤ 读 HTML 里 <meta charset> 作为辅助校验。
result: 对某政务站实测：r.text 得到乱码标题 'ä¸æ¿åºç½_ä¸å¤®äººæ°æ¿åºé¨æ·ç½ç«'；设 r.encoding=r.apparent_encoding(utf-8)
  后，标题恢复为 '中国政府网_中央人民政府门户网站'，3/3 中文片段正常；r.content.decode('utf-8') 结果一致；charset_normalizer
  判定 utf_8。
retrospective: 三条忠告：a) 永远别用默认 r.text，改 r.content.decode(已知编码) 或先修 r.encoding；b) 别用『中文站=GBK』的经验硬套，先看
  header/meta；c) 用 errors='replace' 兜底，避免一个坏字节让整批数据全灭。另注：本环境该站响应可慢至 60s，timeout 参数并不等于总耗时上限，长任务要放后台跑。
harness: Python requests
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

用 requests 抓某政务站首页，r.text 取回的中文全是 'ä¸æ¿åºç½' 一类乱码；而 r.encoding 默认给出 ISO-8859-1，页面实际是 UTF-8。坑点：当响应头 Content-Type 只有 'text/html'、不带 charset 时，requests 按 RFC 回退 ISO-8859-1，r.text 就静默乱码，不报任何异常。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
