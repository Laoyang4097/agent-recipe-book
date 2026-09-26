#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""写侧内核回归测试（api/ingest.py 的 submit_recipe / promote_recipe）。

对应 PRD《写侧 MCP v1.0》§6.1 的 A-1..A-15 中可在 Python 层验证的部分；
需要读侧（MCP 检索/隔离清单）的部分在 tests/write-mcp.test.js。

为什么值得单独立一套：这一层连着两条红线——
  1. 「禁止编造踩坑经历」：脚本任何「静默补内容 / 静默改内容」都是犯罪；
  2. 「投稿即公开」：status/confidence 只要有一处漏判，隔离就形同虚设。
脱敏规则本轮还修了两个真 bug（见下 T1 注释）。

运行：需要带 pyyaml 的解释器（本机：.../binaries/python/envs/default/Scripts/python.exe），
  直接 python tests/ingest_write.test.py
"""

import glob
import hashlib
import io
import os
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(REPO_ROOT, "api")

if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

import ingest  # noqa: E402

PASS, FAIL = [], []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"  ✅ {name}")
    else:
        FAIL.append((name, detail))
        print(f"  ❌ {name}  {detail}")


if ingest.yaml is None:
    sys.exit("❌ 本测试需要带 pyyaml 的解释器（渲染 frontmatter 依赖它）。")

# 落盘路径全部改指临时目录，测试不碰真实 recipes/ 与 api/experiences.json
TMP = tempfile.mkdtemp(prefix="recipe-book-write-")
ingest.RECIPES_DIR = os.path.join(TMP, "recipes")
ingest.EXP_JSON = os.path.join(TMP, "experiences.json")
ingest.LLMS_TXT = os.path.join(TMP, "llms.txt")


def full_payload(**over):
    p = {
        "title": "SQLite WAL 模式下并发写入卡住",
        "tags": ["sqlite", "并发"],
        "model": "Claude Sonnet 4.5",
        "problem": "WAL 模式下多个连接同时写，偶发 SQLITE_BUSY。",
        "solution": "busy_timeout 调到 5000ms，并把写事务串行化。",
        "dead_ends": [{
            "attempt": "改成只读连接绕开锁",
            "failure": "读也因此 BUSY，说明锁没真放开",
            "duration": "20 分钟",
            "early_signal": "sqlite3 直接报 SQLITE_BUSY",
        }],
        "contributor": "@tester",
    }
    p.update(over)
    return p


def fields(errs):
    return [e["field"] for e in errs]


def text_of(rid):
    with open(os.path.join(ingest.RECIPES_DIR, f"{rid}.md"), encoding="utf-8") as f:
        return f.read()


def body_of(text):
    """frontmatter 之后的正文（晋升时一个字都不许动）。"""
    return "---" + text.split("---", 2)[2]


def md5(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def n_files():
    return len(glob.glob(os.path.join(ingest.RECIPES_DIR, "*.md")))


# ---------------- 1. 脱敏规则 ----------------
def t1_sensitive_rules():
    print("\n[1] 脱敏规则")
    # 全库零误伤。本轮修的两个 bug 都记在这：
    #  - 旧规则是裸关键词，5 条配方命中，其中 3 条恰恰是在讲 token 怎么用；
    #  - 10.x 是 RFC 1918/5737 文档保留段，现有配方拿 10.255.255.1 做实验，不该拦。
    bad = []
    for f in sorted(glob.glob(os.path.join(REPO_ROOT, "recipes", "*.md"))):
        fm = ingest.parse_frontmatter(io.open(f, encoding="utf-8").read())
        if ingest.scan_sensitive(fm or {}):
            bad.append(os.path.basename(f))
    check("T1a 现有 44 条配方零误伤", not bad, ",".join(bad))

    # 负例：真凭据一条都不能漏
    neg = {
        "api_key 赋值": "api_key=sk-abcdefghijklmnop1234",
        "token 冒号": "token: ghp_abcdefghijklmnopqrstuvwxyz1234",
        "password 等号": "password=MyP@ssw0rd123",
        "secret 中文冒号": "secret：AKIAIOSFODNN7EXAMPLE",
        "Bearer 头": "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abcdefghij",
        "私钥头": "-----BEGIN RSA PRIVATE KEY-----",
        "家目录 win": r"日志在 C:\Users\zhangsan\project 下",
        "家目录 unix": "日志在 /home/zhangsan/project 下",
        "企业内网 IP": "连不上 192.168.1.10:8080",
        "内网域名": "访问 http://internal.local:8080/api",
    }
    missed = [k for k, v in neg.items() if not ingest.scan_sensitive({"problem": v})]
    check("T1b 10 类真凭据全部拦下", not missed, "漏过: " + ",".join(missed))

    # 正例：讲原理、正常内容不得误伤
    pos = {
        "讲 token 原理": "URL 内嵌 token 当 Basic Auth，对方网关只吃 Authorization 头",
        "文档保留段 IP": "MAP fonts.googleapis.com 10.255.255.1 模拟国内不可达",
        "报非法凭据提示": "note: Invalid username or password；Bearer 头没被当作凭据",
        "普通英文词": "we decided to internalize this helper into the shared kernel",
    }
    hurt = [k for k, v in pos.items() if ingest.scan_sensitive({"problem": v, "solution": v})]
    check("T1c 讲原理/正常内容不误伤", not hurt, "误伤: " + ",".join(hurt))


# ---------------- 2. 提交校验 ----------------
def t2_submit_validation():
    print("\n[2] 提交校验（AC-2 / AC-3）")
    before = n_files()
    try:
        ingest.submit_recipe(full_payload(title="", model=""))
        check("T2a 缺字段被拒", False, "没有拒绝")
    except ingest.WriteError as e:
        f = fields(e.errors)
        check("T2a 缺字段一次报全（AC-2.1）", "title" in f and "model" in f, str(f))

    check("T2b 拒绝后不落任何文件（AC-2.3）", n_files() == before, f"{before} -> {n_files()}")

    p = full_payload(dead_ends=[{"attempt": "重启", "failure": "还是失败",
                                 "duration": "10 分钟", "early_signal": ""}])
    try:
        ingest.submit_recipe(p)
        check("T2c 死胡同缺子字段被点名（AC-2.2）", False, "没有拒绝")
    except ingest.WriteError as e:
        check("T2c 死胡同缺子字段被点名（AC-2.2）",
              "dead_ends[0].early_signal" in fields(e.errors), str(e.errors))

    for label, over in (("空数组", {"tags": []}), ("全空白字符串", {"tags": ["", "  "]})):
        try:
            ingest.submit_recipe(full_payload(**over))
            check(f"T2d tags 为{label}时视为缺失", False, "没有拒绝")
        except ingest.WriteError as e:
            check(f"T2d tags 为{label}时视为缺失", "tags" in fields(e.errors), str(e.errors))

    try:
        ingest.submit_recipe(full_payload(id="Recipe-X"))
        check("T2e 大写 id 被拒（静默归一等于替调用方改主键）", False, "放行了大写 id")
    except ingest.WriteError as e:
        check("T2e 大写 id 被拒（静默归一等于替调用方改主键）", "id" in fields(e.errors), str(e.errors))

    try:
        ingest.submit_recipe(full_payload(status="published"))
        check("T2f status 不接受提交方指定", False, "被放行了")
    except ingest.WriteError as e:
        check("T2f status 不接受提交方指定", "status" in fields(e.errors), str(e.errors))


# ---------------- 3. id 与撞车 ----------------
def t3_id_rules():
    print("\n[3] id 规则与撞车（AC-3）")
    before = n_files()
    try:
        ingest.submit_recipe(full_payload(title="端口被占了"))
        check("T3a 纯中文标题不得自动推导 id（AC-3.3）", False, "生成了中文 id")
    except ingest.WriteError as e:
        check("T3a 纯中文标题不得自动推导 id（AC-3.3）", "id" in fields(e.errors), str(e.errors))

    r = ingest.submit_recipe(full_payload())
    rid = r["id"]
    check("T3b 英文标题自动推导合规 id", rid == "sqlite-wal", rid)
    check("T3b id 合规（小写英文短横线）", ingest.ID_RE.match(rid) is not None, rid)

    body_before = text_of(rid)
    before_dup = n_files()
    try:
        ingest.submit_recipe(full_payload())
        check("T3c 撞 id 被拒", False, "第二次放行了")
    except ingest.WriteError as e:
        check("T3c 撞 id 被拒（AC-3.1）", "id" in fields(e.errors), str(e.errors))
    check("T3d 撞 id 后原内容不变（AC-3.2）", text_of(rid) == body_before)
    check("T3e 撞 id 失败后目录未新增文件", n_files() == before_dup,
          f"{before_dup} -> {n_files()}")


# ---------------- 4. 落盘与匿名 ----------------
def t4_submit_success():
    print("\n[4] 落盘 / 隔离态 / 匿名（AC-1 / AC-4 / AC-5）")
    r = ingest.submit_recipe(full_payload(title="Postgres 连接池耗尽", id="recipe-pg-pool"))
    check("T4a 回执含 id 与下一步人工动作（AC-1.1/1.3）",
          r["id"] == "recipe-pg-pool" and "promote_recipe" in r["next_human_action"], str(r)[:120])
    check("T4b 新投稿初始为隔离态（AC-4.1）", r["status"] == "quarantined", r["status"])
    check("T4c 回执贡献者为匿名哈希（AC-5.1）", r["contributor_id"].startswith("anon-"),
          r["contributor_id"])

    fm = ingest.parse_frontmatter(text_of("recipe-pg-pool"))
    check("T4d 落盘 confidence=C（隔离双锁）", fm.get("confidence") == "C", str(fm.get("confidence")))
    check("T4e frontmatter 可被 YAML 回读且死胡同不丢",
          len(fm.get("dead_ends") or []) == 1 and (fm.get("dead_ends") or [])[0]["attempt"])

    r2 = ingest.promote_recipe  # 占位，避免 lint 误判未使用
    del r2
    r3 = ingest.submit_recipe(full_payload(title="Postgres 连接池耗尽2", id="recipe-pg-pool2",
                                           contributor="@tester"))
    check("T4f 同一贡献者两次投稿得到同一匿名标识（AC-5.2）",
          r3["contributor_id"] == r["contributor_id"], r3["contributor_id"])


# ---------------- 5. 晋升 ----------------
def t5_promote():
    print("\n[5] 晋升（AC-6）")
    ingest.submit_recipe(full_payload(title="编码抓回来是乱码", id="recipe-mojibake"))
    before = text_of("recipe-mojibake")
    try:
        ingest.promote_recipe("recipe-mojibake", "A")
        check("T5a C→A 跳级被拒（AC-6.5）", False, "放行了跳级")
    except ingest.WriteError as e:
        check("T5a C→A 跳级被拒（AC-6.5）",
              any("跳级" in x["reason"] for x in e.errors), str(e.errors))
        check("T5a 跳级文案给出具体动作，不是干巴巴一句「不行」",
              any('promote_recipe(id, "B")' in x["reason"] for x in e.errors), str(e.errors))
    check("T5b 晋升失败不改原稿一字（AC-6.6）", text_of("recipe-mojibake") == before)

    r = ingest.promote_recipe("recipe-mojibake", "B")
    fm = ingest.parse_frontmatter(text_of("recipe-mojibake"))
    check("T5c 升 B 成功并置 published（AC-6.2/6.4）",
          r["confidence"] == "B" and fm.get("status") == "published", str(r))
    check("T5d 晋升不动正文（AC-6.6）", body_of(text_of("recipe-mojibake")) == body_of(before))

    try:
        ingest.promote_recipe("recipe-mojibake", "A")
        check("T5e 升 A 需实测证据（AC-6.3）", False, "没有 result 却放行了")
    except ingest.WriteError as e:
        check("T5e 升 A 需实测证据并点名 result（AC-6.3）",
              "result" in fields(e.errors), str(e.errors))

    p = full_payload(title="编码抓回来是乱码", id="recipe-mojibake-a", result="utf-8 重编后 100% 正确")
    ingest.submit_recipe(p)
    try:
        ingest.promote_recipe("recipe-mojibake-a", "A")  # 仍处 C，先撞禁跳级
        check("T5f 有实测结论也不能从 C 直接升 A", False, "跳级被放行了")
    except ingest.WriteError as e:
        check("T5f 有实测结论也不能从 C 直接升 A", any("跳级" in x["reason"] for x in e.errors))
    ingest.promote_recipe("recipe-mojibake-a", "B")     # 按规矩先在 B 停一次
    r = ingest.promote_recipe("recipe-mojibake-a", "A")
    check("T5g 经 B 中转后可升 A", r["confidence"] == "A", str(r))

    r = ingest.promote_recipe("recipe-mojibake-a", "C")
    fm = ingest.parse_frontmatter(text_of("recipe-mojibake-a"))
    check("T5h 驳回回隔离区（confidence=C + quarantined）",
          r["confidence"] == "C" and fm.get("status") == "quarantined", str(r))

    try:
        ingest.promote_recipe("recipe-no-such-thing", "B")
        check("T5i 未知 id 被拒", False, "放行了")
    except ingest.WriteError as e:
        check("T5i 未知 id 被拒", "id" in fields(e.errors), str(e.errors))

    try:
        ingest.promote_recipe("recipe-mojibake", "X")
        check("T5j 非法分级被拒", False, "放行了 X")
    except ingest.WriteError as e:
        check("T5j 非法分级被拒", "confidence" in fields(e.errors), str(e.errors))

    # T5k/T5l：门槛文案得指路——只说「不行」的门槛，人还得自己猜下一步做什么。
    # 这两条直接打 promotion_errors()，不走 submit：dead_ends 缺子字段在 submit 阶段
    # 就被拦了，晋升时才出现的原因只有一个——人工改过隔离稿。那条分支不能因此失效，
    # 但也确实没法从 submit 路径造出来，只能单测函数本身。
    fm_bad = {"dead_ends": [{"attempt": "a", "failure": "b", "duration": "c", "early_signal": ""}]}
    hit = [x for x in ingest.promotion_errors(fm_bad, "B")
           if x["field"] == "dead_ends[0].early_signal"]
    check("T5k 缺子字段被拒，且文案说清四段各写什么",
          bool(hit) and all(k in hit[0]["reason"] for k in ("early_signal", "早该警觉", "四段")),
          str(hit))

    fm_sec = {"solution": "把 token 换成 sk-abcdefghijklmnop 就好了",
              "dead_ends": [{"attempt": "a", "failure": "b", "duration": "c", "early_signal": "d"}]}
    errs_sec = ingest.promotion_errors(fm_sec, "B")
    check("T5l 脱敏命中的文案给出替换办法",
          any("占位符" in x["reason"] for x in errs_sec), str(errs_sec))
    check("T5l 命中词本身被打码（不把真凭据回传给人）",
          all("sk-abcdefghijklmnop" not in x["reason"] for x in errs_sec),
          str([x["reason"] for x in errs_sec]))


# ---------------- 6. 索引同步与幂等 ----------------
def t6_index_sync():
    print("\n[6] 索引同步 / rebuild 幂等（B-5）")
    with open(ingest.EXP_JSON, encoding="utf-8") as f:
        synced = f.read()
    ingest.rebuild()
    with open(ingest.EXP_JSON, encoding="utf-8") as f:
        rebuilt = f.read()
    check("T6a 同步后的 experiences.json 与 rebuild 结果一致（幂等）", synced == rebuilt)

    with open(ingest.LLMS_TXT, encoding="utf-8") as f:
        llms = f.read()
    # recipe-pg-pool 始终隔离；recipe-mojibake-a 在 T5h 被驳回了；recipe-mojibake 已升 B 应出现
    check("T6b 隔离态不进对外公开索引 llms.txt（AC-4.4）",
          "recipe-pg-pool" not in llms and "recipe-mojibake-a" not in llms
          and "recipe-mojibake" in llms, llms[:200])

    ingest.promote_recipe("recipe-mojibake", "B")
    ingest.rebuild()
    with open(ingest.LLMS_TXT, encoding="utf-8") as f:
        llms2 = f.read()
    check("T6c 晋升后 rebuild 才进公开索引（A-15）", "recipe-mojibake" in llms2)


if __name__ == "__main__":
    print("=== 写侧内核回归测试 ===")
    t1_sensitive_rules()
    t2_submit_validation()
    t3_id_rules()
    t4_submit_success()
    t5_promote()
    t6_index_sync()

    print(f"\n通过 {len(PASS)} / 失败 {len(FAIL)}")
    if FAIL:
        for name, detail in FAIL:
            print(f"  ❌ {name}  {detail}")
    sys.exit(1 if FAIL else 0)
