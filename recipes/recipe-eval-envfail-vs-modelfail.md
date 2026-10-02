---
id: recipe-eval-envfail-vs-modelfail
title: 评测里「连不上靶站」被算成「模型不会」：一次环境噪声就把对照组基线打空，结论直接反转
tags:
- eval
- ab-test
- harness
- observability
- statistics
model: Node 驱动 + 子进程跑 Python requests + 本地 mock 靶站
problem: 跑 A/B/C/D 对照实验时，本地 mock 靶站偶发连不上（临时端口耗尽 / 残留进程 / 系统代理拦截回环地址）。模型生成的代码若没捕获该异常，脚本会崩在第一次请求上、stdout
  为空 —— 判分器只能看到「没有任何输出」，于是记成「模型不会解」。实测：弱模型对照组的翻页题 5 次运行 × 每轮 3 次尝试，stderr 全是 urllib3
  建连失败、printed=0/unique=0，一个请求都没到达靶站，却被当成「裸模型 0%」的基线写进结论。而基于这个 0% 算出来的 A vs B p=0.010、A
  vs D p=0.025 「显著提升」，在剔除环境失败后变成 p=0.118 / p=0.188，全部不显著。
dead_ends:
- attempt: 直接把判分器的 pass 结果按组统计通过率，失败一律计入分母
  failure: 连接层失败被当成了「被测对象失败」。对照组整格被打空（原口径 0/10），却看不出异常——因为「0 分」看起来和「模型不会」一模一样。
  duration: 整轮实验跑完约 1 小时，事后审计才发现
  early_signal: 失败格 stdout 恒为空、且靶站侧计数（如 429 计数、请求数）为零 —— 说明请求根本没到达靶站；把 traces 里的 stderr
    打开就能看到建连失败栈
- attempt: 环境失败后照旧把「判分未通过」的失败信息喂回模型，让它改代码
  failure: 逼模型去修一个并不存在的 bug，样本本身被改变了 —— 这时候再比较「配方有没有用」已经不成立（处理组和对照组的代码被不同的噪声扰动过）。
  duration: 若不改，会持续污染后续每一轮
  early_signal: 回喂给模型的失败原因与被测能力无关（是网络层错误），而不是任务本身的判分细节
- attempt: 只把 stderr 前 400 字存进 traces 当证据
  failure: Python 栈的根因在最后一行，栈顶只是通用帧。存下来的是「urllib3 connection.py line 239 in _new_conn」，真正的错误信息（连接被拒
    / 代理返回）在栈尾被截掉，事后无法归因到具体原因。
  duration: 事后审计时才发现，已无法复原
  early_signal: trace 里的 stderr 全部以相同的两行开头、长度恰好等于截断上限
solution: ① 判据进 harness：stderr/输出命中连接层特征（urllib3 / NewConnectionError / ConnectionRefusedError
  / ConnectionResetError / HTTPConnectionPool / ProxyError / Failed to establish /
  Max retries exceeded）即判 envError，而不是模型失败。② 判到 envError 时用同一份代码重跑（不重新调用模型），把瞬时抖动挡在判分之外且不改变样本。③
  重跑仍失败则记 envError=true，从通过率分母里剔除，汇总表单列「环境失败」条数，通过率一律用「通过/有效」。④ 每次执行前探测靶站健康，失联则自动重启。⑤
  stderr 同时保留尾部 400 字，并在判分之外的字段里留全量。⑥ 强制本地回环绕代理（清空 HTTP(S)_PROXY、设 NO_PROXY=127.0.0.1,localhost,*）。
result: 正向复现：把靶站故意停掉后，4 份不同的模型代码全部 60 秒超时、stdout 空 —— 「空 stdout + 超时」就是环境失败的指纹。按新口径重算历史数据：弱模型对照组在静默坑维度的有效样本从
  10 降到 3（翻页题 5 条全被判环境失败），A vs B 由 p=0.010 变为 p=0.118、A vs D 由 p=0.025 变为 p=0.188，原有的「显著提升」结论被撤回。
retrospective: 「失败」必须拆成「被测对象失败」和「测量环境失败」两类：前者是信号，后者是噪声。混在一起时，噪声会伪装成基线（0%），把一个假阳性结论抬得漂漂亮亮。判据要写进
  harness 并默认开启，不能指望人事后肉眼发现。另一个反直觉点：环境失败常和「模型不会」长得一模一样（都是 0 分、都无输出），所以需要一个与任务无关的旁证变量（靶站侧计数）来做仲裁。
harness: Node child_process 驱动 Python；靶站为本地 HTTP mock
verified: true
meta: true
status: published
confidence: A
contributor_id: anon-602c63
created_at: '2026-10-01'
---

## 背景与卡点

跑 A/B/C/D 对照实验时，本地 mock 靶站偶发连不上（临时端口耗尽 / 残留进程 / 系统代理拦截回环地址）。模型生成的代码若没捕获该异常，脚本会崩在第一次请求上、stdout 为空 —— 判分器只能看到「没有任何输出」，于是记成「模型不会解」。实测：弱模型对照组的翻页题 5 次运行 × 每轮 3 次尝试，stderr 全是 urllib3 建连失败、printed=0/unique=0，一个请求都没到达靶站，却被当成「裸模型 0%」的基线写进结论。而基于这个 0% 算出来的 A vs B p=0.010、A vs D p=0.025 「显著提升」，在剔除环境失败后变成 p=0.118 / p=0.188，全部不显著。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
