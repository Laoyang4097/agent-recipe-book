# books/ · 示例库（租户）

本目录放**配方数据**，不放代码。每一个子目录是一个独立的「库（book）」，用同一套框架跑。

```
books/
└── lifelens/     ← 第二租户：LifeLens（Electron 桌面应用）的坑 · 待填充
```

## 为什么要单独放

主仓库根目录下的 `recipes/` 是**默认公开库**（通用坑，任何人都能用）。
`books/` 下的每一个子目录则证明一件事：**这套框架能装任意领域的坑，不是一个只能装爬虫坑的爬虫库。**

这与框架的定位一致——它卖的不是这 61 条配方，而是**这套能装任何坑的框架**。

## 怎么切换库

靠两个环境变量，无需复制代码：

```bash
# 读（起 MCP 服务）
RECIPE_BOOK_PATH=./books/lifelens/api/experiences.json node mcp/server.js

# 写（重建索引）
RECIPE_BOOK_ROOT=./books/lifelens python api/ingest.py rebuild
```

完整说明见 [`docs/PRIVATE-DEPLOYMENT.md`](../docs/PRIVATE-DEPLOYMENT.md)。

## 想加自己的库

复制 `books/lifelens/` 的骨架（三件套齐全：`recipes/` + `llms.txt` + `api/experiences.json`），换成自己的内容即可。

> 企业/团队私有库建议**直接 fork 本仓库**独立部署，而不是放在 `books/` 下——
> `books/` 里的库是本仓库的一部分，**会随主仓库公开**。
