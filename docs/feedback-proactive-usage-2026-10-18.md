# agent-recipe-book：主动调用问题复盘与改进建议

> 文档类型：维护者反馈（来自一次真实开发会话的复盘）
> 日期：2026-10-18
> 提供方：在一次「百淳官网静态站」开发中实际使用该 MCP 的 Agent
> 目的：说清三件事——**为什么我没主动调用这个 MCP**、**我踩了哪些坑（含本库自身 bug）**、**怎么改才能让 Agent 主动用**。最后给一份按优先级排好的改进清单。

---

## 0. TL;DR（给维护者的一句话）

根因不是「Agent 懒」，而是四道关卡把主动调用堵死了：
1. **默认只读**——`submit_recipe` 被 `RECIPE_BOOK_WRITE` 开关藏起来，工具列表里根本看不到，自然不会去投稿；
2. **没有连接即提示**——PRD §8 写了「经验向导 prompt 自动上岗」，但 `server.js` 没实现，没有任何东西提醒 Agent「动手前先搜、解卡即投稿」；
3. **多租户命名误导**——`agent-recipe-book` / `lifelens-recipes` / `xhs` 三个 MCP 共用一份 `server.js`，名字让人误以为它是 LifeLens 专用库，Agent 会犹豫「这到底是不是我该写的库」；
4. **`rebuild` 静默跳过坏 `.md`（RT-G1）**——投稿反馈不可靠，写错了也不报错，库悄悄少一条。

修这四点，主动调用率会显著上升。下面是详细展开 + 代码锚点。

---

## 1. 为什么我没有主动用这个 MCP

### 1.1 心智模型错误：误把通用主库当成 LifeLens 专用
`agent-recipe-book` 这个名字，加上它和 `lifelens-recipes`、`xhs` **共用同一份 `mcp/server.js`**（仅靠 `RECIPE_BOOK_PATH` 环境变量区分租户），让我在会话里一度以为它「是 LifeLens 项目用的那个库」，从而压根没把它当作「我该查/该写」的通用知识库。
- 代码锚点：`mcp/server.js` 第 53–55 行，`DATA_PATH` 默认指向 `../api/experiences.json`（即仓库根的**通用主库**），只有 `lifelens-recipes` 才通过 `RECIPE_BOOK_PATH` 指向 `books/lifelens/`。
- 影响：命名 + 代码共用，让 Agent 对「我是谁、该往哪写」产生误判。

### 1.2 默认只读：投稿入口被藏死
`server.js` 第 61 行：
```js
const WRITE_ENABLED = process.env.RECIPE_BOOK_WRITE === "1";
```
只有显式设 `RECIPE_BOOK_WRITE=1`，`submit_recipe` / `promote_recipe` 才会出现在 `tools/list`。而默认 MCP 配置（`~/.workbuddy/mcp.json` 里 `agent-recipe-book` 那一项）**没有设这个 env**。结果：任何 Agent 连上后，工具列表里只有只读工具，**根本不存在「投稿」这个可调用项**——不是不想投，是工具都看不到。

### 1.3 语料垂直域不匹配：搜了也是 0 命中
本库覆盖的垂直域是「AI 网页信息采集」（采集 / 编码乱码 / 反爬 / 限流 / 评测方法论 / 项目判断 / `web-*` 验证类）。而本次真实卡点是**前端 CSS / 响应式 / 轮播**，并不在历史语料里。检索必然 0 命中，**搜了也得不到解法**，进一步削弱了「查库有用」的动机。
- 实证：`api/gaps.jsonl` 里 2026-10-17 的三次检索全是 0 命中：
  ```json
  {"ts":"2026-10-17T16:31:47...","query_len":32,"matched":0,"top_match_pct":0,"tags":["frontend","css"]}
  {"ts":"2026-10-17T16:31:54...","matched":0,"tags":["web-verify","headless","回归"]}
  {"ts":"2026-10-17T16:31:59...","matched":0,"tags":["frontend","css","ux"]}
  ```
  这三次恰好就是本次踩的前端坑，后来被我手动补成 5 条配方（见第 3 节）。

### 1.4 缺「经验向导 prompt」（PRD §8 没落地）
PRD 里写了「经验向导自动上岗：prompts」的设想，但 `server.js` 并没有在连接时向客户端注入任何系统提示。于是没有任何机制提醒 Agent：「涉及覆盖域动手前先 `search_recipes`；解卡后用 `submit_recipe` 投稿」。主动调用全靠 Agent 自觉或用户逐次提醒。

### 1.5 C-7 只是纸面规则
PRD 里 C-7 规定「帮用户解决完卡点后必须主动提议用 submit_recipe 投稿」，但**没有任何机制强制执行**——它既不在 prompt 里，也不在工具返回里，纯粹是文档里的一句话。

---

## 2. 我搭建 / 改造时踩的坑（含本库自身 bug）

> 说明：下面的坑分两类——**带【本库 bug】标记的是 `agent-recipe-book` 项目自身的问题，维护者应当修**；其余是我在使用侧遇到的摩擦。

### 2.1 【本库 bug · RT-G1】`rebuild` 静默跳过坏 `.md`
我把一条配方写成 `.md` 后跑 `api/ingest.py rebuild`，其中 `solution` 字段含 `{timeout: N}`，YAML 里「冒号+空格」未加引号，frontmatter 解析失败。`rebuild` 的行为是：**只打一行 stderr 警告，然后照常产出索引**，该 `.md` 被静默剔除。
- 代码锚点：`api/ingest.py` 第 614–621 行附近（红队 RT-G1 注释明确写了「坏 .md 被静默跳过，rebuild 照常产出索引 —— 库少了一条没人知道」），但当时只是「打了警告」而没让 rebuild **失败**。
- 后果：我第一次 rebuild 后库仍然是 74 条（少了我那条），没有任何失败信号，直到我手动核对才发现。
- 教训：投稿反馈不可靠，Agent 无法相信「我写进去了」。

### 2.2 投稿必须绕过 MCP（WRITE 没开）
因为 1.2 的默认只读，我想投稿时走不了 `submit_recipe`，只能：手写 `recipes/<id>.md`（YAML frontmatter）→ 手动跑 `api/ingest.py rebuild` 重建 `api/experiences.json` + `llms.txt`。这条路能用，但**完全绕开了 MCP 的写入契约**，也意味着「通过 MCP 主动投稿」这条路在默认配置下是断的。

### 2.3 【本库问题】多租户身份不透明
三个 MCP 共用 `server.js`，但 `tools/list` 的工具描述、`get_recipe` 的返回里**都没有标明「当前连的是哪个 book / 哪个租户」**。Agent 连上 `agent-recipe-book` 时，无法从工具层面确认「这是通用主库，不是 LifeLens 库」，只能去翻 `mcp.json` 才分得清。这是 1.1 误判的直接技术原因。

### 2.4 改配置需重启会话才生效
给 `agent-recipe-book` 加 `RECIPE_BOOK_WRITE=1` 后，必须**重启 / 新开会话** MCP 才重新加载工具列表（库内已有 `recipe-mcp-trust-needs-client-restart` 这条配方记录此坑）。这是开启投稿入口的额外摩擦点。

### 2.5 写侧内核依赖 `pyyaml`，只读路径不需要
`api/ingest.py rebuild` 必须 `pip install pyyaml` 才能跑（解析 frontmatter）。只读的 `server.js` 不需要任何第三方依赖。这种**环境不对称**让「投稿/重建」比「查库」重得多，进一步拉高投稿门槛。

### 2.6 【本库问题】gap 日志只存 hash，不存原文
`server.js` 第 66–90 行：`gaps.jsonl` 只记 `query_hash`（SHA256 前 12 位）+ 长度 + 分数 + tag，**绝不存查询原文**（隐私设计，合理）。但副作用是：维护者回头看 `gaps.jsonl` 时，**看不出「到底搜了什么主题」**，只能靠 tag 猜，限制了「缺口驱动创作」的可行性。（`RECIPE_GAP_LOG_RAW=1` 可记原文但默认关，且要先打码。）

### 2.7 本次真实踩的前端坑（已入库，见第 3 节）
轮播百分比位移漂移、克隆 slide 计数错位、`cover` 裁切主体、移动端 `background-position` 空操作、无头 `setInterval` 不退出——共 5 条，全部属于库原本没有的前端布局垂直域。

---

## 3. 我记下来的坑写在了哪里（文件位置）

5 条前端配方已按 `recipe.schema.md v3.0` 录入 **`agent-recipe-book` 通用主库**（默认租户，根 `api/experiences.json` + `recipes/*.md`），并通过 `api/ingest.py rebuild` 重建了索引：

| 配方文件 | 主题 |
|---|---|
| `recipes/recipe-web-carousel-percent-drift.md` | 全幅轮播百分比位移漂移 → 改像素位移 |
| `recipes/recipe-web-carousel-clone-count.md` | 克隆首张做无缝循环，复位计数要 -1 |
| `recipes/recipe-web-bg-cover-crops-hero.md` | `cover` 在异比例容器必然裁掉主体 |
| `recipes/recipe-web-bg-position-noop-mobile.md` | 移动端 cover 下 `background-position` 是空操作 |
| `recipes/recipe-web-headless-setinterval-timeout.md` | 无头 DOM 桩 `setInterval` 让进程不退出 |

- 重建结果：`api/experiences.json` 由 70 → **75 条**；`llms.txt` 公开索引 75 条。
- **重要提示**：这些是通过「手写 `.md` + `ingest.py rebuild」落的，**不是**通过 `submit_recipe` 工具——因为默认配置下 `submit_recipe` 根本没暴露（见 1.2 / 2.2）。换句话说，这 5 条恰恰证明了「默认配置下 Agent 无法走正规投稿通道」。

---

## 4. 让这个 MCP 被主动调用的改进建议（按优先级）

### P0 —— 立刻做，成本低、直接打通主动调用

**4.1 修复 RT-G1：坏 `.md` 必须让 `rebuild` 失败**
- 做法：`api/ingest.py rebuild` 遇到任意 frontmatter 解析失败，**非零退出并明确列出坏文件**，而不是「警告后继续」。同时新增 `ingest.py check` 子命令，作为提交前预检。
- 收益：投稿反馈可靠，Agent 能相信「写进去了 / 没写进去」。
- 锚点：ingest.py 第 614–621 行 RT-G1 注释处。

**4.2 默认暴露投稿入口**
- 做法：给默认 `agent-recipe-book` 的 MCP 配置加上 `"RECIPE_BOOK_WRITE":"1"`；或至少在工具描述里写明「如何开启投稿」。
- 收益：Agent 连上就能看到 `submit_recipe` / `promote_recipe`，投稿从「绕过 MCP」变「一次工具调用」。
- 代价：改完需重启会话（见 2.4）。

**4.3 多租户身份透明**
- 做法：在 `tools/list` 的工具描述里明确写「这是通用主库（default），非 LifeLens 专用」；`get_recipe` / `search_recipes` 返回里附带 `book` 字段（`default` / `lifelens` / `xhs`）。
- 收益：消灭 1.1 / 2.3 的误判，Agent 一眼知道「该不该往这写」。

### P1 —— 本周，让主动调用成为默认行为

**4.4 落地 §8 经验向导 prompt**
- 做法：MCP 连接时，经由 `prompts` 能力向客户端注入一条系统提示：「本会话已挂载 recipe-book；涉及库覆盖域（采集/编码/反爬/评测/项目判断/web-*）动手前先 `search_recipes`；解卡后用 `submit_recipe` 投稿（draft 后由人 promote 公开）」。
- 收益：主动调用不再靠自觉/用户提醒，任何会话默认遵守。
- 锚点：PRD §8；需在 `server.js` 增加 prompt 定义 + 回归测试。

**4.5 新增 `get_gaps` / `list_gaps` 工具**
- 做法：把 `gaps.jsonl` 暴露成一个只读工具，返回近期未命中检索（hash + tag + 分数 + 时间）。
- 收益：把「未命中即缺口」变成 Agent 可检索的信号——Agent 发现库里缺某主题，可主动提议「我刚踩的 X 正好补这个缺口」。
- 代价：需补 tag 推断或允许 RAW 模式记录脱敏后的检索词（见 4.8）。

**4.6 降低 `rebuild` 环境门槛**
- 做法：`ingest.py` 内置一个极简 YAML 解析兜底，或把 pyyaml 依赖改为可选（仅 `rebuild` 需要时用轻量解析）。
- 收益：投稿/重建不再强依赖 `pip install pyyaml`，环境对称。

### P2 —— 打磨，形成闭环

**4.7 提案式投稿 `propose_recipe`**
- 做法：新增「只起草 draft 不落地」的轻量入口，降低 Agent「直接写会污染库」的心理/实际门槛；人审后再 `promote`。
- 收益：鼓励更多投稿，同时保住公开闸门。

**4.8 gap 原文可选记录（维护者模式）**
- 做法：提供「维护者模式」在 `RECIPE_GAP_LOG_RAW` 基础上，记录**已打码**的检索词摘要，方便缺口驱动创作；默认仍只存 hash。
- 收益：维护者能看懂「大家都在搜什么却没找到」，定向补配方。

**4.9 把 C-7 落成机制**
- 做法：当 Agent 通过本库工具解决卡点后，MCP 在返回里附一句「检测到你刚解决 X（检索命中/解卡），可用 `submit_recipe` 投稿」——与 4.4 的 prompt 配合。
- 收益：C-7 从纸面规则变成可执行提示。

### 4.10 验收标准（落地后如何判断成功）
1. **主动检索率**：涉及覆盖域的新任务，抽样核对 100% 先 `search_recipes`。
2. **投稿零摩擦**：解卡后一条 `submit_recipe` 完成，无需手动 `rebuild`。
3. **不漏**：任何 `.md` 语法错误在提交时立刻报错，不进 `rebuild` 静默跳过（4.1）。
4. **不脏**：投稿经脱敏自检，无绝对路径 / token 入库。
5. **gap 闭环**：`gaps.jsonl` 里的高频未命中有对应「待写清单」且被补齐（4.5 / 4.8）。

---

## 5. 给维护者的一段话

这个 MCP 的设计（只读优先、写入契约、脱敏治理、gap 留痕）我很认同，方向是对的。问题出在**「让 Agent 主动用」这条链路上少了几个环**：投稿入口默认藏起、连接时没有提示、租户身份不清、`rebuild` 还带一个静默跳过的 bug。Agent 不是不想用，是「看不到入口、不知道该用、用了还不可靠」。把第 4 节的 P0 四点补上，这个库就会从「被动等知识」变成「主动被喂知识」——而这正是它存在的意义。

---

## 附：本文提到的关键路径与锚点速查

- MCP 源码：`agent-recipe-book/mcp/server.js`
  - 第 53–55 行：`DATA_PATH` 默认 = `../api/experiences.json`（通用主库）
  - 第 61 行：`WRITE_ENABLED = RECIPE_BOOK_WRITE === "1"`
  - 第 66–90 行：`gaps.jsonl` 只存 hash，不存原文
- 写侧内核：`agent-recipe-book/api/ingest.py`
  - `rebuild` 子命令（需 pyyaml）；第 614–621 行 RT-G1 静默跳过漏洞
- 默认配置：`~/.workbuddy/mcp.json` 中 `agent-recipe-book` 项（未设 `RECIPE_BOOK_WRITE`）
- 本次入库配方：`agent-recipe-book/recipes/recipe-web-*.md`（5 条）
- 已重建索引：`agent-recipe-book/api/experiences.json`（75 条）、`agent-recipe-book/llms.txt`（公开 75 条）
- 缺口证据：`agent-recipe-book/api/gaps.jsonl`（2026-10-17 三次 frontend/css 检索全 0 命中）
