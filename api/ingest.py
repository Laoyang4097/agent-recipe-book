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

import datetime
import hashlib
import json
import os
import re
import sys

try:
    import yaml
except ImportError:
    yaml = None

_DEFAULT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 落盘根目录可被 RECIPE_BOOK_ROOT 整体重定向（BL-016）。
# 动机：写侧测试原先直接写真实 recipes/，只靠跑完删文件兜底——一旦中途崩，
# 主库就留下孤儿文件。现在测试把「整本书」复制进临时目录再把根指过去，
# 真仓库在物理上就不可能被碰到，不依赖任何收尾清理。
# 下方三个派生路径一律由根推出，保持单一真值源（不许各自再读一遍环境变量）。
REPO_ROOT = os.environ.get("RECIPE_BOOK_ROOT") or _DEFAULT_ROOT
RECIPES_DIR = os.path.join(REPO_ROOT, "recipes")
LLMS_TXT = os.path.join(REPO_ROOT, "llms.txt")
EXP_JSON = os.path.join(REPO_ROOT, "api", "experiences.json")

REQUIRED = ["id", "title", "tags", "model", "problem", "dead_ends", "solution", "status"]
STATUS_ENUM = ["draft", "scrubbed", "published", "quarantined"]

# 只有出现在 render_md 输出里的字段，投稿内容才会落进 .md frontmatter。
# 曾因这里是手抄白名单、与渲染清单不同步，导致「投稿人填了、渲染时静默丢掉」——
# 本库反复吃这个亏。现在它是唯一真值源，其它模块一律 import 它，不许再抄一份。
# confidence 原先不在此清单里，而是靠外部脚本手工插进 .md。后果：render_md 渲染的配方
# 不带 confidence，rebuild 回来时读侧 confidenceOf 按默认返回 A —— 隔离态配方会被主检索
# 直接返回，「投稿即公开」的漏洞就是这么来的。现在它进了清单，render_md 是唯一写入口。
RENDER_ORDER = ["id", "title", "tags", "model", "problem", "dead_ends",
                "solution", "result", "retrospective", "skills", "harness",
                "hardware", "agent_config", "verified", "status",
                "confidence", "contributor_id", "created_at"]

# ---------------- 脱敏复检（单一真值源） ----------------
# 原 SENSITIVE_PATTERNS 是「示例级」的裸关键词列表，从未接线（死代码）。
# 接线前实测全库 44 条：5 条命中——3 条恰恰是在讲 token 怎么用
# （recipe-git-pat-push / recipe-gh-pages-pat-scope / recipe-git-push-no-tty-credential），
# 2 条命中的是正常内网 IP 10.255.255.1 与 ReadTimeout 里的「10.」。
# 按原样当闸门，这 5 条永远升不了级。故改为「凭据形态」匹配：
# 裸出现关键词不算，当成凭据用才算。收紧的是识别方式，不是放行标准——
# 负例（真凭据）仍须被全部拦下，见 tests/write-mcp.test.js。
SENSITIVE_RULES = [
    # 键值形态：token=xxx / password: xxx。全角冒号「：」也要拦——红队实测
    # （RT-B1）原字符类只有半角冒号与全角等号，"password：abc123456789" 直接放行。
    ("credential_kv",
     r"(?i)\b(api[_-]?key|apikey|secret|password|passwd|token|access[_-]?key)"
     r"\s*[:＝=：]\s*\S{4,}"),
    # 中文键名形态：密码：xxx / 密钥 = xxx。红队实测（RT-B2）原规则不含中文键，
    # 「把 密码：abc123456789 填进表单」整条放行。
    ("credential_cn",
     r"(?:密码|口令|密钥|秘钥|凭据)\s*[:＝=：]\s*\S{4,}"),
    # 凭据字面：各厂商密钥前缀。私钥头必须排在 \b 之外——它以 '-' 开头，
    # 前面加 \b 会因「非词字符之间无边界」而永远匹配不上（实测踩过）。
    ("credential_literal",
     r"(?:-----BEGIN [A-Z ]*PRIVATE KEY-----"
     r"|\b(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}"
     r"|Bearer\s+[A-Za-z0-9._\-]{16,})\b)"),
    # 家目录绝对路径
    ("user_home_path",
     r"(?i)(?:[A-Za-z]:\\Users\\[^\s\\'\"]+|/(?:home|Users)/[^\s/'\"]+)"),
    # 内网 IP。10.0.0.0/8 是 RFC 1918 且同时是 RFC 5737 的文档保留段
    # （现有两条配方就用 10.255.255.1 讲「怎么模拟国内不可达」），整段放行；
    # 要拦的是 192.168 / 172.16-31 这类真实的家庭与办公内网地址。
    ("internal_ip",
     r"\b(?:192\.168\.\d{1,3}\.\d{1,3}"
     r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b"),
    # 内网主机名
    ("internal_host",
     r"(?i)(?:https?://[^\s]*internal|internal(?:\.local\b|\.internal\b)"
     r"|\binternal\.(?:local|internal)\b)"),
]
# 只在自由文本字段里扫。id/tags/status 这类枚举值扫了只会误伤。
SENSITIVE_TEXT_FIELDS = (
    "title", "problem", "solution", "result", "retrospective",
    "model", "skills", "harness", "hardware", "agent_config",
)
DE_SUBFIELDS = ("attempt", "failure", "duration", "early_signal")


def _mask(text: str, m: "re.Match") -> str:
    """回显命中词的前后文，命中词本身打码——别把真凭据带回给调用方。"""
    lo, hi = max(0, m.start() - 12), min(len(text), m.end() + 12)
    lead = text[lo:m.start()].replace("\n", " ")
    trail = text[m.end():hi].replace("\n", " ")
    return f"{lead}<redacted>{trail}".strip()


def scan_sensitive(payload: dict) -> list:
    """脱敏复检。返回 [{"field","rule","reason","snippet"}]，空列表代表干净。"""
    hits = []

    def check(field, text):
        for label, pat in SENSITIVE_RULES:
            m = re.search(pat, text)
            if m:
                hits.append({
                    "field": field,
                    "rule": label,
                    "reason": f"命中脱敏规则「{label}」，含疑似凭据或内网信息",
                    "snippet": _mask(text, m),
                })
                return

    for f in SENSITIVE_TEXT_FIELDS:
        v = payload.get(f)
        if isinstance(v, str) and v:
            check(f, v)
    for i, d in enumerate(payload.get("dead_ends") or []):
        if isinstance(d, dict):
            for k in DE_SUBFIELDS:
                v = d.get(k)
                if isinstance(v, str) and v:
                    check(f"dead_ends[{i}].{k}", v)
    return hits


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
            for k in DE_SUBFIELDS:
                if not d.get(k):
                    errs.append(f"dead_ends[{i}] 缺子字段: {k}")
    for hit in scan_sensitive(payload):
        errs.append(f"{hit['field']}：{hit['reason']}（上下文：{hit['snippet']}）")
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

    fm = {k: p[k] for k in RENDER_ORDER if k in p}
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


# ===================== 写侧内核（MCP: submit_recipe / promote_recipe） =====================
# 与 CLI 的 ingest 共用 validate / render_md，不另写一套校验——本库反复吃亏在「两份真值源」。

ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
ID_MAX_LEN = 60
CJK_RE = re.compile(r"[一-鿿]")
CONFIDENCE_ENUM = ["A", "B", "C"]


class WriteError(Exception):
    """内容层面的拒绝，errors[] 逐条点名缺什么，供 Agent 补齐后重试。

    与「参数类型错误」分开是刻意的：前者要改内容、后者要改调用方式。
    混成一类，Agent 无法判断该重试还是该换调用方式。"""

    def __init__(self, errors):
        self.errors = list(errors)
        super().__init__("；".join(e["reason"] for e in self.errors))


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


def _existing_ids() -> set:
    if not os.path.isdir(RECIPES_DIR):
        return set()
    return {fn[:-3].lower() for fn in os.listdir(RECIPES_DIR) if fn.endswith(".md")}


def validate_submit(payload: dict) -> list:
    errs = []

    def need(field, cond=lambda v: True):
        v = payload.get(field)
        if v is None or v == "" or (isinstance(v, (list, dict)) and not v):
            if cond(v):
                errs.append({"field": field, "reason": f"缺少必填字段: {field}"})

    for f in ("title", "tags", "model", "problem", "solution"):
        need(f)
    # 类型必须显式是字符串。红队实测（RT-C1）：tags 传字符串能绕过「空白标签」检查
    # 投稿成功，落进 experiences.json 后网站渲染层 (r.tags||[]).slice().map() 对
    # 字符串抛 TypeError —— 一条投稿打挂整站渲染。类型在门口验，别指望渲染层兜底。
    for f in ("title", "model", "problem", "solution"):
        v = payload.get(f)
        if v is not None and not isinstance(v, str):
            errs.append({"field": f, "reason": f"{f} 必须是字符串（收到：{type(v).__name__}）"})
    # 体量上限（红队 RT-E1：5000 条 dead_ends 投稿被接受、耗时 8s）。限额远高于
    # 存量极值（title 80 字符 / problem 290 / solution 621 / dead_ends 6 条），只拦滥用。
    LIMITS = {"title": 200, "model": 120, "problem": 8000, "solution": 8000,
              "result": 8000, "retrospective": 8000}
    for f, cap in LIMITS.items():
        v = payload.get(f)
        if isinstance(v, str) and len(v) > cap:
            errs.append({"field": f, "reason": f"{f} 超长（{len(v)} 字符，上限 {cap}）"})
    de = payload.get("dead_ends")
    if not isinstance(de, list) or not de:
        errs.append({"field": "dead_ends",
                     "reason": "缺少必填字段: dead_ends（死胡同是本库的差异化价值，空数组等同没内容）"})
    else:
        if len(de) > 50:
            errs.append({"field": "dead_ends", "reason": f"dead_ends 过多（{len(de)} 条，上限 50）"})
        for i, d in enumerate(de):
            if not isinstance(d, dict):
                errs.append({"field": f"dead_ends[{i}]",
                             "reason": f"dead_ends[{i}] 必须是对象，含 attempt/failure/duration/early_signal 四段"})
                continue
            for k in DE_SUBFIELDS:
                if not str(d.get(k) or "").strip():
                    errs.append({"field": f"dead_ends[{i}].{k}",
                                 "reason": f"dead_ends[{i}] 缺子字段: {k}"})
    tags = payload.get("tags")
    if not isinstance(tags, list):
        errs.append({"field": "tags",
                     "reason": "tags 必须是字符串数组，例如 [\"python\", \"爬虫\"]"
                               + (f"（收到：{type(tags).__name__}）" if tags is not None else "")})
    else:
        if len(tags) > 20:
            errs.append({"field": "tags", "reason": f"tags 过多（{len(tags)} 个，上限 20）"})
        if any(not isinstance(t, str) or not t.strip() for t in tags):
            errs.append({"field": "tags", "reason": "tags 里不能有空白项或非字符串项"})
    # status / confidence / verified 由服务端与人工锁死。接受提交方指定 =
    # 把「人在把关」这个承诺拆了。
    # verified 尤其要紧：它是「这条结论有人真跑过、可复现」的标记，也是 A 档的门槛
    # （见 promotion_errors）。若允许投稿方自带 verified: true，Agent 就能自称
    # 「已验证」——门槛等于虚设。这和「提交方指定 status 让隔离失效」是同一类漏洞。
    for f in ("status", "confidence", "verified"):
        if payload.get(f):
            errs.append({"field": f, "reason": f"{f} 由服务端按治理规则决定，提交方不需要传"})
    for hit in scan_sensitive(payload):
        errs.append({"field": hit["field"],
                     "reason": hit["reason"] + f"（上下文：{hit['snippet']}）"})
    return errs


def _write_recipe(rid: str, record: dict) -> str:
    """渲染并落盘。任何一步失败都不留半成品。"""
    md_path = os.path.join(RECIPES_DIR, f"{rid}.md")
    os.makedirs(RECIPES_DIR, exist_ok=True)
    # 先把正文算成字符串再落笔。若边写边渲染，render_md 一抛错
    # open("w") 已经把目标文件截成 0 字节，磁盘上就留了个烂尾空文件。
    try:
        text = render_md(record)
    except Exception as e:
        raise WriteError([{"field": "render", "reason": f"渲染失败：{e}"}])
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(text)
    if not _roundtrip_ok(md_path):
        if os.path.exists(md_path):
            os.remove(md_path)  # 绝不让坏 .md 留在仓库里
        raise WriteError([{"field": "render",
                           "reason": "渲染出的 frontmatter 无法被 YAML 回读，已回滚，未留下半成品文件"}])
    return md_path


def _atomic_write(path: str, content: str):
    """临时文件 + os.replace 原子落盘。读侧（网站 fetch / MCP loadData）永不见半截 JSON。
    红队 RT-F 观察项：并发投稿下全表重写存在丢更新窗口，本函数先消除「读到撕裂文件」。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)


def sync_experiences():
    """把 recipes/*.md 的 frontmatter 同步进 api/experiences.json。

    与 rebuild 的区别：只刷新这份「全量工作副本」，不碰对外公开索引 llms.txt。
    隔离池必须立刻看得见新投稿，否则提交完什么都查不到，链路等于断了；
    而「人点头才公开」的把关拿 llms.txt 当闸门——它仍只在人跑 rebuild 时才更新。"""
    recipes = []
    if os.path.isdir(RECIPES_DIR):
        for fn in sorted(os.listdir(RECIPES_DIR)):
            if not fn.endswith(".md"):
                continue
            with open(os.path.join(RECIPES_DIR, fn), "r", encoding="utf-8") as f:
                fm = parse_frontmatter(f.read())
            if fm:
                recipes.append(fm)
    _atomic_write(EXP_JSON,
                  json.dumps(recipes, ensure_ascii=False, indent=2, default=str))


def submit_recipe(payload: dict) -> dict:
    errs = validate_submit(payload)
    if errs:
        raise WriteError(errs)

    title = str(payload["title"]).strip()
    explicit = str(payload.get("id") or "").strip()
    # 显式传进来的 id 含大写一律拒：静默转成小写等于替调用方改了主键，
    # 与 Recipe-X / recipe-x 撞车同属一类（PRD §5.2），该拒绝而不是悄悄归一。
    if explicit and explicit != explicit.lower():
        errs.append({"field": "id",
                     "reason": f"id 必须全部小写（收到：{explicit}）。库内 id 形如 recipe-sqlite-wal"})
        raise WriteError(errs)
    rid = explicit.lower()
    if not rid:
        # 中文占一半以上的标题不许自动推 id。原先的判断是「slugify 结果非空即可」，
        # 于是「重复 id 探针」推出主键 id、「抓下来全是乱码 ip 问题」推出 ip——
        # 这种主键看不出说的是哪个坑，还会让两篇不同标题撞出同一个 slug。
        # 但不能一刀切「含中文就拒」：英文标题后面挂句中文说明是常态
        # （「SQLite WAL 模式下并发写入卡住」本来就该推出 sqlite-wal），
        # 那种情况中文占比恰好 50%，按「过半才算中文标题」放行。
        cjk = len(CJK_RE.findall(title))
        if cjk * 2 > len(title.replace(" ", "").replace("-", "").replace("_", "")):
            errs.append({"field": "id",
                         "reason": "标题里有中文，无法自动推导 id（slugify 只会抠出一个英文词，"
                                   "例如「重复 id 探针」会推出主键 id）。请显式传 id，"
                                   "形如 recipe-sqlite-wal"})
            raise WriteError(errs)
        rid = slugify(title)
    if len(rid) > ID_MAX_LEN:
        errs.append({"field": "id", "reason": f"id 过长（{len(rid)} 字符，上限 {ID_MAX_LEN}）"})
        raise WriteError(errs)
    if not ID_RE.match(rid):
        errs.append({"field": "id",
                     "reason": "id 只允许小写字母、数字与中间的短横线（形如 recipe-sqlite-wal）"})
        raise WriteError(errs)
    if rid in _existing_ids():
        errs.append({"field": "id",
                     "reason": f"该 id 已存在（{rid}）。库内原有内容不会被覆盖，请换一个 id"})
        raise WriteError(errs)

    record = dict(payload)
    record["id"] = rid
    record["status"] = "quarantined"
    record["confidence"] = "C"
    record["created_at"] = datetime.date.today().isoformat()
    handle = str(payload.get("contributor") or "").strip()
    if handle:
        # 稳定匿名标识：同一句柄两次投稿得到同一个哈希，可计数、不可反查
        record["contributor_id"] = make_contributor_id(handle)
    record.pop("contributor", None)

    _write_recipe(rid, record)   # 返回值只有一个「相对路径」字符串，调用方用 rid 自己拼，不需要接
    sync_experiences()
    return {
        "id": rid,
        "path": f"recipes/{rid}.md",
        "contributor_id": record.get("contributor_id", ""),
        "status": record["status"],
        "confidence": record["confidence"],
        "next_human_action":
            "这条已进隔离池（C 级，暂不进主检索）。请你本人复核内容：认为值得留就调 "
            "promote_recipe(id, confidence=\"B\") 升为可信档并公开，否则调 "
            "promote_recipe(id, confidence=\"C\") 驳回。（注意参数名是 confidence，不是 level）"
            "对外公开索引还需你在维护者侧跑一次 ingest.py rebuild。",
    }


def read_recipe(rid: str) -> dict:
    # id 必须先过与投稿同一套格式校验再拼路径。红队实测（RT-A1/A2）：
    # 无校验时 promote_recipe("../x") 相对穿越可改写仓库外文件，
    # 盘符绝对路径（如 "C:/tmp/victim"）更会让 os.path.join 丢弃前缀、
    # 覆盖任意可写文件。投稿侧早有 ID_RE 把关，读取/晋升侧此前漏了。
    if not ID_RE.match(str(rid or "")):
        raise WriteError([{"field": "id",
                           "reason": f"id 格式非法：{rid}。只允许小写字母、数字与中间的短横线"
                                     f"（形如 recipe-sqlite-wal）"}])
    md_path = os.path.join(RECIPES_DIR, f"{rid}.md")
    if not os.path.exists(md_path):
        raise WriteError([{"field": "id",
                           "reason": f"库内没有这条配方：{rid}。先用 search_recipes 确认 id"}])
    with open(md_path, "r", encoding="utf-8") as f:
        text = f.read()
    fm = parse_frontmatter(text)
    if fm is None:
        raise WriteError([{"field": "file", "reason": f"{rid}.md 的 frontmatter 解析不了，需人工修文件"}])
    return {"path": md_path, "text": text, "fm": fm}


DE_SUBFIELDS_HINT = ("attempt：这条弯路当时试了什么；failure：它怎么失败的；"
                     "duration：卡了多久；early_signal：早该警觉的那个信号")


def promotion_errors(fm: dict, level: str) -> list:
    """晋升门槛：只判断够不够格，不判断内容真伪——后者是人的活儿。

    文案对象是「维护者本人」，不是程序。每条都要回答两件事：差什么、怎么补。
    改文案时别动 field 名，也别把「跳级」这个词抹掉——回归测试按它们断言的。"""
    if level not in CONFIDENCE_ENUM:
        return [{"field": "confidence",
                 "reason": f"confidence 只能是 A / B / C 之一（收到：{level}）。"
                           f"C 是驳回回隔离区，不设门槛；想让它进主检索，才需要升 B 或 A"}]
    if level == "C":
        return []  # 驳回回隔离区，不设门槛

    errs = []
    de = fm.get("dead_ends")
    if not isinstance(de, list) or not de:
        errs.append({"field": "dead_ends",
                     "reason": "升 B 需要 dead_ends 非空。一条没走通的弯路都没有，"
                               "这条就只能算「成功经验」而不是「配方」——配方卖的正是那段弯路。"
                               "按 recipe.schema.md 补 1 条以上，每条四段齐全"})
    else:
        for i, d in enumerate(de):
            if not isinstance(d, dict):
                errs.append({"field": f"dead_ends[{i}]",
                             "reason": "dead_ends 每条必须是一个对象，写法："
                                       "{\"attempt\": \"...\", \"failure\": \"...\", "
                                       "\"duration\": \"...\", \"early_signal\": \"...\"}"})
                continue
            for k in DE_SUBFIELDS:
                if not str(d.get(k) or "").strip():
                    errs.append({"field": f"dead_ends[{i}].{k}",
                                 "reason": f"dead_ends[{i}].{k} 是空的。四段各写什么：{DE_SUBFIELDS_HINT}"})
    for hit in scan_sensitive(fm):
        errs.append({"field": hit["field"],
                     "reason": f"脱敏复检没通过：{hit['reason']}。把真实值换成占位符再重试晋升"
                               f"（形如 sk-xxxx、AKIA-xxxx、C:\\Users\\<用户名>\\、192.168.x.x）。"
                               f"上下文：{hit['snippet']}"})
    # A 档门槛：verified 必须显式为 true。原先是「result 或 verified 非空」，两个毛病：
    #   1) 类型含糊——verified 一度被写成描述文字（"现场验收六幕实测通过"），
    #      将来任何 verified === true 的判断都会静默漏掉它们；
    #   2) 门槛虚设——一句描述就能满足「非空」，等于绕过了升 A 的验收要求。
    # 现在只认显式布尔 true：它是「这条结论有人真跑过、可复现」的唯一标记。
    if level == "A" and fm.get("verified") is not True:
        errs.append({"field": "verified",
                     "reason": "升 A 要求 verified 显式为 true，现在不是。"
                               "它是「有人真跑过一遍、结论可复现」的标记，投稿侧不能自带（会被拒），"
                               "只能由人确认后亲手写：先把实测结论写进 result，"
                               "再在 frontmatter 里把 verified 置 true，然后重调 promote_recipe。"
                               "只有「我觉得好了」不算，否则 A 档就不值钱了"})
    return errs


def rewrite_frontmatter(text: str, fm: dict) -> str:
    if not text.startswith("---"):
        raise WriteError([{"field": "file", "reason": "原文件没有 frontmatter，无法晋升"}])
    _, _, rest = text.split("---", 2)
    header = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False, default_flow_style=False)
    return "---\n" + header + "---" + rest


# 置信度分级高低：A 最高（有实测证据），C 最低（隔离/驳回）。用于降档判定。
_CONF_RANK = {"A": 3, "B": 2, "C": 1}

def promote_recipe(rid: str, level: str, confirm_downgrade: bool = False) -> dict:
    level = str(level or "").strip().upper()
    cur = read_recipe(rid)
    fm = cur["fm"]
    cur_conf = str(fm.get("confidence") or "A").upper()

    # 目标分级非法：尽早报错，避免下方按分级判断时 KeyError
    if level not in _CONF_RANK:
        raise WriteError([{"field": "confidence",
                           "reason": f"confidence 只能是 A / B / C 之一（收到：{level}）。"}])

    # 禁跳级：C 想直接升 A 必须先在 B 停一次，否则分级就失去意义
    if level == "A" and cur_conf == "C":
        raise WriteError([{"field": "confidence",
                           "reason": "禁止跳级：C 不能直接升 A。先调 promote_recipe(id, confidence=\"B\") "
                                     "在 B 停一次，过了 B 的门槛再升 A"}])

    # BL-017 降档二次确认：目标分级低于当前（A→B / A→C / B→C）需显式确认，防手滑。
    # 驳回回隔离区（→C）亦属降档，必须经人确认，否则一条公开配方会被静默打回。
    is_downgrade = _CONF_RANK[level] < _CONF_RANK[cur_conf]
    if is_downgrade and not confirm_downgrade:
        return {
            "id": rid,
            "confirm_required": True,
            "current_confidence": cur_conf,
            "target_confidence": level,
            "next_human_action":
                ("这是降档操作（" + cur_conf + " → " + level + "），"
                 + ("会把该配方打回隔离池、从公开索引消失" if level == "C"
                    else "公开置信度会下调为 " + level)
                 + "。确认无误请在调用时加 confirm_downgrade: true。"),
        }

    errs = promotion_errors(fm, level)
    if errs:
        raise WriteError(errs)  # 失败时不碰原稿，AC-6.6

    new_conf, new_status = level, ("quarantined" if level == "C" else "published")
    # 字段取舍按「原文件的样子」走，不按 RENDER_ORDER 过滤。
    # 曾经写成 {k: fm[k] for k in RENDER_ORDER if k in fm}，结果 44 条种子配方里的
    # seed: true 被晋升顺手删掉——网站靠它在卡片上打 SEED 角标，于是角标无声消失。
    # 不报错、不提示，只有角标没了，下次再看会以为是自己记错。未知字段必须留着。
    ordered = [k for k in fm if k in RENDER_ORDER]
    tail = [k for k in fm if k not in RENDER_ORDER]
    new_fm = {k: fm[k] for k in ordered + tail}
    new_fm["confidence"] = new_conf   # 晋升同时置 published，否则进不了公开目录
    new_fm["status"] = new_status

    try:
        with open(cur["path"], "w", encoding="utf-8") as f:
            f.write(rewrite_frontmatter(cur["text"], new_fm))
    except Exception as e:
        raise WriteError([{"field": "file", "reason": f"写入失败：{e}（原稿未改动）"}])
    if not _roundtrip_ok(cur["path"]):
        with open(cur["path"], "w", encoding="utf-8") as f:
            f.write(cur["text"])
        raise WriteError([{"field": "file",
                           "reason": "晋升后 frontmatter 无法被 YAML 回读，已还原原稿，内容未改动"}])
    sync_experiences()
    return {
        "id": rid,
        "confidence": new_conf,
        "status": new_status,
        "next_human_action":
            ("已驳回回隔离池（C 级）。"
             if level == "C" else "已升到 " + level + " 级并置为公开。"
             ) + "对外公开索引还需你在维护者侧跑一次 ingest.py rebuild。",
    }


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
    skipped = []
    if os.path.isdir(RECIPES_DIR):
        for fn in sorted(os.listdir(RECIPES_DIR)):
            if not fn.endswith(".md"):
                continue
            with open(os.path.join(RECIPES_DIR, fn), "r", encoding="utf-8") as f:
                text = f.read()
            fm = parse_frontmatter(text)
            if fm:
                recipes.append(fm)
            else:
                skipped.append(fn)
    # 红队 RT-G1：坏 .md 被静默跳过，rebuild 照常产出索引 —— 库少了一条没人知道。
    # 现在必须把跳过清单拍在维护者脸上：重建结果不完整，就是要喊出来。
    if skipped:
        print(f"❌ 重建不完整：{len(skipped)} 个 .md 无法解析，已从索引剔除：")
        for fn in skipped:
            print(f"  - {fn}")
        print("   请人工修复或删除上述文件后重跑 rebuild。")
    # 重建 experiences.json（原子写：读侧永不见半截文件）
    _atomic_write(EXP_JSON,
                  # default=str 兜底：YAML 可能把 created_at 解析为 date 对象，json 无法直接序列化
                  json.dumps(recipes, ensure_ascii=False, indent=2, default=str))
    print(f"✅ 已重建 {EXP_JSON}（{len(recipes)} 条）")
    # 重建 llms.txt（仅 published，原子写）
    pub = [r for r in recipes if r.get("status") == "published"]
    lines = [
        "# agent-recipe-book（解题配方库）\n",
        "> 人类解题经验的机器可读共享库。每条配方含 模型/skill/harness/硬件 与结构化死胡同。\n\n",
        "## 索引\n",
    ]
    for r in pub:
        sol = (r.get("solution") or "")[:40]
        lines.append(f"- recipes/{r['id']}.md: {r.get('title','')} — {sol}\n")
    lines.append("\n## 如何被 Agent 读取\n")
    lines.append("GET api/experiences.json 获取全量结构化数据；GET llms.txt 获取索引。\n")
    lines.append("详见 CONTRIBUTING.md 与 recipe.schema.md (v3.0)。\n")
    _atomic_write(LLMS_TXT, "".join(lines))
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


def _emit(result):
    print(json.dumps({"ok": True, **result}, ensure_ascii=False))


def _emit_err(e: WriteError):
    # 走 stdout 而非 stderr：调用方统一从 stdout 解析一行 JSON
    print(json.dumps({"ok": False, "errors": e.errors}, ensure_ascii=False))
    sys.exit(2)


if __name__ == "__main__":
    USAGE = ("用法：python ingest.py ingest <recipe.json> | rebuild | "
             "submit '<json>' | promote <id> <A|B|C>")
    if len(sys.argv) < 2:
        print(USAGE)
        sys.exit(1)
    cmd = sys.argv[1]
    try:
        if cmd == "ingest" and len(sys.argv) == 3:
            ingest(sys.argv[2])
        elif cmd == "rebuild":
            rebuild()
        elif cmd == "submit" and len(sys.argv) == 3 and sys.argv[2] == "-":
            # 从 stdin 读：Windows 下用命令行参数传一段长 JSON 会撞长度限制
            try:
                payload = json.load(sys.stdin)
            except json.JSONDecodeError as e:
                print(json.dumps({"ok": False, "errors": [
                    {"field": "json", "reason": f"JSON 解析失败：{e}"}]}, ensure_ascii=False))
                sys.exit(2)
            _emit(submit_recipe(payload))
        elif cmd == "promote" and len(sys.argv) in (4, 5):
            confirm = "--confirm-downgrade" in sys.argv[4:]
            _emit(promote_recipe(sys.argv[2], sys.argv[3], confirm_downgrade=confirm))
        else:
            print("未知命令。" + USAGE)
            sys.exit(1)
    except WriteError as e:
        _emit_err(e)
