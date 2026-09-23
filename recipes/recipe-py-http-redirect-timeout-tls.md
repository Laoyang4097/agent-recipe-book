---
id: recipe-py-http-redirect-timeout-tls
title: requests HTTP 层真实现象：重定向拿空 body、连/读超时区分、gzip 自动解压、SSLError 与连接复用探针失效
tags:
- scrape
- timing
- session
model: Agent+Python requests
problem: requests 把很多 HTTP 细节藏了起来，导致对『重定向/超时/压缩/TLS/连接复用』的行为判断出错：以为不跟随重定向能拿到内容（实际拿到
  0 字节）、以为超时只有一种（实际连超时与读超时是两回事）、以为 Connection 头能证明连接复用（实测取不到）。
dead_ends:
- attempt: 对一个 2 跳重定向 URL 用 allow_redirects=False 抓取后，直接读 r.text 当正文使用
  failure: follow_false 返回 status=302、Location='/relative-redirect/1'、body_len=0（空
    body），拿不到任何内容；同一 URL 用 allow_redirects=True 则自动跟完 2 跳：history=[(302,'/relative-redirect/1'),(302,'/get')]，最终
    status=200、final_url=https://<镜像站>/get
  duration: follow_true/follow_false 均秒级
  early_signal: 302 + Location 头 + body 长度 0；history 长度=2
- attempt: 想用 resp.raw 取底层 socket 的本地端口，来证明 requests.Session 复用了同一 TCP 连接
  failure: 两条取值路径 resp.raw._connection.sock 和 resp.raw._fp.fp.raw._sock 均抛异常被吞，session_ports=[null,null,null]、fresh_ports=[null,null,null]，Connection
    响应头也是 null。该方式在新版 urllib3 下拿不到连接信息，连接复用『无法用这个方法观测』——不是没复用，而是探针失效
  duration: 3+3 次请求，秒级
  early_signal: local_port 全部为 None（取值路径全部失败）
- attempt: '期望用镜像站的 /brotli 端点验证 requests 对 brotli 压缩的自动解码，并显式发 Accept-Encoding: br
    试探'
  failure: '/brotli 返回 501 Not Implemented（body ''{"status_code": 501, "error": "Not
    Implemented"}''，55 字节），该镜像未实现此端点；显式 Accept-Encoding: br 请求 /get 直接 ReadTimeout（read
    timeout=10）。brotli 解码依赖本机安装 brotli 包且服务端支持，不能想当然以为和 gzip 一样自动可用'
  duration: '501 秒级；Accept-Encoding: br 请求约 10s 超时'
  early_signal: 'status=501 + body 含 ''Not Implemented''；Accept-Encoding: br 触发 ReadTimeout'
solution: '可复用步骤：① 重定向：需要正文就用 allow_redirects=True（默认），并检查 len(r.history) 与 r.url
  确认最终落点；需要拿 3xx 的 Location 做分析才用 False，且此时 body 常为 0 字节，不要拿去解析。② 超时：用元组区分连/读超时 timeout=(connect,
  read)（如 (5, 12)）；ConnectTimeout 表示连接阶段就失败（对端不可达/被墙/端口关），ReadTimeout 表示已连上但服务端迟迟不返回，二者排障方向不同。③
  压缩：requests 默认 Accept-Encoding: gzip, deflate 并自动解压，r.content 是解压后内容（实测 gzip 响应
  Content-Length=413 而 len(r.content)=771）；要 br/zstd 需额外装包且服务端支持，别假设可用。④ TLS：verify=True
  时自签名/过期证书会抛 SSLError（CERTIFICATE_VERIFY_FAILED），仅在被授权的测试环境才用 verify=False，且会伴随 InsecureRequestWarning。⑤
  连接复用：别靠 r.raw 私有属性硬取 socket，改用 urllib3 的 PoolManager 连接数统计、http.client debuglevel，或抓包来观测。'
result: 实测：/redirect/2 时 allow_redirects=True→200、history 2 跳、final=/get；allow_redirects=False→302/Location=/relative-redirect/1/body
  0 字节。/delay/5 配 timeout=1.5→ReadTimeout；不可达 IP 10.255.255.1 配 timeout=1.5→ConnectTimeout@1.51s。/gzip→Content-Encoding=gzip、Content-Length=413、len(content)=771（已自动解压）。self-signed/expired
  证书 verify=True→SSLError CERTIFICATE_VERIFY_FAILED，verify=False→200/502B。/brotli→501
  Not Implemented。连接复用探针 session_ports/fresh_ports 全 null。
retrospective: requests 的『便利』会掩盖行为真相：不跟随重定向=空 body、超时是分阶段的、br 不是白送的、raw 私有属性会随版本变。排查网络问题时要把这条链路逐段显式化（history/Location、connect
  vs read、Content-Encoding、证书校验、池化统计），并且优先用公开 API 而不是私有属性观测。
harness: Python requests
verified: true
status: published
seed: true
contributor_id: anon-2f183a
created_at: '2026-09-23'
---

## 背景与卡点

requests 把很多 HTTP 细节藏了起来，导致对『重定向/超时/压缩/TLS/连接复用』的行为判断出错：以为不跟随重定向能拿到内容（实际拿到 0 字节）、以为超时只有一种（实际连超时与读超时是两回事）、以为 Connection 头能证明连接复用（实测取不到）。

## 死胡同详解 / 解法步骤 / 复盘

详见 frontmatter 结构化字段；此处供人深读。
