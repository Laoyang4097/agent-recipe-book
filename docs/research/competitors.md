# 竞品调研：GitHub 上类似「解题配方库」的项目

> 调研日期：2026-09-23
> 调研方法：4 次并行 WebSearch（编程垂直域）+ 2 次 WebFetch 抓原始 README（agent-soul、Memmy）
> 目的：确认本项目（agent-recipe-book）的差异化空间，指导竞赛定位与钩子层设计

---

## 1. 核心结论（先讲结论）

GitHub 上**没有完全一样的项目**。但用户的设想拆成三层后，**两层已是红海，只有一层是空白且是我们的真护城河**：

| 层 | 设想 | GitHub 现状 |
|---|---|---|
| 种子层 | 爬博客方法论做内容种子 | ✅ 有人做（AgentTrek 用网页教程合成轨迹） |
| 个人层 | 上传自己的解法到账号 | 🔴 **极度拥挤**（agent-soul / Memmy / GBrain / shared-memory） |
| 共享层 | 共享给自己的其他 Agent、统一电脑解题 | 🔴 同上，Memmy 口号即「所有 AI 记住同一个你」 |
| **配方层** | **问题 → 死胡同 → 解法 + verified** | ✅ **空白，没人做** |

**竞赛定位**：别把「个人账号同步」当 headline（打不过 Anthropic / Vercel / YC），应主打——「通用记忆存不了踩坑经验，我做了**可验证、带死胡同的结构化解题配方层** + 真实 Agent Demo 跨 Agent 复用」。

---

## 2. 竞品分桶

### A 桶 · 记忆 / 知识层（≈ 个人账号 + 统一电脑，最拥挤）

| 项目 | 星标 | 做什么 | 许可证 | 与我们关系 |
|---|---|---|---|---|
| **agent-soul** | 新仓（<1k） | Git 原生私有仓 + append-only 事件流 + GitHub Actions 编译成 canonical md + Agent 启动时 `git pull` 读；三层加载（L0 身份 / L1 记忆 / L2 上下文） | MIT | **架构最像**，但存「身份/偏好/事实」非配方 |
| **Memmy** | ~1.4k | 本地记忆中枢，「所有 AI 记住同一个你」，跨 Agent 任务接力，桌面 App + CLI + SQLite，云端可选、BYOK | MIT（据报道） | 几乎 = 用户说的「统一电脑解题」 |
| **GBrain** | 6.9k | YC 总裁 Garry Tan 开源，Agent「外置永久大脑」，三层记忆 + Compiled Truth/Timeline + 混合检索（向量+关键词+RRF） | 未确认 | 知识记忆强，不存失败经验 |
| **shared-memory** | — | 共享长期记忆 MCP server，Obsidian vault + FTS5 + 向量，YAML frontmatter | 未确认 | 偏重部署 |
| **AgentRecall-MCP** | — | correction-first 持久记忆，记录每次「纠正」为 CorrectionRecord（severity + precision KPI） | MIT | **最接近我们的 dead_ends 概念** |

### B 桶 · Skills 市场（≈ 分享给 Agent）

| 项目 | 星标 | 做什么 |
|---|---|---|
| **anthropics/skills** | 51.7k | 官方 Agent Skills 仓库，SKILL.md 即插即用 |
| **skills.sh** | Vercel 托管，84k+ skills | 开放技能目录，`npx skills add` 一键装，跨 20+ Agent |

### C 桶 · 经验回放 / 轨迹学习（≈ 死胡同有价值）

| 项目 | 星标 | 做什么 |
|---|---|---|
| **agent-replay** | — | 时间旅行调试，记录轨迹，「把过去运行变成可复用经验」 |
| **AgentHER** | 学术 | 把**失败轨迹**重标成训练数据（死胡同 → 金矿） |
| **AgentTrek** | ICLR'25 | **用网页教程引导回放合成轨迹** ＝ 用户说的「爬博客方法论」原型 |
| **AxisAgentic** | 408 | 长程 Agent 轨迹持久化 / 回放 / 恢复 |

### 标准层（我们已采用）

| 项目 | 星标 | 说明 |
|---|---|---|
| **llms.txt**（AnswerDotAI） | 2.2k | Agent 可读索引标准，本项目 `llms.txt` 即此标准 |

---

## 3. 借鉴 vs 优化（逐项目）

| 项目 | ⭐ 值得借鉴（模式） | 值得优化（短板） |
|---|---|---|
| agent-soul | 三层加载协议（压上下文 ~4K token）；append-only + `supersedes` 演进；canonical 由脚本编译、不自改 | 需人一次性配 GitHub（门槛）；canonical 不能手改（学习曲线）→ 可用我们的 ingest.py 自动编译解 |
| Memmy | 「所有 AI 记住同一个你」叙事＝钩子最佳话术；跨 Agent 接力 | 太重：桌面 App + SQLite + 云端账户，对竞赛 Demo 杀鸡用牛刀 |
| GBrain | Compiled Truth + Timeline（最新结论 vs 历史证据分离） | 偏知识记忆，**不存失败经验/死胡同**——正好是它缺的缝 |
| shared-memory | MCP server 让 Agent 直接读写记忆 | 依赖 Obsidian + 向量检索，部署重；不如纯 md + llms.txt 对 Agent 友好 |
| AgentRecall-MCP | 「纠正是一等公民」——印证我们 `dead_ends[]` 的设计哲学 | 只记纠正，不记完整解题配方 |
| skills.sh / anthropics | 技能发现 + 一键安装模式（可借鉴贡献流程） | 存任务指令，不存踩坑经验 |

**共同短板一句话**：他们都太重、都存「事实/偏好」不存「踩坑经验」。我们的**轻量 Git-native + 结构化死胡同**恰好是红海里没人做的缝。

---

## 4. 本项目的护城河

- 记忆库（Memmy / GBrain）存**事实/偏好**；技能市场（skills.sh）存**任务指令**；回放工具（agent-replay）存**原始轨迹**。
- **没有一个把「这次怎么失败的、为什么失败、花了多久、早期信号是什么、最终怎么解的、验证过没」做成一等公民的结构化配方。**
- 这正是我们 v3.0 Schema 的 `dead_ends[]` + `verified` 字段在做的事——且 Git-native、机器可读、开放贡献、跨 Agent 共享，四合一。

---

## 5. 对设想的两点提醒

1. **爬博客**：AgentTrek 已证明可行，但博客方法论多是「正确的废话」。我们的 `verified` + `dead_ends` 才是过滤器——爬来的必须过这道关，否则库变垃圾场。可借鉴 LLM KB 模板做法：强制 `source_url` + `retrieved_at`，CI 不通过即拒。
2. **个人上传共享**：技术已被 agent-soul 验证（私有仓 + 编译 + 启动时读），可直接复用该模式做「个人配方空间」，**不自己造**。

---

## 6. 参考链接

- agent-soul: https://github.com/kingcharleslzy-ai/agent-soul
- Memmy: https://github.com/MemTensor/memmy-agent（报道 https://octohz.com/p/2124）
- GBrain: https://github.com/garrytan/gbrain（报道 https://aiorang.com/article/14mOhQZ.html）
- shared-memory: https://github.com/hzname/shared-memory
- AgentRecall-MCP: https://github.com/Goldentrii/awesome-mcp-servers-2
- anthropics/skills: https://github.com/anthropics/skills
- skills.sh: https://skills.sh/
- agent-replay: https://github.com/agent-experience/agent-replay
- AgentHER: https://github.com/alphadl/AgentHER（论文 https://arxiv.org/html/2603.21357v1）
- AgentTrek: https://github.com/xlang-ai/AgentTrek/
- AxisAgentic: https://github.com/XYZ-AI-Lab/AxisAgentic
- llms.txt: https://github.com/AnswerDotAI/llms-txt
