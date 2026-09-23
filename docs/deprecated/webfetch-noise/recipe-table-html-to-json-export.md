---
id: recipe-table-html-to-json-export
title: HTML表格转JSON：直接抓表格页丢整表，改抓站点官方CSV/XML导出
tags:
- scrape
- selector
model: Hy3
problem: 想把某公开数据注册表（端口号/服务名）的结构化表格转成 JSON。直觉直接 WebFetch 表格所在 HTML 页，期望拿到全表；实际要么整站被环境屏蔽，要么
  HTML 页只返回说明文字、真正的数据表被整张丢弃；而合并单元格（rowspan）这类问题在 HTML 路径下还会进一步错位。
dead_ends:
- attempt: WebFetch 某百科 GDP 排名表页，要求把主表转 JSON 数组（含全部行）
  failure: '连续 3 次均返回 Error: fetch failed——该域在本执行环境被整体屏蔽（连 Main_Page 与 API 端点都打不开），根本拿不到页面'
  duration: 3 次请求
  early_signal: 每次都是 fetch failed 而非 404/内容异常，连首页都打不开 → 是域名级屏蔽，不是 URL 写错
- attempt: 换源：WebFetch 某公共协议/端口号注册表的 HTML 表格页，要求抽取表格为 JSON
  failure: 返回的是页面说明段落（Note/Reference/Available Formats），真正上千行的数据表整张被丢弃，0 行数据被捕获，无法转
    JSON
  duration: 1 次请求
  early_signal: 输出里没有任何端口/服务名数据行，只有页头说明文字 → 大表在 Markdown 转换阶段被漏掉
solution: 1) 优先找站点官方机器可读导出（CSV/XML/JSON）：多数数据注册表在页面底部提供 export 链接，直接抓导出文件而非 HTML 页。2)
  用官方 CSV/XML 导出天然规避合并单元格——每行字段已显式展开，不存在 rowspan 垮行问题。3) 字段映射：先读首行列标题，按列位置把需要的列映射成稳定
  key（如 Service Name→service_name），不依赖模型猜列。4) 空字段统一保留 key 并置空字符串或明确 null，保持 schema
  一致；端口范围（如 225-241）原样保留为字符串，不擅自拆分。5) 若站点无导出、必须解析 HTML，先定位具体 <table> 节点，按表头索引填充，并对
  rowspan 单元格向被覆盖行回填同一值。
result: 实测：某公共注册表 HTML 页 WebFetch 丢弃整表；改抓其官方 .csv 后成功解析约 850+ 行，字段映射 service_name/port_number/protocol/description，空
  service_name 行、空 protocol 行、端口范围行均正确处理。合并单元格问题在 CSV 导出路径下不复存在。
retrospective: 直觉误以为“网页上的表格=可以整表抓”。大表要么被 Markdown 转换漏掉，要么被合并单元格/跨行搞乱。最稳的路子是找官方结构化导出，把“表格解析”问题降级为“列映射”问题。
skills: []
harness: WebFetch
hardware: 云端执行环境
agent_config: 单次 WebFetch，提示要求整页表格转 JSON；后改抓 .csv
verified: true
status: published
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

想把某公开数据注册表（端口号/服务名）的结构化表格转成 JSON。直觉直接 WebFetch 表格所在 HTML 页，期望拿到全表；实际要么整站被环境屏蔽，要么 HTML 页只返回说明文字、真正的数据表被整张丢弃；而合并单元格（rowspan）这类问题在 HTML 路径下还会进一步错位。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
