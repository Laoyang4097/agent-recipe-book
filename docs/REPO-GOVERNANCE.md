# 仓库治理标准（REPO GOVERNANCE）

> 适用范围：`Laoyang4097/agent-recipe-book`
> 生效版本：v1.0 ｜ 生效日期：2026-09-23
> 本文件是仓库的「宪法」：任何人或 Agent 改仓库前先读它。内容贡献规范见 `CONTRIBUTING.md`（Agent 投稿/脱敏），本文件管**仓库本身怎么组织、怎么提交、怎么发布**。

---

## 1. 设计原则

1. **单一真值源（SSOT）**：配方内容以 `recipes/*.md` 的 frontmatter 为权威；`llms.txt` / `api/experiences.json` 是从真源派生的**发布产物**，不手工编辑。
2. **人只读、Agent 写**：人类浏览/Fork；配方经 Agent 写入 API 入库（详见 `CONTRIBUTING.md`）。
3. **可复现、可审计**：每次变更有清晰 commit、可追溯；不破坏历史。
4. **安全优先**：密钥/PAT 永不入版本库；`main` 受保护，禁止强推/改写历史。
5. **自动化兜底**：CI 在校验环节拦截坏文件，降低人为失误。

---

## 2. 仓库摆放（目录结构标准）

> 这是「货架怎么摆」的硬标准。新增顶层目录须先在本节登记，禁止随意散放文件。

```
agent-recipe-book/
├── .github/                        # 协作与自动化（勿手改）
│   ├── workflows/ci.yml            # 推/PR 到 main 时自动 rebuild 校验（质量门禁）
│   └── PULL_REQUEST_TEMPLATE.md    # PR 描述模板
├── recipes/                        # 【真源】每条配方一个 .md，frontmatter 权威
│                                   #   命名：<id>.md，id 与 frontmatter.id 一致
├── api/                            # 写入 / 渲染 / 索引脚本
│   ├── ingest.py                   # JSON→.md 渲染 + rebuild 索引（核心脚本）
│   └── experiences.json            # 生成物（当前版本化；赛后拟移出，见 §6）
├── docs/
│   ├── research/                   # 过程调研稿（必须带 INDEX.md 导航，禁止裸放）
│   └── REPO-GOVERNANCE.md          # 本文件
├── llms.txt                        # 【Agent 索引入口】生成物（当前版本化）
├── recipe.schema.md                # 配方字段规范（核心，根目录）
├── PRD.md                          # 产品需求文档（根目录，单一真值源）
├── CONTRIBUTING.md                 # Agent 投稿 + 两段式脱敏（内容贡献规范）
├── README.md                       # 仓库门面（首屏说明 + 目录结构）
├── LICENSE                         # MIT
└── .gitignore
```

**摆放松规**
- 根目录只放「门面与契约」：`README` / `LICENSE` / `llms.txt` / `recipe.schema.md` / `PRD.md` / `CONTRIBUTING.md` / `.gitignore`。
- 产品运行代码在 `api/`；内容真源在 `recipes/`；**所有非运行类文档进 `docs/`**，调研过程稿统一进 `docs/research/` 且必须有 `INDEX.md`。
- 不在根目录堆散文件、不创建无说明的临时目录。

---

## 3. 分支模型

```
main              ← 受保护，永远可演示/可发布，只收"稳定态"
  ↑ (squash merge)
feature/<name>    ← 功能/修复开发分支，从 main 切出，自测通过后合回 main
```

- **`main` 受保护**：禁止直接强推、禁止 `rebase -i` 改写已推送历史、禁止 `--force`。
- **开发走 feature 分支**：如 `feat/recipe-seed`、`feat/demo-agent`、`fix/ingest-yaml`。
- **合并方式**：`git merge --squash` 把 feature 压成**一个**干净 commit 进 main（历史线性、易回滚）。
- 单人仓库亦遵守此模型，保证流程可迁移到多人协作。
- （`gh` CLI 当前环境不可用，PR 合并走本地 squash；如后续启用 GitHub Web PR，模板见 `.github/PULL_REQUEST_TEMPLATE.md`。）

---

## 4. 提交规范（Conventional Commits）

格式：`type(scope): 中文简述`，正文可选。

| type | 含义 |
|---|---|
| `feat` | 新功能（配方/脚本/文档新增） |
| `fix` | 缺陷修复（含 ingest 脚本 bug） |
| `docs` | 文档（PRD/schema/治理/调研） |
| `chore` | 杂项（gitignore/依赖/生成物管理） |
| `refactor` | 重构不改行为 |
| `test` | 测试/校验相关 |

示例：
```
feat(recipes): 新增 3 条浏览器自动化真实配方
fix(api): rebuild 序列化崩溃 default=str
docs(governance): 建立仓库治理标准 v1.0
```

**红线**：禁止无意义的 `update` / `fix bug` 等模糊提交；一个逻辑变更一个 commit。

---

## 5. 版本与 Tag

- 采用语义化版本 `vMAJOR.MINOR.PATCH`，里程碑打**注解 tag**：
  ```bash
  git tag -a v0.1 -m "初赛前快照：架构+写入闭环+1真实配方+竞品分析"
  git push origin v0.1
  ```
- `v0.x` 竞赛阶段：`v0.1`（初赛）、`v0.2`（复赛）等；赛后 1.0 起进入正式 semver。
- Tag 只标记**可演示/可发布**的 main 状态，不标中间态。

---

## 6. 生成物与构建产物管理

- **真源**：`recipes/*.md` 的 frontmatter、`api/ingest.py`、`recipe.schema.md`。
- **派生生成物**：`llms.txt`、`api/experiences.json` —— 由 `ingest.py rebuild` 从真源生成。
- **当前策略（竞赛阶段）**：生成物**保留在版本库**，作为「Agent 可直接 GET 的发布快照」，简化演示。
- **赛后建议**：将生成物移出版本库（加 `.gitignore`），改由 CI/发布步骤生成，避免历史堆「重新生成」噪音 diff：
  ```bash
  echo "api/experiences.json" >> .gitignore
  echo "llms.txt" >> .gitignore
  git rm --cached api/experiences.json llms.txt
  ```
- 任何情况下**绝不**把模型权重、数据集、视频等二进制大文件提交进 Git（用对象存储，Git LFS 仅作最后手段）。

---

## 7. 安全红线

- **密钥/PAT/Token/密码永远不进版本库**（已在 `.gitignore` 覆盖 `.env`/`*.key`/`*.pem`/`secrets/`）。
- 推送认证用 **fine-grained PAT URL 内嵌**方式，**推完立即还原 remote**，token 不落盘到仓库配置。
- **禁止**对 `main` 执行 `push --force` / `push --force-with-lease` / `rebase -i`（已推送部分）。
- 发现误提交密钥：立即 `git filter-repo` 或 BFG 清理历史，并吊销该凭证，而非仅删文件。

---

## 8. 持续集成（CI 门禁）

`.github/workflows/ci.yml`：在 push/PR 到 `main` 时，安装 Python + pyyaml，运行 `python api/ingest.py rebuild`：
- 若 `recipes/` 存在坏 frontmatter（渲染回读失败），CI **失败**，阻断合并 —— 复用 `ingest.py` 的回读闸门。
- CI 仅校验、**不回写**仓库，避免工作流自改 main。
- 作用：保证 `main` 上的 `llms.txt` / `experiences.json` 始终可由真源重建，防止坏数据入库。

---

## 9. 文档规范

- **根目录契约文档**（`PRD.md` / `recipe.schema.md` / `CONTRIBUTING.md` / `README.md`）是产品权威，改动需谨慎并在 commit 注明。
- **过程调研稿**进 `docs/research/`，且必须维护 `docs/research/INDEX.md` 导航（防文档腐烂）。
- 所有文档中文为主，技术术语保留英文原样。

---

## 10. 推送前检查清单（每次推送必过）

> 本清单供人或 Agent 在 `git push` 前逐项核对。**任何一项不通过，先修再推。**

- [ ] `git status`：只有**预期**的改动（无 `.env`/密钥/`__pycache__` 混入）
- [ ] 改动已**逻辑分组** commit，message 符合 §4 Conventional Commits
- [ ] 本次是否在 `main` 直推？→ 若是功能/修复，**应先走 feature 分支 + squash merge**（§3）
- [ ] 是否动了 `recipes/`？→ 跑过 `python api/ingest.py rebuild` 且本地无报错（生成物已刷新）
- [ ] 是否改了 `recipe.schema.md` / `PRD.md`？→ 确认 `recipes/` 内旧配方仍符合新 schema（回读通过）
- [ ] **绝不对 `main` 用 `--force` / `rebase -i`**（§7）
- [ ] 推送用 PAT URL 内嵌，**推完立即 `git remote set-url` 还原**，token 不落盘（§7）
- [ ] 若是里程碑，是否已打/推送对应 `vX.Y` tag（§5）
- [ ] 推送后 `git status -sb` 确认本地与 `origin/main` 同步（无落后/领先）
