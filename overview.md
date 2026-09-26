# 写侧 MCP M1 交付说明

> 对应 PRD：[`写侧MCP_PRD_v1.0_2026-09-25.md`](../写侧MCP_PRD_v1.0_2026-09-25.md) §8 / §9
> 交付日期：2026-09-26

## 一句话

「你现在可以让你的 Agent 把这个坑写进库了。」——投稿进得来（`submit_recipe`），
公开出得去（`promote_recipe`），中间卡在隔离池里等人点头。

## 已拍板并落地

| 编号 | 问题 | 结论 |
|---|---|---|
| Q-0 | 投稿即公开？ | 否。落盘即 `status: quarantined` + `confidence: C`（双锁） |
| Q-1 | AI 能不能搜到 | 只认 `status`，`confidence` 回归排序与存疑标记；C 级隔离区规则一字不改 |
| Q-2 | 人的动作能否多一步 | 能。`llms.txt` 等人跑 `ingest.py rebuild` 才更新 |
| Q-3 | 写权限开关粒度 | 进程级：`RECIPE_BOOK_WRITE=1` |
| Q-4 | 脱敏命中是否阻断 | 阻断并转待审，不做「仅提示」 |
| Q-5 | 脱敏正则是否本期接线 | 做。死代码 `SENSITIVE_PATTERNS` → 已接线 |

## 交付清单

| 项 | 位置 |
|---|---|
| `submit_recipe` / `promote_recipe` | `mcp/server.js` + `api/ingest.py` |
| 写侧内核（校验 / 渲染 / 隔离双锁 / 晋升门槛） | `api/ingest.py`：`validate_submit` / `_write_recipe` / `submit_recipe` / `promote_recipe` |
| 脱敏（按「凭据形态」匹配，命中即拦） | `api/ingest.py`：`SENSITIVE_RULES` / `scan_sensitive` |
| Python 层回归 | `tests/ingest_write.test.py`（39 项） |
| MCP 层端到端回归 | `tests/write-mcp.test.js`（25 项，走真 stdio JSON-RPC） |
| 解释器挑选（读写侧共用） | `lib/pybin.js`（由 `tests/pybin.js` 下沉） |
| 文档回写 | `mcp/README.md` / `CONTRIBUTING.md` / PRD §8 §9 |

## 验证

```
npm test   →  exit=0，253 项断言全绿，recipes/ 与索引零污染
rebuild    →  44 → 44（幂等，无漂移）
```

默认 `tools/list` = 4 个读工具；`RECIPE_BOOK_WRITE=1` = 6 个。
未开闸调写工具返回 `-32602`。

## 实现期发现并修掉的两个坑

1. **`_write_recipe` 会留烂尾空文件**：原先边写边渲染，`render_md` 抛错时 `open("w")`
   已把目标文件截成 0 字节。改为先把正文算成字符串再落笔。
2. **MCP 层把空字符串判错错误类别**：`title: ""` 原先走 `-32602`（协议错误），
   但那是「内容还没写」不是「调用方式错了」。已放行到内核报业务 `errors[]`。

## 两条值得记住的既有陷阱（已写进代码注释与文档）

- `confidence` 曾不在 `RENDER_ORDER` 里 → 渲染出的配方不带它 → rebuild 回来 `confidenceOf`
  回落默认 A → 隔离稿被主检索直接返回。已补进清单。
- 脱敏规则按原文接线会误伤全库 5 条，其中 3 条恰恰在讲 token 怎么用。
  收紧的是识别方式（键值赋值 / 各厂商密钥前缀 / 家目录 / 内网 IP / 内网域名），不是放行标准。

## 未做

- tags 白名单硬校验：**不做**（PRD Q-6 建议），只在回执中提示

---

# M2（完整）交付说明 · 2026-09-26

M1 让投稿进得来，M2 补的是「人怎么把池子里那条捞出来看、看了怎么放行」。

## 交付清单

| 项 | 位置 |
|---|---|
| 隔离池复核 SOP | `CONTRIBUTING.md` §5（看什么 / 三种判定 / rebuild 不可省） |
| 复核四步 + 门槛文案指路 | `mcp/README.md`《复核一条隔离稿要几步》 |
| 晋升门槛文案改为「差什么 + 怎么补」 | `api/ingest.py::promotion_errors` |
| C 级破例露头回归断言 R-1..R-5 | `tests/search-quarantine.test.js`（18 → 25 项） |
| 端到端闭环「提交 → 搜不到 → 晋升 B → 搜得到」 | `tests/write-mcp.test.js`（23 → 25 项） |
| PRD §5.7 的 B-4 引用更正 | 原文把 C 级破例露头错引到 B-4（B-4 实为写工具开关） |

## 验证

```
npm test   →  exit=0，281 项断言全绿（M1 末为 253），recipes/ 与索引零污染
rebuild    →  幂等无漂移
```

## M2 期发现的三个问题（都已修）

1. **`C_LOOSE` 探针构造错了**：本想把一条弱命中的 C 压在阈值下，结果它的标题里
   就写着「螺栓」两个字，吃到了标题权重 +2，跟强命中同分 → `matchPct` 直接 100，
   断言变成自我实现的空转。改成标题里一个相关词都不出现。
2. **`promotion_errors` 的 dead_ends 分支在生产路径上到不了**：`submit_recipe` 的
   `validate_submit` 已经把四段卡死，投稿过不来的东西晋升时不可能缺。它唯一 reachable
   的场景是「人工改过隔离稿」。单测改为直接打 `promotion_errors()`——**既要证明这条分支
   仍在守门，也不能因为测不到就当它不存在**（这正是 `SENSITIVE_PATTERNS` 变死代码的同一个坑）。
3. **两处文档自相矛盾**：`CONTRIBUTING.md` 示例 JSON 里还留着 `"status": "draft"`，
   和紧邻的「不接受提交方指定」打架；`mcp/README.md` 的隔离桶写法 `node mcp/server.js`
   只是起服务等 stdin，列不出池子。都已改为可直接执行的命令。

---

# 现场验收 · 2026-09-26

本轮开工第一件事是「真跑一遍」，不是「看测试绿了就交」。跑出来六幕，全过：

| 幕 | 动作 | 实测结果 |
|---|---|---|
| 2 | `submit_recipe` 投一条真稿 | `ok=true`，落盘 `recipes/demo-gitbash-tmp-not-windows.md`，`status: quarantined` + `confidence: C`，贡献者 `anon-4af947`（匿名哈希） |
| 3 | 主检索 / 隔离池双口径 | 主检索**搜不到**它；`list_quarantine` **能看到**它 —— 投稿 ≠ 公开落实了 |
| 4 | 投一条 `solution` 带 `sk-` 形态密钥 | 拦下，未落盘，理由里命中词已打码成 `<redacted>` |
| 5 | `promote_recipe(id, B)` | `status: published` + `confidence: B`，内容一字未改 |
| 6 | 命令行 `ingest.py rebuild` | 公开索引 44 → 45，检索**搜得到**它，隔离池**同时移出**（不重复可见） |
| 收尾 | 删演示稿 + rebuild | `recipes/` 回到 44 条，零残留 |

**验收过程里挖出的第四个问题（最要紧的一个）：**

`mcp/server.js` 挑 Python 解释器时退回裸 `python`。而本机 PATH 上的 `python` 不带 pyyaml，
带 pyyaml 的在另一个 venv 里 —— 结果是**默认配置下开闸必然失败**，`submit_recipe` 100% 报错，
而报错写着「未安装 pyyaml」，看着像让用户装个依赖，实际装一万个也没用。

之前测试没抓到，是因为测试自己已经用 `pickPython()` 选对了解释器，把这条路径绕过去了。

修法：`pythonBin()` 改为复用 `lib/pybin.js` 的 `pickPython()`（按「能 `import yaml`」筛，不按名字猜），
把选中的解释器打到 stderr；万一挑错，报错直接点名**是哪个解释器 + 候选有哪些**。
`tests/pybin.js` 下沉为 `lib/pybin.js`，读写侧共用一份。

教训同前三条：**「测试里能跑通」不等于「用户那儿能跑通」** —— 测试进程自己做的环境准备，
不能替用户做掉。

## 本轮验证

```
npm test   →  exit=0，0 个 ❌，recipes/ 与索引零污染
现场验收    →  六幕全过，收尾零残留（44 → 44）
```

---

# 踩坑配方补写 · 2026-09-26

把 M1 / M2 / 现场验收三个阶段的坑回写成配方，只收**细节确凿**的（能回溯到具体报错原文或
具体代码位置），记不清的宁可不写。共 9 条，全部 `confidence: B`、
`contributor_id: anon-17753a`。

| 配方 | 一句话 |
|---|---|
| `recipe-interpreter-pick-not-install` | 不是缺依赖，是挑错了解释器——默认配置下开闸必然失败，而测试全绿 |
| `recipe-redact-rules-true-corpus-first` | 脱敏规则落地前先拿真库跑：一个文档保留段就废了整条规则 |
| `recipe-render-order-drift` | 新字段漏进渲染清单等于没落盘——`confidence` 不在 `RENDER_ORDER` 里 |
| `recipe-atomic-write-half-file` | 边写边渲染会留 0 字节烂尾文件 |
| `recipe-fixture-fake-weak-match` | 自己造的弱命中探针是假的，断言自己实现了自己的期望值 |
| `recipe-error-class-split` | 静默归一等于替调用方改主键；错误分类错了等于让 Agent 白改参数 |
| `recipe-tmp-gitbash-vs-windows-python` | Git Bash 的 `/tmp` 和 Windows Python 眼里的不是同一个目录 |
| `recipe-unreachable-branch-in-engine` | 生产路径走不到的分支也要单测它——否则又是一段没人走的死代码 |
| `recipe-validate-without-assign` | 校验了却忘了赋值，类型检查过了内容还是空的 |

**写配方时自己又撞了同一道闸**：`solution` 里照抄了密钥前缀与家目录路径，被自家脱敏规则
拦下、不落盘、报错里的命中词还打了码。一道能拦住写它的人的红线，才算真接上了。

**这 9 条一落库就红了两条既有断言**——`tests/search-quarantine.test.js` 里写的是
「真实配方全部 `confidence='A'`」，那是晋升机制还不存在时的前提。现在 B 档是晋升的合法产物，
断言守的其实是「主库里不许有非放行档」，字面表述只是那个前提的影子。已改为守真意图：

- 「真实配方无一处于隔离态（C / quarantined）」——真正要挡的是隔离稿漏进主库
- 「真实库已出现 B 档」——顺手钉住晋升链路别变成没人碰过的死代码
- 检索结果的 `confidence` 放宽到 A / B

不是为绿改断言：守字面会挡住正常动作，守真意图才算守住了。

顺手也修了同一类问题的另一处：`tests/write-mcp.test.js` 收尾断言写死「`recipes/` 文件数回到 44」——
正是那条断言的注释自己警告过的「写死数字会让正常动作变红」。改成与开跑前快照逐一比对。
