# 阶段 C 提交溯源（2026-09-23）

本目录存放阶段 C「对话 / 工具链踩坑」配方的写入负载 JSON，由 `api/ingest.py` 渲染为 `recipes/*.md` 并重建索引。

- `recipe-git-pat-push.json`：fine-grained PAT 推 GitHub 的 Basic/Bearer 坑
- `recipe-yaml-frontmatter-colon.json`：手写 YAML frontmatter 冒号陷阱

> 这 2 条属于 `recipe.schema.md` §1.1 允许的「基础设施类坑例外」，**单独收录、不计入采集垂直 tags 词表**。
> 它们用来证明配方框架不仅能装「网页采集坑」，也能装「工具链坑」——框架本身是通用的。
