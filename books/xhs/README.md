# 小红书（极光AIGC）配方库 · 第三租户 · 待填充

> 本目录是 `agent-recipe-book` 框架的**第三个租户**，用于进一步证明「同一套框架能装任意领域的坑」——
> 第二租户是 Electron 桌面应用（LifeLens），本租户是 **Python 社媒自动化 / 爬虫 / AIGC 内容生成**，领域完全不同。
> 状态：**骨架已建，配方 0 条，待填充**。
> 本文件是**给执行填充的 Agent 的作业说明**。

---

## 一、你的任务

阅读 **极光AIGC · 小红书运营闭环**项目的真实开发记录，提取**真实踩过的坑**，写成配方文件放进 `recipes/`。

**目标数量：5–8 条。宁缺毋滥，但要真实。**

### 素材源（按可信度排序）

| 优先级 | 位置 | 说明 |
|---|---|---|
| 🏆 1 | `.workbuddy/memory/` 下的工作日志 | 最真实的第一手踩坑复盘 |
| 🏆 2 | `CHANGELOG.md` | 每个版本修了什么 = 踩过什么坑 |
| 3 | `docs/` 与 `research/` 下的方案与体检报告 | 设计权衡与已知困境 |
| 4 | `patches/` 目录 | 补丁的存在本身就是坑的证据 |
| 5 | `pipeline/` `core/` `tools/` 源码中的防御性代码 | try/except 包裹、重试、降级分支，往往对应真实故障 |
| 6 | git log / commit message（如可用） | |

## 二、选题方向（不必局限，但要是这个领域专属的）

参考方向：

- 小红书**爬取与反爬**：登录态失效、验证码/滑块、频率限制、页面结构变更导致选择器失效
- **账号件 / 私有件缺失自动降级**：降级分支怎么触发、降级后如何不静默出错
- **浏览器自动化**：Playwright/Chromium 驱动下载失败、无头模式下的行为差异
- **AIGC 内容生成**：GLM 等模型 API 的调用与解析、生成内容质量不稳定、提示词漂移
- **Python 工程**：依赖版本冲突、requirements 与环境隔离、Windows 下的路径/编码问题
- **发布链路**：草稿发布、定时、失败重试与幂等
- **数据闭环**：竞品数据与自有数据口径不一致、去重、增量同步

**优先级最高的一类**：*环境专属坑*——换台机器/换个账号就不会复现的那种。这类坑永远不会进模型训练集，价值最高。

## 三、格式契约（与 LifeLens 租户完全相同）

**完整 schema、字段定义、可直接照抄的模板，见第二租户的说明：**

```
C:\Users\laoyang4097\Desktop\比赛项目\2026-09-22-15-01-22\agent-recipe-book\books\lifelens\README.md
```

重点复述三条最容易被漏的：

1. `id` 前缀用 **`recipe-xhs-<短描述>`**（不要用 lifelens）
2. `dead_ends` **每条必须 4 个子字段**：`attempt` / `failure` / `duration` / `early_signal`
3. `confidence` 三选一：`A`（实测验证）/ `B`（较有把握）/ `C`（待验证）

## 四、⚠️ 本租户的特殊纪律：脱敏要求**高于**其他租户

小红书项目天然涉及账号与真实用户数据，**本目录会随主仓库公开**。以下一律不得出现：

| 禁止 | 例子 |
|---|---|
| 账号名 / 昵称 / 主页链接 | 真实小红书账号、竞品账号的具体身份 |
| 登录凭据 | cookie、token、session、验证码截图内容 |
| 真实用户数据 | 抓取到的笔记正文、评论、用户 ID、手机号 |
| 内部接口与密钥 | 私有 API 地址、API Key、飞书/其它平台的凭据 |

**写法**：用「某美妆类头部账号」「站点 A」这类代称；涉及数据量的用「约 N 条」而非原文。
路径、模块名、报错原文可以保留——那些才是复现线索。

## 五、写完之后的验收（必须真的跑）

```bash
cd C:\Users\laoyang4097\Desktop\比赛项目\2026-09-22-15-01-22\agent-recipe-book

REM 1) 重建索引
set RECIPE_BOOK_ROOT=./books/xhs
C:/Users/laoyang4097/.workbuddy/binaries/python/envs/default/Scripts/python.exe api/ingest.py rebuild

REM 2) 验证能被检索到
set RECIPE_BOOK_PATH=./books/xhs/api/experiences.json
node mcp/server.js
```

**验收标准**：第 1 步输出条数 = 你写的配方数，**且没有任何 `⚠️ frontmatter 解析失败` 警告**；第 2 步 `matched > 0`。

## 六、⚠️ 已知陷阱（上一租户踩过，你别再踩）

**YAML frontmatter 里，单引号包裹的字符串内部再出现单引号会静默吞掉整条。**

```yaml
# ❌ 错：单引号套单引号 → 解析失败，rebuild 打警告但仍报"成功"，该条被静默剔除
- attempt: '调用了 fetch('/api/chat') 然后报错'
# ✅ 对：内部有引号就统一用双引号包外层
- attempt: "调用了 fetch('/api/chat') 然后报错"
```

判据很简单：**rebuild 输出的条数必须等于你写的配方数**。少一条就是有文件被静默扔了。

> 顺带：主库里有一条配方专门记这个坑（`recipe-yaml-frontmatter-colon`）。
> 你可以先 `search_recipes` 查一下库里有没有同类坑——**这也是本项目想验证的一件事**。

## 七、不要做的事

- 不要改框架代码（`lib/` `mcp/` `api/` 下的 .js/.py）
- 不要改主库 `recipes/` 下的任何文件，也不要改 `books/lifelens/`
- 不要手改 `llms.txt` 和 `api/experiences.json`（由 rebuild 生成）
- 不要编造没发生过的坑
