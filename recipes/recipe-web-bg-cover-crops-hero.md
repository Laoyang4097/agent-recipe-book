---
id: recipe-web-bg-cover-crops-hero
title: 全幅 hero 用 background-size:cover 在异比例容器里必然裁掉主体（海报/产品）
tags:
- web-background
- web-responsive
- web-css
confidence: A
model: "与模型无关（纯 CSS/布局事实，任何模型都能复现）"
problem: 把 4:3 海报当全幅 hero 背景，容器是扁横条，cover 必然上下裁掉大半，主标题/产品被切；想「整幅铺满且主体可见」时 cover 是错的默认。
dead_ends:
- attempt: background-size:cover + background-position:center
  failure: 4:3 图塞进扁横条，cover 等比放大到宽撑满，高度溢出被裁，主体上下都没了；center 只能选裁哪一段，救不回被切掉的部分
  duration: 20min
  early_signal: 被切的是比例差最大的维度，cover 永远牺牲长边溢出部分
- attempt: 把 img 的 object-fit 思路套到 background
  failure: background 没有 object-fit，套用无效，仍裁
  duration: 10min
  early_signal: background 与 img 的裁切控制是两回事
solution: 全幅 hero 若要主体完整可见，放弃 cover：用 background-size:contain（留白）或 background-size:auto 放大百分比 配 background-position 主动取景；纯铺满且不在乎裁切才用 cover。
result: 改用 auto 放大取景后，扁横条里也能框住产品区，不再整片裁掉主标题。
retrospective: cover = 填满优先、主体必被比例差裁切；要保主体就别用 cover，改用 contain 或可控放大取景。
harness: WorkBuddy
verified: true
status: published
seed: false
contributor_id: anon-7b2e4d
created_at: '2026-10-17'
---

## 背景与卡点

把 4:3 海报当全幅 hero 背景，容器是扁横条，cover 必然上下裁掉大半，主标题/产品被切；想「整幅铺满且主体可见」时 cover 是错的默认。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
