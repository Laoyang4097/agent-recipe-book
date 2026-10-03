# LifeLens 配方库（第二租户 · 待填充）

> 本目录是 `agent-recipe-book` 框架的**第二个租户实例**，用于证明「同一套框架能装任意领域的坑」。
> 状态：**骨架已建，配方 0 条，待填充**。
> 本文件是**给执行填充的 Agent 的作业说明**——照着做即可，不要自行发明格式。

---

## 一、你的任务

阅读 **LifeLens 项目**（Electron 桌面活动记录分析工具，本地 Ollama `qwen3-vl` 驱动视觉分析）的真实开发记录——源码、git log、issue、commit message、踩坑复盘——从中提取**真实踩过的坑**，按下方 schema 写成配方文件，放进 `recipes/`。

**目标数量：5–8 条。** 宁缺毋滥，但要真实。

## 二、什么是"坑"（选题标准）

必须是**这个领域专属**的坑，而不是通用编程常识。判据：

| ✅ 要 | ❌ 不要 |
|---|---|
| 只有做过 LifeLens 这类项目才会撞上的 | 任何项目都会撞的（拼写错误、忘了 import） |
| 有具体现象 + 排查过程 + 最终解法 | 只有结论没有过程 |
| 走过弯路（试过 A 失败、试过 B 也失败） | 一次就对的（那不叫坑） |

参考方向（不必局限）：Electron 打包与主进程/渲染进程通信、本地 Ollama 模型调度与显存（RTX 4060 8GB）、截图存储与磁盘占用、定时任务精度、Windows 平台特有问题、qwen3-vl 视觉分析的输出解析、SQLite/本地数据库并发等。

**优先级最高的一类**：*环境专属坑*——换个公司/换台机器就不会复现的那种。这类坑永远不会被模型训练数据吸收，价值最高。

## 三、目录结构（不要改动）

```
books/lifelens/
├── recipes/*.md          ← 你只往这里写文件
├── llms.txt              ← 自动生成，别手改
└── api/experiences.json  ← 自动生成，别手改
```

## 四、配方格式（严格遵守）

每个坑一个文件：`recipes/recipe-<短描述>.md`，内容 = YAML frontmatter + 正文（正文可选，frontmatter 是权威）。

### 必填字段

| 字段 | 说明 |
|---|---|
| `id` | 全局唯一 kebab-case，形如 `recipe-lifelens-electron-tray` |
| `title` | ≤80 字，一句话说清解决什么，兼作检索句 |
| `tags` | 数组，≥1，全小写连字符（如 `["electron","ollama","gpu"]`） |
| `model` | 主模型 / 主要技术栈（如 `qwen3-vl:latest`、`Electron 33`） |
| `problem` | 清晰描述卡点与约束，30 秒能看懂 |
| `dead_ends` | **灵魂字段**，≥1 条，每条 4 个子字段（见下） |
| `solution` | 可复用的破局步骤 |
| `status` | 填 `published`（或 `draft` 待复核） |
| `confidence` | `A`（实测验证）/ `B`（较有把握）/ `C`（待验证） |

### `dead_ends` 的四个子字段（**一条都不能少**）

```yaml
dead_ends:
- attempt: 当时具体试了什么
  failure: 失败现象（越具体越好，最好有报错原文）
  duration: 卡了多久（约 20min / 半天 / 秒级）
  early_signal: 事后看，什么信号本可以提前预警——这是全库最值钱的一列
```

### 选填字段（有就填，含金量高）

`skills` / `harness` / `hardware`（`{os,cpu,gpu,ram}`）/ `agent_config` / `result`（实测结论）/ `retrospective`（复盘 + 一句忠告）/ `verified`（bool）/ `seed`（bool）

### 系统字段（**不要手动填**，由 ingest 生成）

`contributor_id`、`created_at`

## 五、可直接照抄的模板

```markdown
---
id: recipe-lifelens-<短描述>
title: 一句话说清解决什么（≤80字）
tags:
- electron
- <标签2>
confidence: A
model: qwen3-vl:latest
problem: '当时卡在哪、有什么约束条件。写清楚到别人 30 秒能看懂。'
dead_ends:
- attempt: '第一次试了什么'
  failure: '具体失败现象，最好带报错原文'
  duration: 约 20min
  early_signal: 事后看，哪个信号本可以提前预警
- attempt: '第二次试了什么'
  failure: '又是怎么失败的'
  duration: 半天
  early_signal: 同上
solution: 最终怎么破的，写成别人能照着做的步骤。
result: 实测结论（证明真的跑通了）。
retrospective: 复盘 + 一句给后来人的忠告。
skills:
- <相关技能>
harness: Electron + Ollama
hardware:
  os: Windows 11
  gpu: RTX 4060 8GB
verified: true
status: published
---
```

## 六、写完之后必须做的两步

```bash
# 1. 重建索引（必须，否则 Agent 检索不到）
cd <仓库根>
RECIPE_BOOK_ROOT=./books/lifelens python api/ingest.py rebuild

# 2. 验证能被检索到
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_recipes","arguments":{"query":"electron"}}}\n' \
  | RECIPE_BOOK_PATH=./books/lifelens/api/experiences.json node mcp/server.js
```

**验收标准**：第 1 步输出条数 = 你写的配方数；第 2 步 `matched > 0`。

## 七、三条硬性纪律

1. **必须真实**。不准编造没发生过的坑——一条假配方会毁掉整个库的可信度，而可信度是这个项目唯一的资产。
2. **必须脱敏**。虽然是私有库，但本目录**随主仓库公开**。真名、学号、密钥、token、内网地址、真实用户数据一律清洗；项目内部路径可以保留。
3. **不准手改** `llms.txt` 和 `api/experiences.json`——它们是派生产物，一律走 `rebuild`。

## 八、常见问题

**Q：`rebuild` 报「未安装 pyyaml」怎么办？**
A：**不要去 pip install**——那是选错了解释器，装了也解决不了。本机 PATH 上的 `python` 不带 pyyaml，带 pyyaml 的在下面这个 venv 里（2026-10-04 实测可用）：

```bash
C:/Users/laoyang4097/.workbuddy/binaries/python/envs/default/Scripts/python.exe
```

即完整命令：

```bash
RECIPE_BOOK_ROOT=./books/lifelens \
  C:/Users/laoyang4097/.workbuddy/binaries/python/envs/default/Scripts/python.exe \
  api/ingest.py rebuild
```

（MCP Server 侧会自动挑解释器；若需强制指定，用 `RECIPE_BOOK_PYTHON` 环境变量。）

**Q：rebuild 报 YAML 解析错？**
A：`failure:` 之类的字段里如果含冒号，必须用单引号包裹整个值（见模板）。这是本项目踩过的真实坑（v3.2 修复）。
