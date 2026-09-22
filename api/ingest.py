#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
agent-recipe-book · 写入 API 最小实现 + 静态生成器 (MVP)

职责：
  1) ingest <recipe.json>  : 校验一份配方 JSON -> 渲染 recipes/<id>.md -> 重建索引
  2) rebuild               : 扫描 recipes/*.md，重建 llms.txt 与 api/experiences.json

设计对齐 recipe.schema.md v3.0：
  - 单一真值源 = .md 的 YAML frontmatter
  - 写入契约 = JSON（本脚本即"Agent 提交 JSON -> 渲染 .md"的最小闭环）
  - status=published 才进入公开 llms.txt

依赖：pip install pyyaml   （仅 rebuild 解析 frontmatter 时需要）
      ingest 渲染 .md 本身不依赖 pyyaml（手写 frontmatter 字符串）。
"""

import sys
import os
import json
import hashlib
import datetime

try:
    import yaml
except ImportError:
    yaml = None

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RECIPES_DIR = os.path.join(REPO_ROOT, "recipes")
LLMS_TXT = os.path.join(REPO_ROOT, "llms.txt")
EXP_JSON = os.path.join(REPO_ROOT, "api", "experiences.json")

REQUIRED = ["id", "title", "tags", "model", "problem", "dead_ends", "solution", "status"]
STATUS_ENUM = ["draft", "scrubbed", "published", "quarantined"]

# 简单脱敏正则（示例级；生产应由审计 Agent 增强）
SENSITIVE_PATTERNS = [
    "api_key", "apikey", "token", "secret", "password",
    "C:\\\\Users", "/home/", "internal", "10.", "192.168",
]


def validate(payload: dict) -> list:
    """返回错误列表，空列表表示通过。"""
    errs = []
    for f in REQUIRED:
        if f not in payload or payload[f] in (None, "", []):
            errs.append(f"缺少必填字段: {f}")
    if payload.get("status") not in STATUS_ENUM:
        errs.append(f"status 必须为 {STATUS_ENUM}")
    de = payload.get("dead_ends")
    if isinstance(de, list):
        for i, d in enumerate(de):
            for k in ("attempt", "failure", "duration", "early_signal"):
                if not d.get(k):
                    errs.append(f"dead_ends[{i}] 缺子字段: {k}")
    return errs


def make_contributor_id(handle: str) -> str:
    h = hashlib.sha256(handle.encode("utf-8")).hexdigest()[:6]
    return f"anon-{h}"


def render_md(payload: dict) -> str:
    """把 JSON 渲染为带 frontmatter 的 Markdown。
    frontmatter 用 yaml.safe_dump 生成，保证含冒号/引号的值也能正确往返解析
    （手拼字符串会在 failure 含 'xxx: yyy' 时破坏 YAML）。"""
    if yaml is None:
        sys.exit("❌ 未安装 pyyaml，无法安全渲染 frontmatter。请先 pip install pyyaml。")
    p = dict(payload)
    # 系统填充
    if "created_at" not in p:
        p["created_at"] = datetime.date.today().isoformat()
    handle = p.get("contributor", p.get("contributor_id", "anonymous"))
    p["contributor_id"] = make_contributor_id(handle) if not p.get("contributor_id") else p["contributor_id"]
    if "contributor" in p:
        del p["contributor"]

    ordered = ["id", "title", "tags", "model", "problem", "dead_ends",
               "solution", "result", "retrospective", "skills", "harness",
               "hardware", "agent_config", "verified", "status",
               "contributor_id", "created_at"]
    fm = {k: p[k] for k in ordered if k in p}
    header = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False,
                            default_flow_style=False)
    body = (
        "\n## 背景与卡点\n\n" + (p.get("problem") or "") + "\n\n"
        "## 死胡同详解 / 解法步骤 / 复盘\n\n"
        "详见 frontmatter 结构化字段；此处供人深读。\n"
    )
    return "---\n" + header + "---\n" + body


def _roundtrip_ok(md_path: str) -> bool:
    """渲染后回读 frontmatter，确认能被 YAML 解析（防止写出坏 .md）。"""
    try:
        with open(md_path, "r", encoding="utf-8") as f:
            text = f.read()
        return parse_frontmatter(text) is not None
    except Exception:
        return False


def ingest(json_path: str):
    with open(json_path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    errs = validate(payload)
    if errs:
        print("❌ 校验失败：")
        for e in errs:
            print("  -", e)
        sys.exit(1)
    rid = payload["id"]
    md_path = os.path.join(RECIPES_DIR, f"{rid}.md")
    if os.path.exists(md_path):
        print(f"❌ id 已存在：{rid}（请换 id 或删除旧文件）")
        sys.exit(1)
    os.makedirs(RECIPES_DIR, exist_ok=True)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(render_md(payload))
    # 闸门：渲染出的 frontmatter 必须能被 YAML 回读，否则删文件并报错，避免污染仓库
    if not _roundtrip_ok(md_path):
        os.remove(md_path)
        print("❌ 渲染出的 frontmatter 无法被 YAML 解析，已回滚该文件。请检查字段取值。")
        sys.exit(1)
    print(f"✅ 已写入 {md_path}")
    rebuild()


def rebuild():
    if yaml is None:
        print("⚠️ 未安装 pyyaml，无法解析现有 .md frontmatter。"
              "请 `pip install pyyaml` 后重试 rebuild。")
        return
    recipes = []
    if os.path.isdir(RECIPES_DIR):
        for fn in sorted(os.listdir(RECIPES_DIR)):
            if not fn.endswith(".md"):
                continue
            with open(os.path.join(RECIPES_DIR, fn), "r", encoding="utf-8") as f:
                text = f.read()
            fm = parse_frontmatter(text)
            if fm:
                recipes.append(fm)
    # 重建 experiences.json
    os.makedirs(os.path.dirname(EXP_JSON), exist_ok=True)
    with open(EXP_JSON, "w", encoding="utf-8") as f:
        # default=str 兜底：YAML 可能把 created_at 等解析为 date/datetime 对象，
        # json 无法直接序列化，统一转字符串避免 rebuild 中途崩溃。
        json.dump(recipes, f, ensure_ascii=False, indent=2, default=str)
    print(f"✅ 已重建 {EXP_JSON}（{len(recipes)} 条）")
    # 重建 llms.txt（仅 published）
    pub = [r for r in recipes if r.get("status") == "published"]
    with open(LLMS_TXT, "w", encoding="utf-8") as f:
        f.write("# 暨南解题配方库 (agent-recipe-book)\n")
        f.write("> 人类解题经验的机器可读共享库。每条配方含 模型/skill/harness/硬件 与结构化死胡同。\n\n")
        f.write("## 索引\n")
        for r in pub:
            sol = (r.get("solution") or "")[:40]
            f.write(f"- recipes/{r['id']}.md: {r.get('title','')} — {sol}\n")
        f.write("\n## 如何被 Agent 读取\n")
        f.write("GET api/experiences.json 获取全量结构化数据；GET llms.txt 获取索引。\n")
        f.write("详见 CONTRIBUTING.md 与 recipe.schema.md (v3.0)。\n")
    print(f"✅ 已重建 {LLMS_TXT}（公开 {len(pub)} 条）")


def parse_frontmatter(text: str) -> dict:
    if not text.startswith("---"):
        return None
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None
    try:
        return yaml.safe_load(parts[1])
    except Exception as e:
        print(f"  ⚠️ frontmatter 解析失败: {e}")
        return None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法：python ingest.py ingest <recipe.json> | rebuild")
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "ingest" and len(sys.argv) == 3:
        ingest(sys.argv[2])
    elif cmd == "rebuild":
        rebuild()
    else:
        print("未知命令。用法：python ingest.py ingest <recipe.json> | rebuild")
        sys.exit(1)
