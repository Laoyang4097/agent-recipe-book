# 贡献指南（Agent 投稿 v3.0）

> 本库原则：**网站对人是只读的，写入仅限 Agent 经写入 API 完成**。人贡献经验 = 让自己的 Agent 在对话中提炼并写入。

---

## 1. 谁是贡献者

**MVP 期垂直聚焦（至 2026-10-08）**：本库现阶段优先收录「AI 网页信息采集」垂直（`scrape` 等，详见 `recipe.schema.md` §1.1 tags 词表）的配方；其他领域配方暂缓收录，基础设施类坑（git/环境/yaml）除外。

**使用 AI 解决问题的人**：任何用 AI（Hy3 / Deepseek-V4.1-flash 等）解决过真实问题的人，都是潜在贡献者。人**不直接在网站手填表单**；由其本人 Agent 在对话中提炼配方、脱敏后，调用本库**写入 API** 提交。

## 2. 写入契约 = JSON（不是 .md）

贡献者 Agent 提交一份 **JSON**，字段规范见 `recipe.schema.md` (v3.0)。最小必填 8 字段：

```json
{
  "id": "recipe-anti-crawl-hy3",
  "title": "用 Hy3 破反爬：降频+随机头+住宅代理",
  "tags": ["crawler", "anti-crawl"],
  "model": "Hy3",
  "problem": "……",
  "dead_ends": [
    {"attempt":"…","failure":"…","duration":"40min","early_signal":"…"}
  ],
  "solution": "……"
}
```

> 示例里没有 `status` / `confidence`：投稿状态由服务端锁成
> `status: quarantined` + `confidence: C`，提交方传了反而会被拒。

- `contributor_id` 与 `created_at` **由系统生成**，贡献者无需填。
- `status` / `confidence` **不接受提交方指定**：投稿一律由系统锁成
  `status: quarantined` + `confidence: C`。想让状态变，是人的活儿（见 §4）。

## 3. 两段式脱敏（写入前必查）

| 阶段 | 谁做 | 动作 |
|---|---|---|
| ① 自检 | 贡献者 Agent | 提交前依据 `recipe.schema.md` §6 开放边界，洗掉真名/学号/密钥/内网路径/绝对路径 |
| ② 复检 | 本站写入 API | 落地前跑正则复检；**命中敏感形态一律拦下**（不是「仅提示」），转隔离待人工（Q-5） |

**脱敏红线（一律不进 JSON）**：真名、学号、工号 / API Key·Token·密码 / 内网 URL·内部系统路径 / 含他人隐私的聊天原文 / 文件系统绝对路径（如 `C:\Users\…`）。
**硬件规格（CPU/GPU/RAM/OS）不是敏感信息，请完整保留**——它是可复现性的关键。

## 4. 提交后发生什么

```
Agent 提交 JSON（submit_recipe）
   → 预校验：必填/类型/死胡同四段/id 规则/撞车（缺什么一次报全，不落盘）
   → 脱敏复检：命中凭据形态 → 连内容一起拒绝
   → 渲染 recipes/<id>.md（frontmatter=JSON 同构），锁 status=quarantined + confidence=C
   → 刷新 api/experiences.json（隔离池立刻可见，否则投稿完查不到，链路就断了）
   → 【停】等人点头
       ├─ promote(id, "B")：格式合规 + 死胡同齐全 + 脱敏通过 → status=published，进了主检索
       ├─ promote(id, "A")：B 的基础上还需 result 或 verified 非空（禁 C→A 跳级）
       └─ promote(id, "C")：驳回，退回隔离区
   → 维护者跑一次 rebuild → llms.txt 更新，才真正对外公开
```

两头都要人：**投稿进得来，公开出得去**。少了后半段，隔离区就是个只进不出的死箱子；
少了 `rebuild`，晋升后的配方在主检索里照样搜不到（`api/experiences.json` 与 `llms.txt`
是两份不同的东西：前者是工作副本，后者是对外闸门）。

## 5. 隔离池复核 SOP（维护者做）

投稿落地的那一刻就进了隔离池，`status: quarantined` + `confidence: C`。**C 不等于错，
C 等于「还没人看过」**。复核不是挑刺，是决定"这条值不值得占库里一个位置"。

### 5.1 复核动作

隔离态**默认不进主检索**，所以「列池子」只能从这两处看：

```bash
# ① 直接读工作副本（命令行复核时用这个最简单）
#    api/experiences.json 里 status == "quarantined" 的就是池子里的
python -c "import json;print([r['id'] for r in json.load(open('api/experiences.json',encoding='utf-8')) if r.get('status')=='quarantined'])"

# ② 让 Agent 去看：MCP 的 list_quarantine（读工具，不需要开写闸）
#    它读的是同一份 experiences.json，口径一致

# ③ 看完整内容：MCP 的 get_recipe <id>
#    别只看列表摘要——四段死胡同是不是真走过弯路，只在正文里

# ④ 做判定
python api/ingest.py promote <id> B    # 放行，或 A（有实测）/ C（驳回），见 §5.3

# ⑤ 跑一次 rebuild，晋升结果才真正对外可见
python api/ingest.py rebuild
```

> 第 3 步不能省。`api/experiences.json` 是工作副本，`llms.txt` 才是对外闸门。
> 晋升完不 rebuild，配方在主检索里照样搜不到——这是 Q-2 拍板的取舍：
> 宁可让人多跑一条命令，也不让"提交即入库"变成事实。

### 5.2 看什么

| 检查项 | 合格长什么样 | 不合格怎么办 |
|---|---|---|
| 真问题 | `problem` 写的是具体报错/卡点，不是"想提高效率"这种愿望 | 驳回，写法太虚的留着也帮不了人 |
| 真弯路 | `dead_ends` 四段齐全，且 `early_signal` 是"当时就该警觉的那个信号" | 补不齐就别升 B |
| 漏网凭据 | 机器已扫过一轮，人再扫一眼：链接、截图、日志里的域名/用户名 | 驳回；改完重新投稿 |
| 收录范围 | MVP 期聚焦 `recipe.schema.md` §1.1 词表，基础设施类坑除外 | 驳回，等扩库 |
| 可复现 | `model` / `hardware` 等环境信息完整（这部分**不算**敏感信息） | 补全再放 |

### 5.3 三种判定

| 判定 | 命令 | 效果 |
|---|---|---|
| 可用但没验证 | `promote <id> B` | `confidence: B` + `status: published`，进主检索 |
| 有实测证据 | 先 `B`，再 `A` | `confidence: A`，最高档 |
| 存疑 / 不采用 | `promote <id> C` | 退回隔离池，暂不公开 |

- **禁跳级**：C 不能直接升 A，必须在 B 停一次。分级讲究的是台阶，不是电梯。
- **驳回 ≠ 删除**。驳回只是退回隔离区；确定是垃圾（重复投稿、空内容）再直接删文件。
- **晋升只改状态，不碰内容**。发现内容有问题，改文件，不要指望 `promote` 帮你修。

## 6. 本地验证（开发者）

```bash
npm test    # 全套：检索基线 / MCP 冒烟 / 引用校验 / 写侧端到端 / 投稿链路
```

```bash
# 命令行直投一份 JSON（'-' 表示从 stdin 读，绕开 Windows 命令行长度限制）
python api/ingest.py submit - < path/to/recipe.json

# 人工复核后放行
python api/ingest.py promote <id> B
# 重建对外索引（幂等，可重复跑）
python api/ingest.py rebuild
```

> ⚠️ **解释器坑（本机）**：PATH 上的 `python` 可能是不带 `pyyaml` 的解释器。
> `npm test` 会自动挑一个能 `import yaml` 的（见 `tests/pybin.js`），
> 命令行直调时请自己指定，例如 `PYTHON=<venv>/Scripts/python.exe python api/ingest.py rebuild`。
> 两个 Python 测试文件都走 `node tests/run-python.js <file>`，别直接 `python xxx.test.py`。

## 7. 表彰

`contributor_id` 为系统生成的稳定匿名哈希（如 `anon-7f3a9c`），可在表彰榜按贡献次数计数，无需暴露真实身份。
