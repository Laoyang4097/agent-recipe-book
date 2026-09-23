# 配方（Recipe）字段规范 v3.0

> 本文件是「解题配方库」**唯一权威 Schema 来源**。PRD §7 仅引用此处。
> 版本：v3.0 ｜ 对齐 Anthropic Agent Skills 开放标准（YAML frontmatter + Markdown 正文）

---

## 0. 核心设计原则（不可动摇）

1. **单一真值源 = Markdown 文件头部的 YAML frontmatter**。正文 Markdown 仅作人类/Agent 可读的叙事补充，**机器不强制解析正文**。
2. **死胡同（dead_ends）结构化进 frontmatter 的 YAML 数组**，每条 4 子字段，禁止一句话带过。
3. **写入契约 = JSON**：贡献者 Agent 经写入 API 提交 JSON，系统渲染为 `.md`（含 frontmatter）并重建 `llms.txt` / `experiences.json`。Agent **不直接写 .md**。
4. **对齐 Agent Skills**：frontmatter + 正文符合开放标准，可被 30+ Agent 产品直接读取。
5. **脱敏可审计**：用 `status` 单字段表达治理状态，机器可读。

---

## 1. 字段规范（写入契约 = JSON；渲染后 frontmatter 同构）

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | ✅ | 全局唯一 kebab-case，建议 `recipe-<短描述>` | `recipe-anti-crawl-hy3` |
| `title` | string(≤80) | ✅ | 一句话说清解决什么，兼作检索句 | `用 Hy3 破反爬：降频+随机头+住宅代理` |
| `tags` | string[] | ✅ | ≥1，全小写连字符，用于聚类 | `["crawler","anti-crawl"]` |
| `model` | string | ✅ | 主模型，白名单：Hy3 / Deepseek-V4.1-flash / 其他 | `Hy3` |
| `problem` | string | ✅ | 清晰描述卡点与约束，30 秒看懂 | `用 Hy3 写爬虫被封 IP...` |
| `dead_ends` | array | ✅ | ≥1 条，每条 4 子字段（灵魂） | 见 §2 |
| `solution` | string | ✅ | 可复用破局步骤 | `降频1req/2s+随机头+住宅代理` |
| `status` | enum | ✅ | `draft`/`scrubbed`/`published`/`quarantined` | `published` |
| `contributor_id` | string | 系统生成 | 稳定匿名哈希（如 `anon-7f3a9c`），用于表彰计数 | `anon-7f3a9c` |
| `created_at` | date | 系统填 | ISO 日期 | `2026-09-23` |
| `skills` | string[] | ⚠️ | 用到的 skill | `["anti-detect"]` |
| `harness` | string | ⚠️ | 运行客户端 | `WorkBuddy` |
| `hardware` | object | ⚠️ | 仅环境相关时填 `{os,cpu,gpu,ram}` | `{os:Win10,cpu:i5,...}` |
| `agent_config` | string | ⚠️ | 脱敏后 soul/Agent.md 要点，仅影响复现时填 | `角色=采集助手；禁绕robots` |
| `result` | string | ⚠️ | 实测结论，证明解法真跑通 | `连续抓2h未封` |
| `retrospective` | string | ⚠️ | 复盘+一句忠告 | `反爬是对抗指纹...` |
| `verified` | bool | ⚠️ | 是否经第二人/复现验证 | `true` |

**必填(8)**：`id, title, tags, model, problem, dead_ends[], solution, status`
**条件必填**：`contributor_id`（系统生成）、`created_at`（系统填）
**可选**：其余带 ⚠️ 字段
**已砍(相对 v2.0)**：`summary, difficulty, time_spent, scrubbed, related, license, models_extra`

### 1.1 MVP 期垂直 tags 词表（至 2026-10-08）

MVP 聚焦「AI 网页信息采集」单一垂直。此期间 `tags` **优先使用以下词表**，其他领域配方暂缓收录（基础设施类坑如 git/环境/yaml 例外，单独收录、不计入此词表）：

```
scrape, anti-bot, timing, encoding, session, headless,
selector, shadow-dom, pagination, rate-limit, auth-wall
```

- `scrape` 通用采集 ｜ `anti-bot` 反爬对抗 ｜ `timing` 等待/时序 ｜ `encoding` 编码/乱码
- `session` 会话/登录态 ｜ `headless` 无头浏览器 ｜ `selector` 选择器/解析
- `shadow-dom` 影子 DOM/iframe ｜ `pagination` 翻页 ｜ `rate-limit` 限流/封禁 ｜ `auth-wall` 登录墙

**第二垂直（试收，2026-09-24 起）：「用 AI 做项目判断」**

上文「单一垂直」是**收录偏好**，不是结构约束。2026-09-24 试收第二垂直，目的是验证
**字段设计是否与领域无关**（结论：是 —— 字段与代码一行未改）。词表：

```
project-judgment, verify-before-claim, planning, estimation
```

- `project-judgment` 项目/需求判断 ｜ `verify-before-claim` 引用规则前先核原文
- `planning` 排期与里程碑 ｜ `estimation` 估计与实测

> 第二垂直的 `id` 前缀固定为 `recipe-pj-*`（网站按 id 前缀做领域分类）。
> 试收期若结论为「形态不匹配」，删掉对应配方与本段即可回退，**不影响已锁的字段结构**。

> 本表只约束 MVP 期收录偏好，**不修改字段结构**（v3.0 已锁）。赛后扩垂直只需放宽此词表。
> 2026-09-24 实测印证：**扩一个垂直，字段与既有代码逻辑一行都不用改** —— 只需加词表 + 加一条 id 前缀分组（见 `lib/search.js` 的 `GROUPS`）。

---

## 2. `dead_ends[]` 子结构（每条必含 4 字段）

```json
{
  "attempt": "硬改 UA 伪装浏览器",
  "failure": "仍被 TLS 指纹识别封（JA3 不匹配）",
  "duration": "40min",
  "early_signal": "目标站有 TLS 指纹校验，单改 UA 无效"
}
```

- `attempt`：你做了什么
- `failure`：报什么错 / 行为偏离预期的具体表现
- `duration`：卡了多久（分钟/小时/天）
- `early_signal`：回头看，哪个早期迹象能让你少走弯路

复杂情况允许 3–5 条，不要省略关键细节。

---

## 3. 完整示例

### 3.1 写入负载（Agent 提交的 JSON）

```json
{
  "id": "recipe-anti-crawl-hy3",
  "title": "用 Hy3 破反爬：避开硬刚UA，降频+随机头+住宅代理",
  "tags": ["crawler", "anti-crawl", "data-collection"],
  "model": "Hy3",
  "problem": "用 Hy3 写 Python 爬虫抓某站，频繁被封 IP，改 UA 和提并发都无效。",
  "dead_ends": [
    {"attempt":"硬改 UA 伪装浏览器","failure":"仍被 TLS 指纹识别封（JA3 不匹配）","duration":"40min","early_signal":"目标站有 TLS 指纹校验，单改 UA 无效"},
    {"attempt":"并发 5→50","failure":"IP 直接拉黑 24h","duration":"10min","early_signal":"无代理池时高并发是红线"}
  ],
  "solution": "降频至 1req/2s；随机化 Accept-Language+真实 Referer；住宅代理轮询。",
  "result": "实测连续抓取 2h 未被封，成功率稳定。",
  "retrospective": "反爬本质是对抗指纹+行为非单改UA；硬件弱优先降频保活。",
  "skills": ["anti-detect", "proxy-rotate"],
  "harness": "WorkBuddy",
  "hardware": {"os":"Windows 10 22H2","cpu":"i5-10210U","gpu":"集成显卡 UHD","ram":"8GB"},
  "agent_config": "角色=数据采集助手；禁止绕过 robots；遇敏感数据即停（已脱敏）",
  "verified": true,
  "status": "published"
}
```

### 3.2 系统渲染后的 `.md`（frontmatter = 上方 JSON 的 YAML 表达）

```markdown
---
id: recipe-anti-crawl-hy3
title: 用 Hy3 破反爬：避开硬刚UA，降频+随机头+住宅代理
tags: [crawler, anti-crawl, data-collection]
model: Hy3
problem: 用 Hy3 写 Python 爬虫抓某站，频繁被封 IP，改 UA 和提并发都无效。
dead_ends:
  - attempt: 硬改 UA 伪装浏览器
    failure: 仍被 TLS 指纹识别封（JA3 不匹配）
    duration: 40min
    early_signal: 目标站有 TLS 指纹校验，单改 UA 无效
  - attempt: 并发 5→50
    failure: IP 直接拉黑 24h
    duration: 10min
    early_signal: 无代理池时高并发是红线
solution: 降频至 1req/2s；随机化 Accept-Language+真实 Referer；住宅代理轮询。
result: 实测连续抓取 2h 未被封，成功率稳定。
retrospective: 反爬本质是对抗指纹+行为非单改UA；硬件弱优先降频保活。
skills: [anti-detect, proxy-rotate]
harness: WorkBuddy
hardware: {os: Windows 10 22H2, cpu: i5-10210U, gpu: 集成显卡 UHD, ram: 8GB}
agent_config: 角色=数据采集助手；禁止绕过 robots；遇敏感数据即停（已脱敏）
verified: true
status: published
contributor_id: anon-7f3a9c
created_at: 2026-09-23
---

## 背景与卡点
（系统可插入叙事，可选，机器不强制解析）

## 死胡同详解 / 解法步骤 / 复盘
（详见 frontmatter 结构化字段；此处供人深读）
```

---

## 4. 机器可读架构

```
存储层 (JSON 真值)
   │  写入 API 校验 + 渲染
   ├─► recipes/<id>.md     (frontmatter=JSON 同构，Agent Skills 可读)
   ├─► llms.txt            (抽 id/title/tags/solution 一句话索引)
   └─► api/experiences.json (抽全部 frontmatter 数组，Agent 一次抓取)
消费 Agent 读 llms.txt 或 experiences.json → 零解析成本得全库
```

## 5. 写入契约与脱敏治理

- **提交格式**：Agent 经写入 API 提交 **JSON**（非 .md），降低 YAML 出错面。
- **预校验**：API 拒绝缺必填 / 类型错 / id 撞车的负载（防污染库）。
- **两段式脱敏**：① 贡献者 Agent 在生成 JSON 前自检清洗 ② API 落地前正则 + 审计 Agent 复检；均过才 `status: published`，否则 `quarantined`。
- **contributor_id**：系统对匿名标识/昵称做稳定哈希，使表彰可计数。
- **status 语义**：`draft`→`scrubbed`→`published`；`quarantined` 隔离待人工。`status=published` 即代表已脱敏可展示。

## 6. 开放边界（字段级）

| 公开（全开放） | 清洗（一律不进 JSON） |
|---|---|
| id/title/tags/model/skills/harness | 真名、学号、工号 |
| 脱敏后的 agent_config | API Key/Token/密码 |
| hardware（规格非敏感） | 内网 URL、内部系统路径 |
| problem/dead_ends/solution/result/retrospective | 含他人隐私的聊天原文 |
| contributor_id（匿名哈希）/tags | 文件系统绝对路径（C:\Users\...） |

## 7. 验收标准（Schema 可验收）

1. 任意一条配方 JSON 能通过写入 API 校验并被渲染为合规 .md + 进入 llms.txt/json。
2. `experiences.json` 可被 `curl` 一次拉全库，字段解析零报错。
3. 缺必填字段的负载被 API 拒绝（不污染库）。
4. `status≠published` 的配方不出现在公开 llms.txt。
5. 真实试填 ≥3 条，证明字段"好填、不歧义"。

## 8. 版本变更

- v1.0（初版）：frontmatter 索引 + 正文结构化，含 source_conversation。
- v2.0（评估版）：加 difficulty/time_spent/status/scrubbed/license/related，正文 `### 死胡同 N` 解析。
- **v3.0（本版）**：单一真值源=frontmatter；死胡同进 YAML 数组；写入契约=JSON；砍 7 冗余字段；补 result/verified/contributor_id；status 单字段治理；hardware/agent_config 改可选。
