---
id: recipe-xhs-gitbash-sandbox-write-looks-success
title: 'Git Bash 里 clone 报成功但目录是空的：沙箱写入假象 + 中文目录名让命令参数编码错乱'
tags:
- git-bash
- windows
- shell
- environment
- isolation
model: Windows 11 + Git Bash（沙箱化 Bash 工具）
problem: 项目的一键脚本先 clone 上游依赖仓库到 tools/ 下、再打补丁。连跑两次都出问题：第一次看起来 clone 成功，
  可紧接着 ls 显示目录里什么都没有；第二次重跑时 git 报目标路径已存在，而 ls 依然说目录不存在——
  "命令说成功"和"文件真在盘上"完全脱钩。同一轮里还撞上另外两件事：把下载的临时文件写进系统 Temp 目录会被
  静默丢弃；工作区文件夹名是中文（"小红书"），会让 native git 的参数编码错乱。
dead_ends:
- attempt: 直接跑一键脚本里的 git clone，然后按退出码判断成功
  failure: 退出码为 0、stdout 也有正常进度输出，但 tools/MediaCrawler 下没有任何文件，连 .git 都没有；
    同样的命令跑第二遍时 git 坚持使用已存在的目标名，而 ls 又报不存在，两个结论互相打架
  duration: 约 10min（一次 clone 加复核）
  early_signal: 凡是"命令说成功、ls 说没有"的情况，先怀疑写操作没有真的落到磁盘，而不是先怀疑网络或分支
- attempt: 把 clone 目标从工作区挪到系统 Temp 目录下再跑一次，以为问题是权限或空间
  failure: Temp 下同样"成功"，可解压出来的文件在下一步访问时全部消失——工作区之外的写入被环境直接丢弃
  duration: 约 15min
  early_signal: 同一批文件在 bash 层和 Python 层访问结果不一致，就说明写 somewhere 之外没落盘
- attempt: 怀疑是网络或分支问题，改用带 --single-branch --depth 1 的 clone 重试
  failure: git 卡在"目标已存在"上拒绝继续，网络参数怎么调都没机会生效，问题被换了个位置原地不动
  duration: 约 5min
  early_signal: 报错里的"已存在"说的是磁盘上的残留元数据，不是仓库内容，别拿去当网络线索
solution: 换一条不依赖 clone 的取数路线：用 curl -sL 把上游仓库的 zip 包直接下载到工作区内部（下载即落盘、
  不经过 git），再 unzip -q 解压，最后 mv 成目标目录名并删掉 zip；中文路径全程用引号包住，尽量在 bash 层
  一次性完成改名。选 zip 而不是 clone 还有个附带好处：上游有没有 .git 都无所谓，中文目录名也不会再进入
  native git 的参数。取完必须验收到关键文件（例如配置文件）真的在盘上，而不是验收退出码。
result: 18,163,076 字节的 zip 落到工作区 tools/ 下，unzip 后 config/base_config.py 等文件确实存在，
  随后的依赖安装与启动都没再报文件缺失。
retrospective: 在 Windows + Git Bash + 沙箱这套组合里，"命令成功"和"文件在盘上"不是一回事。以后凡是依赖
  clone/下载产物的步骤，一律以"解压后 ls 到关键文件"作为验收点；下载目标永远落在工作区内部，别蹭系统 Temp。
skills:
- bash
- windows
- curl
harness: curl + unzip + git
hardware:
  os: Windows 11
verified: true
status: published
confidence: A
---

## 背景与卡点

详见 frontmatter 结构化字段；此处供人深读。
