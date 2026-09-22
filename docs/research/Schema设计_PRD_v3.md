# 「解题配方库」Schema 设计 PRD（红队质疑 + 黄金十步 v3.0）

> 评估人：栈师（主 Agent 亲执行；环境无真实专家 Agent，未虚构，遵守铁律）
> 日期：2026-09-23
> 输入：上一轮 v2.0 设计（Schema设计_黄金10步.md）
> 产出：① 对 v2.0 的 14 条红队质疑 ② 黄金十步重新设计（v3.0）③ Schema 设计 PRD

---

# 第一部分：红队质疑 v2.0（逐条攻击）

> 方法：假设 v2.0 已上线，逐条找"它在真实场景里会怎么翻车"。

| # | 质疑点 | 攻击 | 接受？ | 修正动作 |
|---|---|---|---|---|
| Q1 | `difficulty`/`time_spent` 谁填？ | 贡献者 Agent 没有"卡了多久"的真实感知（除非对话被记录），人又不能补 → 两字段大概率长期空置成装饰 | ✅ 接受 | **砍掉**。time_spent 改由系统从 git 提交时间差自动算（可选展示），不进写入契约 |
| Q2 | `status` 与 `scrubbed` 冗余 | status∈{scrubbed,published} 已隐含"已脱敏"，再加 `scrubbed:bool` 是双信号，易不一致（status=published 但 scrubbed=false 就矛盾） | ✅ 接受 | **砍 scrubbed**，只用 status 表达治理状态 |
| Q3 | frontmatter 与正文"只维护 model 一处"自相矛盾 | 我说 frontmatter 放 model 摘要、正文 ## 环境 是唯一源——但 frontmatter 既然放了，就是两份，必然可能不一致 | ✅ 接受 | **确立单一真值源=frontmatter**，正文降为"叙事补充"，机器不强制解析正文 |
| Q4 | 死胡同只在正文、靠 `### 死胡同 N` 解析脆弱 | 贡献者 Agent 写 `####`/`##`/中英文混用，脚本就解析崩 → JSON 生成假上线 | ✅ 接受 | **死胡同结构化进 frontmatter 的 YAML 数组**，正文只做人类可读展开 |
| Q5 | `soul/Agent.md` 每条必填过重 | 80% 纯代码/Prompt 问题无关 soul；且 soul 长、脱敏难保证 | ✅ 接受 | **改可选 + 默认空**，仅在"确影响复现"时填 |
| Q6 | `related` 让 Agent 自填不现实 | 提交时库里可能还没有别的配方，Agent 不知 related 谁 | ✅ 接受 | **砍写入字段**，改为查询时按 tags/problem 相似度自动聚合 |
| Q7 | 每条写 `license: MIT` 冗余 | 仓库级 LICENSE 已覆盖 | ✅ 接受 | **砍 per-recipe license** |
| Q8 | `models_extra` 过度设计 | 绝大多数单模型，额外模型极罕见 | ✅ 接受 | **砍**，model 字段允许字符串或单元素 |
| Q9 | `title` 与 `summary` 高度重叠 | 都是"一句话"，贡献者困惑填哪个 | ✅ 接受 | **合并**：title 放宽到 ≤80 字兼作检索句，删 summary |
| Q10 | 缺"结果验证"字段 | "最终解法"可能是作者一厢情愿，没说是否真跑通 | ✅ 接受 | **加 `result`**（实测结论）+ `verified:bool` |
| Q11 | 硬件强制必填不合理 | 纯 Prompt 工程问题（如"怎么写 system prompt"）无关硬件 | ✅ 接受 | **hardware 改可选**，仅环境相关时填 |
| Q12 | 匿名无法表彰（F-06） | 纯 "anonymous" 字符串，多个匿名无法区分、无法计贡献 | ✅ 接受 | **改 `contributor_id`**：系统生成稳定匿名哈希（如 anon-7f3a9c） |
| Q13 | Agent 直接写 YAML 易错 | AI 拼 YAML 缩进/特殊字符转义常翻车 | ⚠️ 部分 | 接受 YAML 但**提供严格模板 + 写入 API 预校验**，且 dead_ends 用紧凑列表降低出错面 |
| Q14 | "人只读 Agent 写"但 Schema 没规定 Agent 提交格式 | v2.0 让 Agent 写 .md，但 Agent 更擅长交 JSON，YAML 是反人类 | ✅ 接受 | **明确写入契约=JSON**（Agent 提交 JSON），系统渲染成 .md；.md 是派生展示层非写入入口 |

**质疑总结**：v2.0 的根本问题是**真值源不单一**（frontmatter/正文双轨）+ **字段膨胀**（7 个冗余/过度设计字段）。修正方向：**frontmatter 为唯一权威结构化源、正文为叙事补充、死胡同进 YAML 数组、砍 7 个冗余、补 result/verified/contributor_id、写入契约改 JSON。**

---

# 第二部分：黄金十步重新设计（v3.0）

## 步骤1：苏格拉底追问
Schema 本质=定义"配方长什么样"，成功标准=Agent 愿填、机器零成本解析、脱敏可审计、可聚类、可复现。约束=16天MVP、对齐 Agent Skills、低代码。

## 步骤2：第一性原理
- **核心事实**：单一真值源（消除双轨）、死胡同必结构化、脱敏有机器可读信号、含环境复现、对齐 Agent Skills。
- **可砍**：所有冗余/过度设计字段（见 Q1-Q9）、正文强制解析。

## 步骤3：扩散-收敛
- A 维持双轨 → ✗（Q3/Q4 已证伪）
- B frontmatter 权威 + 正文叙事（采纳 Q3/Q4 修正）→ ✓
- C 纯 JSON 驱动无 MD → 留 P2（偏离 Agent Skills 友好）

## 步骤4：诺伊曼死因
若失败：① 字段仍多→Agent 弃填 → 砍到最小必填(8个) ② YAML 出错→写入 API 预校验拦截 ③ 匿名无表彰→contributor_id 哈希。

## 步骤5：WBS+MECE（最终字段树）
```
配方（真值=frontmatter YAML）
├─ 标识：id, title, tags[], contributor_id, created_at
├─ 环境（复现）：model, skills[], harness, hardware{}(可选), agent_config(可选)
├─ 内容（灵魂）：problem, dead_ends[]{attempt,failure,duration,early_signal}, solution, result, retrospective
└─ 治理：status, verified
```
MECE 通过：无重叠、无遗漏。

## 步骤6：SMART（必填验收）
id 唯一 kebab-case｜title≤80字｜tags≥1 小写｜model 白名单｜problem 非空｜dead_ends≥1 且4子字段齐｜solution 非空｜status∈枚举｜contributor_id 哈希格式｜created_at 日期。

## 步骤7：红队（已在第一部分执行 14 条，此处不重复）
Top 风险：YAML 出错（缓解：API 预校验）、匿名表彰失效（缓解：contributor_id）、死胡同漏填（缓解：必填+示例）。

## 步骤8：奥卡姆（最小必填集）
**必填(8)**：id, title, tags, model, problem, dead_ends[], solution, status
**条件必填**：contributor_id（系统生成）、created_at（系统填）
**可选**：skills, harness, hardware, agent_config, result, retrospective, verified
**已砍(7)**：summary, difficulty, time_spent, scrubbed, related, license, models_extra

## 步骤9：里程碑
D1 落 v3.0 到 recipe.schema.md + PRD §7.1 引用｜D2 写 3 条真实配方验证好填｜D4-D7 写入 API 收 JSON + 渲染 MD/llms.txt/json。

## 步骤10：金字塔汇报
**结论**：v3.0 = frontmatter 单一权威源（含 dead_ends YAML 数组）+ 正文叙事补充；写入契约=JSON（Agent 交 JSON，系统渲染 MD）；砍 7 冗余字段，补 result/verified/contributor_id；status 单字段治理。

---

# 第三部分：Schema 设计 PRD（v3.0 正式规格）

## 1. 目的与范围
本 PRD 定义「解题配方库」中**单条解题配方（Recipe）的数据结构**，是存储层、写入 API、机器可读接口（llms.txt/JSON）的共同契约。它不规定 UI，只规定"一条配方由哪些字段组成、各自类型与必填性、机器如何零成本读取"。

## 2. 设计原则（不可动摇）
1. **单一真值源**：所有机器需要的结构化数据存在于 Markdown 文件的 **YAML frontmatter**；正文 Markdown 仅作人类/Agent 可读的**叙事补充**，机器不强制解析正文。
2. **写入契约=JSON**：贡献者 Agent 通过写入 API 提交 **JSON 负载**；系统校验后渲染为 `.md`（含 frontmatter）存入 `recipes/`，并重建 `llms.txt` 与 `experiences.json`。Agent **不直接写 .md**。
3. **对齐 Agent Skills**：frontmatter + Markdown 正文符合 Anthropic Agent Skills 开放标准，可被 30+ Agent 产品直接读取。
4. **灵魂字段必结构化**：`dead_ends`（死胡同）是产品差异化核心，必须结构化数组，禁止一句话带过。
5. **脱敏可审计**：用 `status` 单字段表达治理状态，机器可读。

## 3. 字段规范（写入契约 = JSON；渲染后 frontmatter 同构）

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | ✅ | 全局唯一 kebab-case，建议 `recipe-<短描述>` | `recipe-anti-crawl-hy3` |
| `title` | string(≤80) | ✅ | 一句话说清解决什么，兼作检索句 | `用 Hy3 破反爬：降频+随机头+住宅代理` |
| `tags` | string[] | ✅ | ≥1，全小写连字符，用于聚类 | `["crawler","anti-crawl"]` |
| `model` | string | ✅ | 主模型，白名单：Hy3 / Deepseek-V4.1-flash / 其他 | `Hy3` |
| `problem` | string | ✅ | 清晰描述卡点与约束，30秒看懂 | `用 Hy3 写爬虫被封 IP...` |
| `dead_ends` | array | ✅ | ≥1 条，每条 4 子字段（灵魂） | 见下 |
| `solution` | string | ✅ | 可复用破局步骤 | `降频1req/2s+随机头+住宅代理` |
| `status` | enum | ✅ | `draft`(待审)/`scrubbed`(已脱敏待发)/`published`(已发)/`quarantined`(隔离) | `published` |
| `contributor_id` | string | 系统生成 | 稳定匿名哈希（如 `anon-7f3a9c`），用于表彰计数 | `anon-7f3a9c` |
| `created_at` | date | 系统填 | ISO 日期 | `2026-09-23` |
| `skills` | string[] | ⚠️ | 用到的 skill | `["anti-detect"]` |
| `harness` | string | ⚠️ | 运行客户端 | `WorkBuddy` |
| `hardware` | object | ⚠️ | 仅环境相关时填 `{os,cpu,gpu,ram}` | `{os:Win10,cpu:i5,...}` |
| `agent_config` | string | ⚠️ | 脱敏后 soul/Agent.md 要点，仅影响复现时填 | `角色=采集助手；禁绕robots` |
| `result` | string | ⚠️ | 实测结论，证明解法真跑通 | `连续抓2h未封` |
| `retrospective` | string | ⚠️ | 复盘+一句忠告 | `反爬是对抗指纹...` |
| `verified` | bool | ⚠️ | 是否经第二人/复现验证 | `true` |

**`dead_ends[]` 子结构（每条必含 4 字段）：**
```json
{
  "attempt": "硬改 UA 伪装浏览器",
  "failure": "仍被 TLS 指纹识别封（JA3 不匹配）",
  "duration": "40min",
  "early_signal": "目标站有 TLS 指纹校验，单改 UA 无效"
}
```

## 4. 完整示例（JSON 写入负载 → 系统渲染为 .md）

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

系统渲染后的 `.md`（frontmatter 即上方 JSON 的 YAML 表达，正文为叙事展开）：
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
（系统可在此插入正文叙事，可选，机器不强制解析）

## 死胡同详解 / 解法步骤 / 复盘
（详见 frontmatter 结构化字段；此处供人深读）
```

## 5. 机器可读架构
```
存储层 (JSON 真值)
   │  写入 API 校验 + 渲染
   ├─► recipes/<id>.md     (frontmatter=JSON 同构，Agent Skills 可读)
   ├─► llms.txt            (抽 id/title/tags/solution 一句话索引)
   └─► experiences.json    (抽全部 frontmatter 数组，Agent 一次抓取)
消费 Agent 读 llms.txt 或 experiences.json → 零解析成本得全库
```

## 6. 写入契约与脱敏治理
- **提交格式**：Agent 经写入 API 提交 **JSON**（非 .md），降低 YAML 出错面。
- **预校验**：API 拒绝缺必填/类型错/id 撞车的负载（防 Q13）。
- **两段式脱敏**：① 贡献者 Agent 在生成 JSON 前自检清洗 ② API 落地前正则 + 审计 Agent 复检；均过才 `status: published`，否则 `quarantined`。
- **contributor_id**：系统对"匿名标识/昵称"做稳定哈希，使表彰可计数（防 Q12）。
- **status 语义**：`draft`→`scrubbed`→`published`；`quarantined` 隔离待人工。机器读 `status=published` 即代表已脱敏可展示（合并原 scrubbed，防 Q2）。

## 7. 开放边界（字段级）
| 公开（全开放） | 清洗（一律不进 JSON） |
|---|---|
| id/title/tags/model/skills/harness | 真名、学号、工号 |
| 脱敏后的 agent_config | API Key/Token/密码 |
| hardware（规格非敏感） | 内网 URL、内部系统路径 |
| problem/dead_ends/solution/result/retrospective | 含他人隐私的聊天原文 |
| contributor_id（匿名哈希）/tags | 文件系统绝对路径（C:\Users\...） |

## 8. 验收标准（Schema 可验收）
1. 任意一条配方 JSON 能通过写入 API 校验并被渲染为合规 .md + 进入 llms.txt/json。
2. `experiences.json` 可被 `curl` 一次拉全库，字段解析零报错。
3. 缺必填字段的负载被 API 拒绝（不污染库）。
4. `status≠published` 的配方不出现在公开 llms.txt。
5. 真实试填 ≥3 条，证明字段"好填、不歧义"（对照 Q9/Q11 修正生效）。

## 9. 与 v2.0 变更日志
- 真值源：双轨(frontmatter+正文) → **frontmatter 单一权威**
- 死胡同：正文 `### 死胡同 N` → **frontmatter YAML 数组**（消除脆弱解析）
- 写入契约：Agent 写 .md → **Agent 交 JSON，系统渲染 .md**
- 砍字段：summary/difficulty/time_spent/scrubbed/related/license/models_extra（7 个）
- 加字段：result / verified / contributor_id（系统生成）
- 治理：status + scrubbed 双信号 → **status 单字段**
- hardware / agent_config：必填 → **可选**

## 10. 调度真实专家
本次无真实专家 Agent 可用，全部质疑 + 黄金十步 + PRD 由主 Agent（栈师）执行，未虚构任何专家名称或能力标签（遵守核心铁律）。
