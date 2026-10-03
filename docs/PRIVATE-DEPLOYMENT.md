# 私有化部署：用同一套框架起你自己的配方库

> 本文件回答一个问题：**我不想用别人那 61 条配方，我想只装我们自己团队的坑，怎么做？**
> 答案：不用 fork 一份代码，不用删文件——**换一个环境变量即可**。

---

## 一、为什么能这样（一句话原理）

框架（`lib/` `mcp/` `api/` `tests/`）**不持有任何领域数据**。全部数据访问收敛到**一个入口文件** `api/experiences.json`，而这个文件的位置由环境变量决定。

所以：**代码只有一份，库可以有任意多个。**

---

## 二、三步起一个私有库

### 第 1 步 · 建库目录（必须是完整结构）

```bash
mkdir -p my-book/recipes my-book/api
echo '[]' > my-book/api/experiences.json
touch my-book/llms.txt
```

⚠️ **每个库必须是完整的三件套**：`recipes/`、`llms.txt`、`api/experiences.json`。
只放 `recipes/` 是不行的——索引文件不会被生成，MCP 也读不到。

### 第 2 步 · 往里写配方

配方格式见 [`recipe.schema.md`](../recipe.schema.md)，现成模板见 [`books/lifelens/README.md`](../books/lifelens/README.md) 第五节（可直接照抄）。

写完必须重建索引：

```bash
RECIPE_BOOK_ROOT=./my-book python api/ingest.py rebuild
```

### 第 3 步 · 起服务（只读 MCP）

```bash
RECIPE_BOOK_PATH=./my-book/api/experiences.json node mcp/server.js
```

然后把这一条挂进你的 Agent 客户端（Cursor / Cline / WorkBuddy / 任何支持 MCP 的客户端）。挂载说明见 [`mcp/README.md`](../mcp/README.md)。

---

## 三、两个环境变量（**必须配套**）

| 变量 | 用在哪 | 指向 |
|---|---|---|
| `RECIPE_BOOK_ROOT` | **写侧** `api/ingest.py` | 库**根目录**（含 `recipes/` `llms.txt` `api/`） |
| `RECIPE_BOOK_PATH` | **读侧** `mcp/server.js` | 库内 **`api/experiences.json` 文件** |

> 🔴 **最常见的错误：两个变量没指向同一个库。**
> 表现是用 A 库写进去、从 B 库读不出来——**不报错，最难查**。
> 记法：`ROOT` 给目录、`PATH` 给文件，两者必须属于同一个库。

代码路径（`api/ingest.py` 本身）**不受这两个变量影响**——它始终是框架自己的那份，这是有意为之。

---

## 四、已验证（不是设计稿）

2026-10-04 实测，空库经环境变量挂载启动：

```
$ RECIPE_BOOK_PATH=./books/lifelens/api/experiences.json node mcp/server.js
[agent-recipe-book] 已加载 0 条配方（./books/lifelens/api/experiences.json）
[agent-recipe-book] 就绪：只读模式，5 个工具（search_recipes / get_recipe / list_tags / list_quarantine / verify_citations）
```

检索调用正常返回（空库时如实回答"库里没有"，不编造）：

```json
{"matched": 0, "returned": 0, "has_more": false, "hint": "库里没有直接匹配的经验，可换用更具体的词。"}
```

---

## 五、三种用法

| 形态 | 内容 | 是否需要脱敏 | 适合 |
|---|---|---|---|
| **① 个人本地库** | 自己踩过的坑 | 不必（但公开前要） | 个人开发者 + Ollama 本地模型 |
| **② 团队 / 企业私有库** | 内网专属坑：代理、自签证书、CI 怪癖、内部网关异常码 | 内网不必，**对外共享时才开** | 公司内网，数据不出网 |
| **③ 公开库** | 通用坑 | **强制**脱敏 + 隔离池 + 人复核 | 社区共享（本仓库默认库就是这一种） |

> **一个提醒**：形态 ② 里装的那些"环境专属坑"（你们代理为什么在第 3 跳丢 header、CI 那个 8 分钟超时的怪癖），
> **永远不会出现在任何模型的训练数据里**——所以这类配方不会随时间贬值。这是私有库最值得装的内容。

---

## 六、库与库之间会互相污染吗

不会。每个库有独立的 `recipes/`、独立的 `experiences.json`、独立的 `llms.txt`。
检索只在**当前挂载的那一个库**内进行——上面那次空库实测里，`matched: 0` 就是证据：主库的 61 条没有被混进来。

---

## 七、写权限（默认关闭）

写工具（`submit_recipe` 等）默认不出现在工具列表里，需显式开启：

```bash
RECIPE_BOOK_WRITE=1 RECIPE_BOOK_ROOT=./my-book node mcp/server.js
```

开启后 Agent 可直投配方 → 进**隔离池** → **人工复核**才公开。这是本项目的核心约定：*人只读，Agent 写*。
企业级解读：踩坑的 Agent 自动沉淀经验，人只点放行——**组织经验的零成本沉淀**。
