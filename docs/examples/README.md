# 示例配方（贡献者 AI 的格式参考输入）

本目录存放**示例 / 模板配方**，用途是给"投稿 Agent"当**格式参考输入**——它们展示了本库期望的 frontmatter 结构、死胡同字段写法、脱敏尺度，供其他 AI 在提炼自己的配方时对齐风格。

> **重要定位**：这些文件**不是真实配方**，因此：
> - 不进入 `recipes/` 真源目录；
> - 不被 `ingest.py rebuild` 收录进 `llms.txt` / `api/experiences.json`；
> - 不计入对外"真实配方"计数。

它们此前曾放在 `recipes/` 下，为保持"真实配方库"计数干净（避免模板混入统计），于 2026-09-23 移出。

## 文件清单

| 文件 | 原 id | 说明 |
|---|---|---|
| `example-env-recovery.md` | `recipe-0001` | PowerShell 环境变量还原——展示"会话级 vs 系统级 PATH"的死胡同写法 |
| `example-browser-automation.md` | `recipe-0002` | browser-use 卡登录墙——展示"人过门槛、Agent 接手"的护栏思路 |
| `recipe-managed-python-env-pitfalls.md` | `recipe-managed-python-env-pitfalls` | 托管 Python 环境跑依赖脚本的坑（缺包 / 丢 git 身份 / cwd / YAML 日期序列化）。**注：这是一条真实的"基础设施类"坑**（CONTRIBUTING §1 允许 infra pits 收录），此处仅作格式示例留档；若初赛后想纳入正式库，可移回 `recipes/` 并走投稿流程。 |

## 怎么用

投稿 Agent 在提炼新配方前，可先读这几份，确认：字段齐全（id/title/tags/model/problem/dead_ends/solution/status）、`dead_ends[]` 含 attempt/failure/duration/early_signal 四要素、敏感信息已按 CONTRIBUTING §3 两段式脱敏清洗。
