# CheckClaude

CheckClaude 给这台机器打分：Claude 和 Claude Code 看到的画像有多自洽。出口到底在哪里、DNS
和时区是否与出口一致、浏览器指纹是否对得上，都会计入分数。插件显示总分、扣分的信号、该怎么改，
也能替你执行安全的自动修复。

评分来自 [CheckClaude](https://github.com/zzusec/CheckClaude)，与它的菜单栏 App 和命令行工具
用同一套权重。插件在 daemon 上运行那个脚本，把结果渲染在 Paseo 里，所以长会话开始前不用离开
窗口就能体检。插件内置上游的 `claude-check.sh` 和 `auto-timezone.sh`，不需要先安装 CheckClaude
App。

## 准备

插件用 bash 运行 `claude-check.sh`，所以 daemon 必须在 macOS 或 Linux 上。Windows 上界面会说明
平台不受支持。

一次体检要 20 到 60 秒，因为要并行探测多条网络路径。打开界面时先读上一次的快照，所以第一次
体检之后分数可以立刻看到。

设置项：

- **数据目录** 默认是当前平台的 CheckClaude 目录，与 App、CLI 共用一个。共用意味着出口稳定性
  信号背后 24 小时的路由历史在菜单栏 App、CLI 和这个插件之间连续。
- **脚本路径** 指向另一份 `claude-check.sh`，用来测试改过的版本。
- **超时** 用来终止卡住的运行，默认 240 秒。

## 用法

`/checkclaude` 打开界面并开始体检，`/checkclaude fix` 顺带执行可回的自动修复。侧边栏那一行显示
上一次的分数，命令中心（⌘K）有体检和修复两项，设置页有上面的选项。

浏览器类信号（WebRTC 出口、浏览器时区与语言、Client Hints、字体）只有菜单栏 App 的隐藏 WebView
能采集。命令行单跑时这些信号停在部分得分，所以在 Paseo 里体检通常比在 App 里低几分。

自动修复不使用 sudo。需要管理员权限的项目，例如安装 DNS 配置描述文件，会留作手动步骤；已经做
的改动都能在系统设置里还原。

插件只读写 CheckClaude 数据目录，并像 CLI 一样向相同端点发网络探测。除了这些探测，没有数据离开
本机，也不涉及账号或令牌。

分数只反映本机环境画像里的矛盾，不是 Anthropic 的判定，也不保证账号安全。
