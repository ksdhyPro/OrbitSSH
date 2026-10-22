# OrbitSSH MCP 集成

OrbitSSH 通过本地 MCP STDIO 进程向 Codex 暴露已保存连接。MCP 进程只负责协议转换，再通过本机 IPC 请求正在运行的 OrbitSSH 主进程执行命令，认证信息不会进入 MCP 返回值。

## 使用条件

1. 启动 OrbitSSH 客户端。
2. 打开“设置 → AI”。
3. 按需开启“允许第三方 AI 通过 MCP 使用 SSH”或“允许第三方 AI 通过 MCP 使用 SFTP”。两个开关均默认关闭。
4. 在 Codex 中注册名为 `orbitssh` 的 STDIO MCP Server，并安装 `orbitssh-mcp` Skill。安装包会把 Skill 放在应用 `resources/skills/orbitssh-mcp` 目录，可将该目录复制到 `~/.codex/skills/orbitssh-mcp`。

也可以打开“设置 → AI → 如何安装到 Agent？”，复制按本机实际安装路径生成的提示词，交给支持本地 STDIO MCP 的 AI 客户端完成注册和 Skill 安装。提示词要求客户端保留已有配置，并且不得替用户开启 OrbitSSH 的 SSH/SFTP MCP 授权开关。

开发环境可以执行：

```powershell
npm run build
codex mcp add orbitssh -- node <项目目录>/dist-electron/mcp/standalone.js
```

安装版直接通过 OrbitSSH 主程序的 MCP 模式启动，不依赖系统 Node.js。Windows 配置示例：

```toml
[mcp_servers.orbitssh]
command = "C:\\Program Files\\OrbitSSH\\OrbitSSH.exe"
args = ["--mcp-stdio"]
```

macOS 配置示例：

```toml
[mcp_servers.orbitssh]
command = "/Applications/OrbitSSH.app/Contents/MacOS/OrbitSSH"
args = ["--mcp-stdio"]
```

实际安装目录不同时，只需替换主程序路径。AI 客户端启动 MCP 进程后，所有实际 SSH/SFTP 操作仍由正在运行的 OrbitSSH 主进程处理，并实时校验“设置 → AI”中的对应开关。

## 行为边界

- 客户端未运行时返回“请先打开 OrbitSSH 客户端”。
- 对应的 SSH 或 SFTP MCP 开关关闭时，提示前往“设置 → AI”开启访问。
- SSH MCP 开启后，OrbitSSH 不应用内置 AI 命令策略、敏感数据策略或逐条审批。
- SFTP MCP 开启后，调用方可读取本地单文件并上传，也可把远程单文件写入指定本地绝对路径。传输完成后默认覆盖目标文件。
- MCP 仅返回连接摘要、命令结果和传输状态，不返回密码、密码索引、私钥、私钥路径或 passphrase。
- Codex 或其他 MCP Host 仍可应用自身的工具审批和安全策略。

## MCP 工具

- `get_status`：检查客户端与 MCP 开关状态。
- `list_connections`：返回经过裁剪的连接列表。
- `execute_command`：通过指定连接执行远程 Shell 命令。
- `upload_file`：通过指定连接把本地绝对路径的单文件上传到远程路径，立即返回任务 ID。
- `download_file`：通过指定连接把远程单文件下载到本地绝对路径，立即返回任务 ID。
- `get_transfer_status`：使用任务 ID 查询传输状态、字节进度、速度和错误。

上传和下载都会先写入目标路径旁的 `.download` 临时文件，完整传输后再覆盖正式文件。OrbitSSH 意外退出后，使用相同的本地路径和远程路径重新发起任务，会根据遗留的 `.download` 文件继续传输。
