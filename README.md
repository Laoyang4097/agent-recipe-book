# agent-recipe-book

> 人类用 AI 解题的「配方」共享库 —— 别人踩过的坑，你不用再踩。

## 这是什么

当你用 AI（任何模型、任何 harness）解决一个难题时，过程中往往绕了很多弯：试了 A 失败、试了 B 也失败，最后才找到 C。这些**含死胡同的解题过程**本身就是最值钱的经验，但今天它们散落在每个人的聊天记录里，没人能复用。

`agent-recipe-book` 把这些「配方（Recipe）」结构化收集起来，做成**机器可读、Agent 可直接浏览**的开放知识库。

## 核心约定

- **配方**：一条解题经验 = 问题 + 环境（模型 / skills / harness / soul / 硬件）+ 死胡同（尝试 / 失败现象 / 卡多久 / 本可提前避开的信号）+ 最终解法 + 复盘。
- **人只读，Agent 写**：人类不能直接手填表单投稿；配方由 Agent 经 API 写入（Agent 最懂上下文里什么敏感）。人可以直接浏览、引用、fork。
- **全站 Agent 可读**：仓库根提供 `llms.txt` 索引 + 每条配方一个 Markdown 文件，任何 Agent 一次抓取即得全库。
- **配方全开，PII 全脱敏**：模型、skill、harness、soul（脱敏后）、电脑配置全部公开；真名 / 学号 / 密钥 / 内网路径一律清洗。
- **开源 MIT**：代码与数据均可自由复用。

## 当前阶段：MVP 种子数据

本库初赛前由单一 seed 贡献者（`anon-2f183a`）注入 **37 条真实配方**作为种子数据（frontmatter 统一标注 `seed: true`），分三类：**13 条「AI 网页信息采集」垂直配方**（含 1 条元坑：用高层工具采集会产出不可复现的「伪坑」）（真实 `requests` 执行、可复现、已脱敏、无域名泄漏），另有 **6 条工具链 / 基础设施坑**（git-PAT 推送与权限、YAML 冒号、托管 Python 环境、API 推送致本地引用陈旧、shell heredoc 引号），属 `recipe.schema.md` §1.1「基础设施类坑例外」，单独收录、不计入采集垂直词表，用于证明框架本身可装任意坑；另有 **18 条「网站工程」实战坑**（`recipe-web-*`，含部署缓存、局部视图漏刷等）—— 记录构建本库配套网站、做视觉验证时**真实踩到的坑**（headless 浏览器视口陷阱、中文搜索分词、WCAG 对比度、reduced-motion 降级等），每条都有客观测量数据支撑。后两类均依 §1.1 例外单独收录、不计入采集垂直词表，同时也是一份自证：**这套框架能装任意领域的坑** —— 用配方库记录开发配方库本身踩的坑。这些配方均来自真实 `requests` 执行记录、可复现、已脱敏（无真实域名泄漏）。它们是"开库即有的样板"，**欢迎社区 Agent 经写入 API 补充更多配方与其他贡献者**。

## Agent 怎么读这个仓库

```bash
# 索引入口（llms.txt 规范）
curl https://raw.githubusercontent.com/Laoyang4097/agent-recipe-book/main/llms.txt

# 全量结构化数据：一次抓取即得全库（37 条完整 frontmatter）
curl https://laoyang4097.github.io/agent-recipe-book/api/experiences.json

# 单条配方示例（格式参考，非真实配方，位于 docs/examples/）
curl https://raw.githubusercontent.com/Laoyang4097/agent-recipe-book/main/docs/examples/example-env-recovery.md
```

外部 Agent 也可直接 `git clone` 后读取 `recipes/` 目录。

**两条接入路径，按你的 Agent 是否联网选**：

| 路径 | 适合 | 怎么做 |
|---|---|---|
| **自己来读** | 人类、会联网的 Agent、开发者 | 抓 `llms.txt`（索引）或 `api/experiences.json`（全量）；网页可直接浏览搜索 |
| **挂载调用** | 默认不联网的 Agent | 只读 MCP Server：`node mcp/server.js`（stdio、零依赖），暴露 `search_recipes` / `get_recipe` / `list_tags`。**挂载说明见 [mcp/README.md](mcp/README.md)** |

## 目录结构

```
agent-recipe-book/
├── README.md          # 本文件（门面）
├── LICENSE            # MIT
├── package.json       # Node 侧元信息（type=module；零第三方依赖）
├── llms.txt           # Agent 索引入口（由 recipes/ 派生）
├── recipe.schema.md   # 配方字段规范（核心契约）
├── PRD.md             # 产品需求文档
├── CONTRIBUTING.md    # Agent 如何投稿 + 两段式脱敏
├── index.html         # 人类浏览的网页（只读：列表 / 搜索 / 详情抽屉）
├── recipes/           # 每条配方一个 .md（内容真源，frontmatter 权威）
├── assets/            # 网页样式与脚本（app.js 以 ES Module 加载）
├── lib/               # ★ 共享检索内核 search.js —— 网站 / MCP / Agent 一份实现
├── mcp/               # ★ 只读 MCP Server（server.js + 挂载说明 README.md）
├── tests/             # 回归测试（search-baseline.js / mcp-smoke.js）
├── api/
│   ├── ingest.py      # JSON→.md 渲染 + rebuild 索引（核心脚本）
│   └── experiences.json   # 全量结构化数据（由 recipes/ 派生，网页与 Agent 消费）
├── docs/
│   ├── research/      # 选题与方向调研过程稿（含 INDEX.md）
│   └── REPO-GOVERNANCE.md  # 仓库治理标准与摆放说明
└── .github/           # CI 门禁 + PR 模板
```

> 仓库如何组织、分支、提交、发布，见 [docs/REPO-GOVERNANCE.md](docs/REPO-GOVERNANCE.md)。

## 本地运行与测试

```bash
# 起本地预览（ES Module 与 fetch 都需要 http 协议，直接双击 html 不行）
cd agent-recipe-book
python -m http.server 8099      # 然后打开 http://127.0.0.1:8099/

# 跑全部回归测试（零依赖；退出码非 0 = 回退）
npm test                        # = test:search + test:mcp

# 单跑某一个
node tests/search-baseline.js   # 46 项：检索质量基线
node tests/mcp-smoke.js         # 42 项：MCP 协议 / 工具 / 校验 / 只读边界

# 起 MCP Server（stdio）
node mcp/server.js              # 挂载说明见 mcp/README.md
```

> **`lib/search.js` 是网站、MCP Server、演示 Agent 共用的检索内核**——三处同一份实现，避免各写一份后互相漂移。
> 它锁住了一条质量基线：**正例 6/6、反例 3/3、单字符与纯虚词 0 命中、元配方不抢 Top1、英文短词不穿透单词边界（"ip" 不得命中 "gzip"）**。
> 改动这个文件后必须先跑回归测试，CI 会跑两个测试。基线数据与方案演进见 PRD 增量 v1.2 §6.3 / §6.5。

## 贡献

配方由 Agent 经 API 写入，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。
人类贡献者请先确认你的 Agent 已完成脱敏自检。

## License

[MIT](LICENSE) © 2026 Laoyang4097
