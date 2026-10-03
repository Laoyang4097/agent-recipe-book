---
id: recipe-py-encoding-detector-misjudges-cjk
title: 编码检测库在短文本上把 GBK 中文判成韩文 cp949；Big5 与 GBK 字节结构相同，只能靠私用区字符区分
tags:
- encoding
- scrape
- python
confidence: A
model: Agent+Python requests（本机 Windows）
problem: '用 charset_normalizer 或 chardet 检测中文页面编码时，短文本上频繁把 GBK 简体中文判成韩文 cp949，解出来一堆谚文。想改用字节结构自己判，又发现 Big5 繁体与 GBK 简体都是双字节编码，覆盖率同样高，光看结构分不开。'
dead_ends:
- attempt: 直接信检测库的 best().encoding，拿它 decode
  failure: 短文本（几十到几百字）上 charset_normalizer 把 GBK 中文判成 cp949，解出来是谚文而不是汉字；chardet 有同类问题。检测库在短样本上统计特征不足，结论不可靠
  duration: 约 10 分钟（反复对照不同片段）
  early_signal: 解出来的文本里出现谚文音节（U+AC00 到 U+D7A3）而不是汉字，而原文本该是简体中文
- attempt: 改用「GBK 双字节覆盖率」做结构判定，覆盖率高就判 GBK
  failure: Big5 也是双字节编码，覆盖率同样能到 85% 以上，于是繁体页被当成简体解，出来一堆汉字但全是错的（同码不同字）
  duration: 约 15 分钟
  early_signal: 解出来是汉字但语义不通、繁简混杂，且没有任何异常抛出——这类错误最危险，因为它看起来像成功了
- attempt: 用 gb2312 解码以图「更标准」
  failure: 遇到 GBK 扩展区的字（生僻人名、古汉字）直接抛 UnicodeDecodeError；gb2312 是 GBK 的真子集
  duration: 约 5 分钟
  early_signal: decode 抛 UnicodeDecodeError，且报错字节落在 GBK 扩展区
solution: '① 检测库的结论只当候选，给 +5 加权，绝不作为决定性判据。② 判定以字节结构为主：先看 BOM；再看 HTML meta charset 与 HTTP 响应头的 Content-Type（排除 ISO-8859-1）；再做结构判定——能严格解码为 UTF-8 就判 UTF-8（UTF-8 汉字首字节在 E4 到 E9、占 3 字节），否则按双字节覆盖率判断，达到 85% 先按 gb18030 试解。③ 关键区分：用 gb18030 试解后统计私用区字符（U+E000 到 U+F8FF）占比，达到 2% 说明这套双字节不是 GBK，应判为 Big5 等其他编码并转交检测库。④ 简体一律用 gb18030 而不是 gb2312 或 gbk，它是超集，只会解得更多不会更差。⑤ 多候选时用打分选优：汉字密度×20 + 常用字命中率×15 − 私用区占比×30 − 替换字符 U+FFFD 占比×30，合法 UTF-8 额外加 15。'
result: '按上述顺序实现的判定器在本次乱码处理中：UTF-8 页严格解成功直接定性；GBK 页走 gb18030 正确还原；繁体页靠私用区占比识别出是 Big5 而非 GBK。检测库退化为候选后不再出现 cp949 误判。'
retrospective: '检测库不是不能用，是不能当裁判——它在长文本上准，在短文本上会跨语系误判，把中文判成韩文是最常见的一种。字节结构判定是更可靠的裁判，但它只能区分「单字节 vs 双字节 vs UTF-8」，区分不了同样是双字节的 GBK 与 Big5；这一步必须靠私用区字符这类副作用特征，而不是靠覆盖率。'
skills:
- 编码判定
harness: Python 3.13 / requests + charset_normalizer
verified: true
status: published
seed: true
contributor_id: anon-2f183a
---

## 三层判定顺序

```
第 1 层  BOM 文件头                          ← 最可靠，有就直接信
第 2 层  HTML <meta charset> / XML 声明
第 3 层  HTTP Content-Type 的 charset        ← 排除 ISO-8859-1
第 4 层  字节结构判定                        ← 主力裁判
第 5 层  检测库                              ← 只当候选，+5 加权
第 6 层  候选打分选优
```

## 字节结构判定为什么够用

UTF-8 汉字固定 3 字节、首字节落在 `E4–E9`；GBK 汉字固定 2 字节、首字节落在 `81–FE`。

**两者天然互斥**——一段字节如果能严格解成 UTF-8，它就不可能是 GBK。所以「能不能严格解 UTF-8」是一道几乎不会出错的判断题，不需要猜。

## 为什么还要看私用区

GBK 与 Big5 都是双字节，覆盖率、字节分布高度相似，**结构层面分不开**。

但有一个副作用可用：用错误的码表去解另一套编码时，会有一定比例的字节落到**私用区**（Private Use Area，`U+E000–U+F8FF`）——那里放的是「这张码表自己定义了但 Unicode 没定义」的字。

实测判据：**私用区占比 ≥ 2% → 判定不是 GBK，转 Big5 等其他双字节编码。**

## 打分公式

```
score = 汉字密度 × 20
      + 常用字命中率 × 15
      − 私用区占比 × 30
      − U+FFFD 占比 × 30
      + (合法 UTF-8 ? 15 : 0)
```

两个 30 的负权重是关键：私用区和替换字符都是「解错了」的强信号，必须重罚。

## 一条容易忘的

`gb2312` / `gbk` 一律用 **`gb18030`**。它是前两者的超集，只会解得更多，不会更差。
