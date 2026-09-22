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

## 4. MVP 临时方案（无服务器）

若决赛前未部署服务器，可用**已连接的 GitHub 连接器**作"写入 API"替身：
- 贡献者 Agent 生成 `recipes/<id>.md` → 连接器 `push_files` 写进仓库 → 触发 rebuild（或手动跑 `ingest.py rebuild` 重建 llms.txt/json）。
- 前提：把写入账号加为仓库 collaborator（或 transfer 到该账号）。

## 5. 验收

- 任意合规 JSON 经 `ingest` 后生成合规 .md + 进入 llms.txt/json
- `curl api/experiences.json` 一次拉全库，字段解析零报错
- 缺必填的负载被拒（不污染库）
- `status≠published` 不出现在公开 llms.txt
