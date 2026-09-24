#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""投稿链路回归测试（api/issue_to_recipe.py）。

只测解析层，不需要 pyyaml——ingest 渲染那一步由手工端到端验证覆盖。

为什么值得单独立一套：这套链路连着「禁止编造踩坑经历」这条红线，
脚本任何一处「静默丢内容」都会让投稿人的真实经历凭空消失。
2026-09-25 一次改动里就掉了两个坑：
  1. warning 白名单误报必填字段（噪声盖住真问题）；
  2. duration 折叠进 problem 后，payload 仍取 fields 原值，总耗时照样丢失。
下面 T3/T7 两条就是钉死这两个回归的。

运行：python tests/issue_to_recipe.test.py
"""

import argparse
import io
import re
import os
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(REPO_ROOT, "api")

if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

import issue_to_recipe as m  # noqa: E402

PASS, FAIL = [], []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"  ✅ {name}")
    else:
        FAIL.append((name, detail))
        print(f"  ❌ {name}  {detail}")


_ERR_BUF = None


def run(body_text, **kw):
    """喂一段 issue 正文，返回 payload；脚本拒绝则抛 SystemExit。
    脚本往 stderr 打的提示会攒在 _ERR_BUF，供断言检查（同时避免刷屏）。"""
    global _ERR_BUF
    fd, path = tempfile.mkstemp(suffix=".md")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(body_text)
    args = argparse.Namespace(
        body=path, title=None, id=None, contributor=None, out=None)
    for k, v in kw.items():
        setattr(args, k, v)
    _ERR_BUF = io.StringIO()
    saved = sys.stderr
    sys.stderr = _ERR_BUF
    try:
        return m.build(args)
    finally:
        sys.stderr = saved
        os.remove(path)


def warned_fields():
    """从 ⚠️ 告警行里抽出被点名的字段名（不含 ℹ️ 提示行里的普通单词）。"""
    out = _ERR_BUF.getvalue()
    fields = set()
    for line in out.splitlines():
        if line.startswith("⚠️"):
            fields.update(re.findall(r"[a-z_]+", line.split("：")[-1]))
    return fields, out


FULL_BODY = """## 一句话说清解决什么

SQLite WAL 模式下并发写入卡住

## 你卡在哪

写入线程报 database is locked

## 你走过的死胡同

### 加大 timeout

- **失败现象**：还是 locked
- **耗时**：半小时
- **提前信号**：journal 文件没清理

### 换 journal_mode

- **失败现象**：读模式也卡
- **耗时**：10 分钟
- **提前信号**：WAL 文件一直增长

## 最后怎么破的

把写操作串行化。

## 标签

database, sqlite

## 当时用的模型或工具

Hy3

## 整个坑耗了多久

一下午

## 实测出来的结论

串行后不再 locked。
"""


def t1_ascii_id():
    p = run(FULL_BODY, title="SQLite WAL 并发写入卡住")
    check("T1 英文标题导出 ASCII id", p["id"] == "recipe-sqlite-wal", p["id"])
    check("T1 id 全为 ASCII kebab-case",
          p["id"].replace("-", "").isalnum() and not any(
              "\u4e00" <= c <= "\u9fff" for c in p["id"]), p["id"])


def t2_chinese_title_rejected():
    # 正文「一句话说清解决什么」写纯中文、且不给 --title / --id。
    cn_body = FULL_BODY.replace(
        "## 一句话说清解决什么\n\nSQLite WAL 模式下并发写入卡住\n",
        "## 一句话说清解决什么\n\n并发写入后读不到最新数据\n")
    try:
        run(cn_body)
        check("T2 纯中文标题必须人工指定 id", False, "没有拒绝，生成了不该生成的 id")
    except SystemExit as e:
        check("T2 纯中文标题必须人工指定 id", "手动指定" in str(e), str(e)[:60])


def t3_duration_folds_into_problem():
    """回归：折叠后的值必须真的进 payload，不能仍取 fields 原值。"""
    p = run(FULL_BODY, title="SQLite WAL 并发写入卡住")
    check("T3 总耗时折叠进 problem",
          "（本坑总耗时：一下午）" in p["problem"], repr(p["problem"])[:80])
    check("T3 payload 不留顶层 duration",
          "duration" not in p, "payload 里出现了 schema 不认的顶层 duration")
    check("T3 problem 原正文未被破坏",
          p["problem"].startswith("写入线程报 database is locked"), repr(p["problem"])[:40])


def t4_dead_end_list_syntax():
    p = run(FULL_BODY, title="SQLite WAL 并发写入卡住")
    de = p["dead_ends"]
    check("T4 列表写法解析出 2 条死胡同", len(de) == 2, str(len(de)))
    check("T4 首条 attempt 正确", de[0]["attempt"] == "加大 timeout", de[0].get("attempt"))
    check("T4 子字段 耗时->duration", de[0]["duration"] == "半小时", de[0].get("duration"))
    check("T4 子字段 提前信号->early_signal",
          de[0]["early_signal"] == "journal 文件没清理", de[0].get("early_signal"))


def t5_missing_subfield_rejected():
    broken = FULL_BODY.replace("- **提前信号**：journal 文件没清理\n", "")
    try:
        run(broken, title="SQLite WAL 并发写入卡住")
        check("T5 死胡同缺子字段直接拒绝", False, "未拒绝")
    except SystemExit as e:
        check("T5 死胡同缺子字段直接拒绝", "缺子字段" in str(e), str(e)[:50])


def t6_missing_required_reported_at_once():
    thin = """## 一句话说清解决什么

只有一句话

## 你走过的死胡同

### 试过

- **失败现象**：不行
- **耗时**：5分钟
- **提前信号**：无

## 最后怎么破的

不知道
"""
    try:
        run(thin, title="缺字段测试")
        check("T6 缺必填一次性报全", False, "未拒绝")
    except SystemExit as e:
        msg = str(e)
        check("T6 缺必填一次性报全",
              "tags" in msg and "model" in msg, msg[:100].replace("\n", " "))


def t7_no_warning_false_positive():
    """回归：warning 曾把 id/title/problem 等必填字段全误报一遍。"""
    p = run(FULL_BODY, title="SQLite WAL 并发写入卡住", contributor="@tester")
    warned, out = warned_fields()
    false_pos = [k for k in ("id", "title", "tags", "problem", "solution")
                 if k in warned]
    check("T7 warning 不误报已填写的必填字段", not false_pos, "误报: " + ",".join(false_pos))
    check("T7 warning 不再空喊 duration", "duration" not in warned, str(warned))
    check("T7 status 落 quarantined", p["status"] == "quarantined", p["status"])
    check("T7 投稿人转匿名哈希", p["contributor"] == "@tester", p.get("contributor"))
    check("T7 可选字段留空则不出现", "result" not in p or p["result"], str(p.get("result")))


def t8_tags_and_slugify():
    p = run(FULL_BODY, title="SQLite WAL 并发写入卡住")
    check("T8 中英文逗号都分词", p["tags"] == ["database", "sqlite"], str(p["tags"]))
    check("T8 slugify 不产中文", m.slugify("用AI破反爬降频") == "",
          repr(m.slugify("用AI破反爬降频")))
    check("T8 slugify 忽略标点", m.slugify("Foo, Bar! Baz") == "foo-bar-baz",
          m.slugify("Foo, Bar! Baz"))


def main():
    print("=== 投稿链路 issue_to_recipe 回归 ===")
    for fn in (t1_ascii_id, t2_chinese_title_rejected, t3_duration_folds_into_problem,
               t4_dead_end_list_syntax, t5_missing_subfield_rejected,
               t6_missing_required_reported_at_once, t7_no_warning_false_positive,
               t8_tags_and_slugify):
        print(f"\n--- {fn.__name__} ---")
        fn()
    total, bad = len(PASS) + len(FAIL), len(FAIL)
    print(f"\n=== 结果：{total - bad} 通过 / {bad} 失败 ===")
    if bad:
        for name, detail in FAIL:
            print(f"  ❌ {name}: {detail}")
        sys.exit(1)
    print("🎉 投稿链路全部通过")
    print(f"   通过项：{', '.join(PASS)}")


if __name__ == "__main__":
    main()
