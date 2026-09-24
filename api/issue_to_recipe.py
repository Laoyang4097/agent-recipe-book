"""把投稿 issue（人话 Markdown）解析成可入库的配方 JSON。

用法：
    python api/issue_to_recipe.py --body issue_body.md --title "<一句话标题>" \
                                  [--id recipe-my-pitfall] [--contributor <handle>] \
                                  [--out recipes/_draft/<id>.json]

为什么需要它：
    投稿人填的是网页表单（人话），入库吃的是结构化 JSON。
    这一步由脚本代劳，维护者不必手抄——抄就会抄错，错就会污染真源。

设计取舍：
    - 只做「解析」，不做「创作」。脚本不许替投稿人补内容，
      因为本库红线是「禁止编造踩坑经历」，宁可缺字段拒绝入库，也不许生成字段。
    - 缺可选字段就留空，由 ingest.py 的 validate 去拒（必填 8 字段。
    - 脱敏不在这里做（投稿人已在表单被提示），落地前的清洗在 ingest/render 阶段。
"""

import argparse
import datetime
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INGEST_DIR = os.path.join(REPO_ROOT, "api")

if INGEST_DIR not in sys.path:
    sys.path.insert(0, INGEST_DIR)

import ingest

# issue 表单里的节标题 -> 配方字段。顺序即优先级，重复的节取最后一次。
SECTION_MAP = {
    "一句话说清解决什么": "title",
    "你卡在哪": "problem",
    "最后怎么破的": "solution",
    "标签": "tags_raw",
    "当时用的模型或工具": "model",
    "整个坑耗了多久": "duration",
    "实测出来的结论": "result",
}
# 「投稿人填了、但 render_md 不写进 frontmatter」= 内容入库后凭空消失。
# 白名单一律从 ingest.RENDER_ORDER 动态取，不在这里抄第二份——
# 抄的名单必然漂移（本库已因白名单不同步静默丢过字段）。
RENDER_ORDER = ingest.RENDER_ORDER

# SECTION_MAP 里那些「不直接落成同名 payload 字段」的节：
# 它们的值会被搬运到别处（tags_raw→tags，duration 折叠进 problem），
# 落点不在 RENDER_ORDER 时同样会在渲染时消失，所以判据要看落点、不看节名。
FIELD_TARGET = {"tags_raw": "tags", "duration": "problem"}

# 死胡同每条内部的子字段（中括号 vs 星号都认，投稿人两种都会打）
DE_END_SUBFIELDS = {
    "失败现象": "failure",
    "失败": "failure",
    "耗了多久": "duration",
    "耗时": "duration",
    "提前信号": "early_signal",
    "信号": "early_signal",
}
DE_END_SECTION = "你走过的死胡同"


def split_sections(body: str):
    """按 '## 标题' 切段，返回 [(标题, 正文)]。忽略 '---' 分隔线。"""
    out = []
    cur_title, buf = None, []
    for line in body.splitlines():
        m = re.match(r"^##\s+(.*\S)\s*$", line)
        if m:
            if cur_title is not None:
                out.append((cur_title, "\n".join(buf).strip()))
            cur_title, buf = m.group(1), []
        elif cur_title is not None:
            buf.append(line)
    if cur_title is not None:
        out.append((cur_title, "\n".join(buf).strip()))
    return out


def parse_dead_ends(chunk: str):
    """死胡同段落里按 '### 标题' 切条，每条再按 **子字段** 取值。"""
    items = []
    cur_title, buf = None, []
    for line in chunk.splitlines():
        m = re.match(r"^###\s+(.*\S)\s*$", line)
        if m:
            if cur_title is not None:
                items.append((cur_title, "\n".join(buf)))
            cur_title, buf = m.group(1), []
        elif cur_title is not None:
            buf.append(line)
    if cur_title is not None:
        items.append((cur_title, "\n".join(buf)))

    out = []
    for title, raw in items:
        if not raw.strip():
            continue
        rec = {"attempt": title.strip()}
        for cn, key in DE_END_SUBFIELDS.items():
            # 行首允许「- **失败现象**：」这种列表写法，投稿人两种都会打
            m = re.search(r"^\s*[-*]?\s*\*{0,2}" + re.escape(cn)
                          + r"\*{0,2}\s*[：:]\s*(.+)$", raw, re.M)
            if m:
                rec[key] = m.group(1).strip()
        out.append(rec)
    return out


def slugify(text: str, max_words: int = 4) -> str:
    """标题 -> 合规的 ASCII kebab-case 片段。

    本库 44 条现有配方 id 全部是 ASCII 短横线（如 recipe-py-encoding-mojibake），
    schema 也要求 kebab-case，所以中文标题不能直接拿来当 id——
    这里只摘英文词，摘不出就返回空串，由调用方去要求人工指定 id，
    绝不静默生成一个谁也搜不到的中文长 id。
    """
    s = re.sub(r"[^\w\s-]", " ", text or "")
    words = [w for w in re.split(r"[\s_]+", s) if w]
    asciis = [w for w in words if re.fullmatch(r"[a-zA-Z0-9]+", w)]
    frag = "-".join(asciis[:max_words]).lower()
    frag = re.sub(r"[^a-z0-9-]", "", frag)
    return frag[:50]


def build(args) -> dict:
    with open(args.body, "r", encoding="utf-8") as f:
        body = f.read()

    fields = {}
    de_chunk = ""
    for title, content in split_sections(body):
        if title.strip().startswith(DE_END_SECTION):
            de_chunk = content
            continue
        key = SECTION_MAP.get(title.strip())
        if key and content:
            fields[key] = content

    if args.title:
        fields["title"] = args.title

    de = parse_dead_ends(de_chunk)

    tags = [t.strip() for t in re.split(r"[,，]", fields.get("tags_raw", "")) if t.strip()]

    # 「整个坑耗了多久」在 schema v3.0 里没有顶层 duration 字段（它只属于 dead_ends[]
    # 子结构，顶层字段已锁，44 条现有配方也 0 条使用）。render_md 会忽略顶层 duration，
    # 直接丢 = 静默吞掉投稿人写的内容——本库红线就是不许静默丢。
    # 所以折叠进 problem 末尾并显式标注，内容保住，schema 一个字不改。
    dur = fields.get("duration", "").strip()
    problem = fields.get("problem", "").strip()
    if dur:
        problem = problem + f"\n\n（本坑总耗时：{dur}）" if problem else f"本坑总耗时：{dur}"
    if dur:
        print("   ℹ️ 总耗时「%s」已折叠进 problem 末尾（schema 顶层无 duration 字段）" % dur,
              file=sys.stderr)

    # 必填检查放在 id 推导之前：投稿人一次看到所有缺项，
    # 而不是改一次跑一次、一条一条碰（本库红线=禁止编造，所以缺了就拒绝）。
    missing = []
    if not fields.get("title"):
        missing.append("title（正文「一句话说清解决什么」或 --title）")
    if not tags:
        missing.append("tags（正文「标签」节）")
    if not fields.get("model"):
        missing.append("model（正文「当时用的模型或工具」）")
    if not problem:
        missing.append("problem（正文「你卡在哪」）")
    if not fields.get("solution"):
        missing.append("solution（正文「最后怎么破的」）")
    if not de:
        missing.append("dead_ends（正文「你走过的死胡同」，每条以 ### 开头）")
    if missing:
        sys.exit("❌ 投稿缺必填字段（脚本不会替你补内容——本库红线是禁止编造踩坑经历）：\n"
                 + "\n  - ".join([""] + missing))

    # id：英文标题可自动推导；纯中文标题必须人工指定，否则会生成违规的中文 id。
    auto = slugify(fields.get("title", ""))
    if args.id:
        rid = args.id
    elif auto:
        rid = auto
    else:
        sys.exit("❌ 标题里没有能当 id 用的英文词（本库现有 44 条 id 全为 ASCII "
                 "kebab-case）。请手动指定，例如：--id recipe-anti-crawl-throttle")
    if not rid.startswith("recipe-"):
        rid = "recipe-" + rid

    payload = {
        "id": rid,
        "title": fields.get("title", ""),
        "tags": tags,
        "model": fields.get("model", ""),
        "problem": problem,  # 用折叠后的版本（总耗时已并入），不能用 fields 原值
        "dead_ends": de,
        "solution": fields.get("solution", ""),
        "result": fields.get("result", ""),
        # 顶层 duration 不进 payload：schema 没有它，render_md 会忽略。
        # 值已在上一步折叠进 problem。
        "status": "quarantined",
    }
    if args.contributor:
        payload["contributor"] = args.contributor
    payload["created_at"] = datetime.date.today().isoformat()
    # 没填的可选字段不留空串，免得 frontmatter 里出现一堆 result: '' 噪音。
    for k in ("result",):
        if not payload.get(k):
            payload.pop(k, None)

    # 兜底：投稿人写了、但 RENDER_ORDER 里没有的节，内容会在入库渲染时凭空消失。
    # 必须当场喊出来，不能等入库后才发现（本库被静默丢内容坑过多次）。
    # created_at / contributor_id 由 render_md 自己生成，不属投稿人填写，跳过。
    self_generated = {"created_at", "contributor_id"}
    dropped = []
    for k, v in fields.items():
        if not v:
            continue
        target = FIELD_TARGET.get(k, k)
        if target not in RENDER_ORDER and target not in self_generated:
            dropped.append(k)
    if dropped:
        print("⚠️ 以下节的内容会被 ingest 渲染时丢掉（请把它加进 ingest.RENDER_ORDER）："
              + ", ".join(dropped), file=sys.stderr)

    # 死胡同缺子字段 = 内容残缺，直接拒绝生成。
    # 曾这里只打 warning，结果 ingest 再拒一次——投稿人改两次。
    # schema 要求 4 子字段全含，所以拒绝优于生成半成品。
    for i, d in enumerate(de):
        miss = [k for k in ("attempt", "failure", "duration", "early_signal")
                if not d.get(k)]
        if miss:
            sys.exit(f"❌ dead_ends[{i}]「{d.get('attempt','')}」缺子字段: "
                     + ", ".join(miss) + "。请补完再投，脚本不会代填。")
    return payload


def main():
    ap = argparse.ArgumentParser(description="把投稿 issue 正文解析成配方 JSON")
    ap.add_argument("--body", required=True, help="投稿正文（issue body）的 md 文件路径")
    ap.add_argument("--title", help="覆盖标题（通常从 issue 标题取）")
    ap.add_argument("--id", help="指定配方 id，缺省由标题推导")
    ap.add_argument("--contributor", help="投稿人标识；缺省匿名，由 ingest 自动哈希")
    ap.add_argument("--out", help="输出 json 路径；缺省打印到 stdout")
    args = ap.parse_args()

    payload = build(args)

    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"✅ 已生成 {args.out}")
        print(f"   id={payload['id']} 死胡同 {len(payload['dead_ends'])} 条 "
              f"tags={payload['tags']} status={payload['status']}")
        print("   下一步：python api/ingest.py " + args.out)
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
