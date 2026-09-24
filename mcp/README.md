# 把它挂给你的 Agent

> **一句话**：挂上这个只读 MCP Server，你的 Agent 在遇到网页采集 / 编码乱码 / 反爬 / 分页 / 会话 / 无头浏览器类问题时，
> 会先去查「别人真的踩过哪些坑」，而不是从头瞎试。

---

## 为什么需要「挂载」，而不是让 Agent 自己去读

仓库根已经有 `llms.txt` 与 `api/experiences.json`，**会联网的 Agent 可以自己来读**。
但绝大多数 Agent 是「宅在家里」的：它只用主人给它的工具，不会主动访问一个陌生网址。

**MCP 就是把这个库放进它的工具列表**——它一开机就看得见，一次函数调用就拿到排好序的结果。

| 路径 | 适合谁 | 需要什么 |
|---|---|---|
| 自己来读 | 人类、会联网的 Agent、开发者 | 抓 [`llms.txt`](../llms.txt) 或 [`api/experiences.json`](../api/experiences.json) |
| **挂载调用（本文）** | 默认不联网的 Agent、已支持 MCP 的客户端 | 一条 stdio 命令 |

---

## 运行方式

传输：**stdio**（不需要端口、不需要联网、不需要起服务）。
依赖：**零第三方依赖**，只需要 Node ≥ 18。

```bash
# 直接跑（自测用，会等 stdin 输入）
node mcp/server.js

# 指定别的数据文件
RECIPE_BOOK_PATH=/path/to/experiences.json node mcp/server.js
```

> ⚠️ **stdout 只承载协议报文**，一切日志走 stderr。若你把它的输出重定向到别处，请只管道 stdin/stdout、不要把 stderr 混进去。

### 客户端配置

多数支持 MCP 的客户端使用如下 JSON 结构（**具体键名与位置以你的客户端文档为准**）：

```json
{
  "mcpServers": {
    "agent-recipe-book": {
      "command": "node",
      "args": ["/绝对路径/agent-recipe-book/mcp/server.js"]
    }
  }
}
```

Windows 上把 `/绝对路径/...` 换成盘符路径（如 `D:/项目/agent-recipe-book/mcp/server.js`，正斜杠即可）。

---

## 提供了哪三个工具

| 工具 | 作用 | 何时会被调用 |
|---|---|---|
| **`list_tags`** | 返回全库标签（含出现次数）与领域分类 | 不确定用什么关键词时先看这张目录；也可用来向用户介绍覆盖范围 |
| **`search_recipes`** | 关键词检索，返回按相关性排序的 Top N，每条含**结构化死胡同** | 主力工具。用户描述卡点后先检索，再决定要不要展开 |
| **`get_recipe`** | 按 `id` 取某一条的完整内容 | `search_recipes` 已给出候选，需要看某条的完整细节时 |

### `search_recipes` 入参与出参

```jsonc
// 入参
{
  "query": "抓回来是乱码",     // 必填。自然语言即可，中文会按 2 字组合切分，不需要空格
  "tags": ["encoding"],       // 可选。AND 语义；取值见 list_tags 返回的 tags
  "limit": 5                  // 可选。默认 5，上限 20
}

// 出参（content[0].text 里的 JSON）
{
  "matched": 6,               // 命中总数（可能大于 limit）
  "terms": ["抓回来是乱码", "抓回", "回来", "是乱", "乱码"],  // 实际参与打分的词
  "synTags": ["encoding"],    // 口语词扩展出的标签，用于解释「为什么命中这些」
  "results": [
    {
      "id": "recipe-py-encoding-mojibake",
      "title": "requests 抓中文站默认 r.encoding=ISO-8859-1 致乱码…",
      "tags": ["encoding", "scrape"],
      "score": 6,
      "model": "Deepseek-V4.1-Flash",
      "problem": "…",
      "dead_ends": [
        { "attempt": "…", "failure": "…", "duration": "20min", "early_signal": "…" }
      ],
      "solution": "…",
      "result": "…",
      "retrospective": "…"
    }
  ],
  "hint": "…"        // 仅 0 命中时出现
}
```

> **`dead_ends` 才是这个库的差异化所在**：别的知识库给「答案」，这里额外给「哪些路走不通、卡了多久、回头看哪个信号能让你早省 3 小时」。

---

## 只读保证

- 工具列表里**不存在任何写操作**（`tests/mcp-smoke.js` 里有断言守着，见 AC-6）。
- 服务**不调用任何 LLM、不访问网络**：它只从本地 `api/experiences.json` 读取并排序。
  因此它**物理上不可能编造**内容——只会搬运库里已有的条目。

---

## 给使用者的建议（写进了一份 `instructions`，客户端会自动收到）

> 无命中时**如实告诉用户「库里没有」**，不要用你自己的知识补答案。
> 本库的价值在于「别人真的踩过什么坑」，编造会毁掉它。
> 引用时请带上配方 `id`，便于用户核对。

---

## 自动上岗：让 Agent 一挂载就变「经验向导」（PRD §8）

除了上面那份 `instructions`（工具层约束），本 Server 还固化了一份**角色培训手册**，通过 MCP 的 `prompts` 能力下发。
任何支持 `prompts` 的客户端，一连上 `agent-recipe-book`，调用 `prompts/get(experience-guide)` 就能把 Agent **自动培训成经验向导**——
效果与项目演示的「样板 Agent」完全一致（数据同源、规矩同款），**不用你手动把 prompt 贴给对方**。

```bash
# 客户端支持 prompts 时（推荐路径）：initialize 后自动拿到，无需手动
# 也可显式取：
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"prompts/list"}' \
 '{"jsonrpc":"2.0","id":3,"method":"prompts/get","params":{"name":"experience-guide"}}' \
 | node mcp/server.js
```

`experience-guide` 手册内含全部硬约束（C-1 只引用 / C-2 带编号 / C-3 不补充 / C-4 不猜测 / C-5 给死胡同 / C-6 附声明）与降级要求。
`prompts/get` 还接受一个可选参数 `question`（用户当前卡点），填了会作为待回答问题注入模板。

**双保险（客户端不支持 prompts 时）**：把 [`AGENT_PROMPT.md`](./AGENT_PROMPT.md) 整段复制为 Agent 的 system 指令，效果同样一致。
无论哪条路，**知识在库里、规矩同款**，所以不同用户的 Agent 接入后效果一致。

> 关键认知：MCP 里**没有**第二个 AI——它只是查询台。真正让效果一致的是「库里 44 条真实经验 + 同一份培训手册」。
> 我们不在 Server 里内置 Agent 去接待对方，而是把「怎么干活的规矩」写成说明书随 MCP 下发。

---

## 自测

```bash
node tests/mcp-smoke.js     # 42 项断言：握手 / 工具列表 / 检索正确性 / 参数校验 / 只读边界 / 数据源缺失
node tests/search-baseline.js   # 46 项断言：检索质量基线
```

### 真实会话长什么样

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_recipes","arguments":{"query":"爬虫被封 IP 了","limit":2}}}' \
 | node mcp/server.js
```

实例回放（2026-09-25 实跑，44 条库；matched 数会随库规模变化，别照抄数字）：

```
[id=1] initialize → protocolVersion=2024-11-05  serverInfo=agent-recipe-book
[id=2] search_recipes「爬虫被封 IP 了」→ matched=13  同义词扩展=anti-bot,scrape
        · recipe-py-antibot-stop-on-hit
          score=6  tags=anti-bot,scrape,headless  死胡同 2 条
          首个死胡同: requests 默认 UA 单次 GET 某 SaaS 评测站首页（allow_redirects=True、timeout=12，不做任何伪装）
                       → status=403，Server: cloudflare
        · recipe-py-ua-diff-nonbrowser
          score=6  tags=anti-bot,scrape  死胡同 3 条
```

而库里没有的问题：

```
search_recipes「为什么我的猫不吃饭」→ matched=0
        hint: 库里没有直接匹配的经验，可换用更具体的词。
```

---

## 错误约定

| 情况 | 行为 |
|---|---|
| `query` 缺失 / 非字符串 | JSON-RPC error `-32602` |
| `limit` 不在 1..20 | JSON-RPC error `-32602` |
| `tags` 不是字符串数组 | JSON-RPC error `-32602` |
| 未知工具名 | JSON-RPC error `-32602` |
| 未知方法 | JSON-RPC error `-32601` |
| `get_recipe` 的 id 不存在 | **正常返回** `{"error":"not_found"}` + hint（不抛异常，按 `error` 字段判断） |
| 无命中 | **正常返回** `results: []` + `hint`（不是错误） |
| 数据文件读不到 | 返回 `{"error":"data_source_unavailable","detail":...}` 且标记 `isError: true` —— **绝不返回空结果冒充「库里没有」** |
