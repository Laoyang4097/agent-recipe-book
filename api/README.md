# 写入 API 与静态生成器（Phase 1 设计稿 · 对齐 v3.0）

> 本目录承载「解题配方库」的**写入侧**与**机器可读生成**。当前为设计稿 + 最小可运行脚本 `ingest.py`。
> 设计约束：Agent 写入 / 人只读；写入契约 = JSON；对齐 `recipe.schema.md` v3.0。

---

## 1. 架构位置

```
[贡献者 Agent] ──(POST JSON, 已脱敏)──▶ [写入 API] ──▶ [存储层 recipes/*.md]
                                                  │            │
                                                  │            ├─ 渲染 .md (frontmatter=JSON同构)
                                                  │            └─ 重建 llms.txt + experiences.json
[WorkBuddy 经验向导] ◀── 检索 llms.txt / experiences.json ◀── 学生提问
```

## 2. 写入 API 契约（v3.0）

**端点（规划）**：`POST /api/recipes`
**负载**：JSON，字段见 `recipe.schema.md` v3.0。
**系统自动填充**：`contributor_id`（对匿名标识做稳定哈希）、`created_at`（接收日期）。
**校验规则**：
- 缺必填（id/title/tags/model/problem/dead_ends/solution/status）→ 400 拒绝
- `id` 已存在 → 409 拒绝（或返回冲突建议 `<id>-2`）
- `dead_ends` 每条缺 4 子字段 → 400 拒绝
- 脱敏：正则命中敏感模式 → `status: quarantined`（不公开）

**两段式脱敏**：① 贡献者 Agent 自检（有原始上下文）② API 复检（正则 + 审计 Agent）。

## 3. 静态生成器（ingest.py）

最小可运行脚本，职责：
1. `ingest <file.json>`：校验 → 渲染 `recipes/<id>.md` → 调 rebuild
2. `rebuild`：扫描 `recipes/*.md`，解析 frontmatter → 重建 `llms.txt` 与 `api/experiences.json`

依赖：`pyyaml`（`pip install pyyaml`）。无其它外部依赖。

**experiences.json 结构**（Agent 一次抓取得全库）：
```json
[
  {
    "id":"recipe-0001",
    "title":"…","tags":[…],"model":"Hy3",
    "problem":"…","dead_ends":[…],"solution":"…","result":"…",
    "status":"published","contributor_id":"anon-…","created_at":"2026-09-23"
  }
]
```

## 4. 投稿链路（人投稿 → 入库）

MVP 期没有服务器，投稿走 GitHub Issue + 脚本转换，维护者只需点两下 Merge。

```
[投稿人] 在网页填 Issue 表单（大白话，不用碰 git）
    │
    ▼
[GitHub Issue] ──▶ api/issue_to_recipe.py  ──▶ 配方 JSON
                                                    │
                                                    ▼
                                          api/ingest.py ingest ──▶ recipes/<id>.md
                                                    │
                                                    └─▶ rebuild（experiences.json + llms.txt）
[维护者] 看一眼 PR → 点 Merge（唯一闸门）
```

**1）投稿入口**：`.github/ISSUE_TEMPLATE/投稿一条配方.yml`。
投稿人不需要懂代码，填完即完成投稿。

**2）Issue → JSON**：`api/issue_to_recipe.py`

```bash
python api/issue_to_recipe.py --body issue_body.md \
       --title "<一句话标题>" [--id recipe-xxx] [--contributor "@handel"] \
       [--out draft.json]
```

它只做解析、不做创作——**脚本绝不替投稿人补内容**（本库红线：禁止编造踩坑经历）。
缺必填就一次报全，缺死胡同子字段直接拒绝，不生成半成品。

`status` 默认 `quarantined`：过机器体检先进隔离池，人工审完才转 `published` 公开。

**3）落库**：`python api/ingest.py ingest draft.json`

### 两个已踩过的坑（改代码前先看）

- **`duration` 无处安放**：`recipe.schema.md` v3.0 的顶层没有 `duration`
  （它只属于 `dead_ends[]` 子结构），44 条现有配方也 0 条使用。
  投稿人填的「整个坑耗了多久」被折叠进 `problem` 末尾并显式标注，**不丢内容、不改 schema**。
- **白名单不能手抄第二份**：曾在这里维护一份「支持的字段」列表，结果与
  `render_md` 的渲染清单不同步，导致投稿内容被静默丢掉。
  现在唯一真值源是 `ingest.RENDER_ORDER`，本文件消费它，不抄。

## 5. 验收

- 任意合规 JSON 经 `ingest` 后生成合规 .md + 进入 llms.txt/json
- `curl api/experiences.json` 一次拉全库，字段解析零报错
- 缺必填的负载被拒（不污染库）
- `status≠published` 不出现在公开 llms.txt

## 6. 环境（本机实测，别再踩）

- **`ingest` / `rebuild` 必须用带 pyyaml 的解释器**。本仓库 Python 测试
  （`tests/issue_to_recipe.test.py`）不需要 pyyaml，任何解释器都能跑；
  但 `ingest` 渲染 frontmatter 必须装了 pyyaml 才能跑，否则报
  `未安装 pyyaml，无法安全渲染 frontmatter`。
- 测试：`npm test`（7 套，194 项）。
