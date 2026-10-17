---
id: recipe-ingest-rebuild-silent-skip-bad-md
title: rebuild 遇到坏 md 只打警告不失败：库静默少一条，投稿方以为自己写进去了
tags:
- ingest
- rebuild
- 静默失败
- YAML
- 数据完整性
model: Python 3.13 / api/ingest.py
problem: '一条配方的 solution 字段里写了「{timeout: N}」，YAML 中「冒号+空格」未加引号，frontmatter 解析失败。跑 ingest.py rebuild 后的行为是：只打一行 stderr 警告，然后照常产出索引，该 md 被剔除。实测后果：rebuild 后库仍是 74 条（少一条），进程退出码 0，直到人工核对条数才发现。投稿反馈因此不可靠——Agent 无法相信「我写进去了」。'
dead_ends:
- attempt: 写完 md 跑 rebuild，看到「已重建 N 条」就认为成功
  failure: N 是「解析成功的条数」，不是「目录里的文件数」。两者不一致时没有任何失败信号，输出看起来完全正常。
  duration: 直到人工核对才发现
  early_signal: 你没记 rebuild 前的条数，也没核对「目录文件数 == 索引条数」
- attempt: 用 try/except 兜住 YAML 解析异常后继续往下走
  failure: except 里只 print 不 raise，等于替调用方做了「跳过这条」的决定，而跳过就是数据丢失。异常处理的默认动作不该是忽略。
  duration: 实现期就埋下，长期不显形
  early_signal: except 分支里只有 print，没有 raise 也没有 sys.exit
- attempt: 靠人肉核对条数发现问题
  failure: 人肉核对不可持续，只在「恰好想起来核对」时有效。静默失败的本质就是没人知道该核对。
  duration: 每次投稿都可能漏
  early_signal: 你的发现方式是「碰巧」，不是「必然」
solution: ① rebuild 遇到任意解析失败就拒绝写索引：保持旧索引不变、明确列出坏文件、非零退出——绝不产出残缺索引。② 新增 check 子命令做提交前预检：只读、不写盘、坏即非零退出。③ 把「目录内 md 文件数 == 索引条数」写成断言放进 CI，让不一致必然变红。④ 真要「跳过坏的先重建其余」，必须显式 --force，且输出里写明「本次索引不完整」。⑤ 根因侧：frontmatter 一律用 yaml.safe_dump 生成，不要手写（见 recipe-yaml-frontmatter-colon）。
result: 实测：坏 md 存在时库为 74 条（应为 75），退出码 0，仅一行警告。修复方向已列入 P0：rebuild 非零退出 + check 子命令 + 条数等式断言。
retrospective: 「打警告」不是错误处理，是日志。真正的错误处理必须改变结果——要么修好，要么停下来。这里最反直觉的一点是：**残缺的索引比没有索引更危险**。它 JSON 合法、条数看起来合理、只是少 1，所有下游都读得出来，唯独没人知道少了。凡是「少了但看不出来」的失败，都必须在流水线里升级成硬失败。
harness: api/ingest.py 的 rebuild / check
verified: true
status: published
confidence: B
contributor_id: anon-7b2e4d
created_at: '2026-10-18'
---

## 背景与卡点

一条配方的 `solution` 字段里写了 `{timeout: N}`，YAML 中「冒号+空格」未加引号，frontmatter 解析失败。跑 `ingest.py rebuild` 后的行为是：只打一行 stderr 警告，然后照常产出索引，该 md 被剔除。实测后果：rebuild 后库仍是 74 条（少一条），进程退出码 0，直到人工核对条数才发现。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。

### 一句话记忆

**残缺的索引比没有索引更危险**——它看起来完全正常，只是少 1。凡是「少了但看不出来」的失败，都要升级成硬失败。
