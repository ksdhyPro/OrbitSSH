# OrbitSSH MCP 集成

OrbitSSH 通过本地 MCP STDIO 进程向 Codex 暴露已保存连接。MCP 进程只负责协议转换，再通过本机 IPC 请求正在运行的 OrbitSSH 主进程执行命令，认证信息不会进入 MCP 返回值。

## 使用条件

1. 启动 OrbitSSH 客户端。
2. 打开“设置 → AI”。
3. 开启“允许第三方 AI 通过 MCP 访问”。该开关默认关闭。
4. 在 Codex 中注册名为 `orbitssh` 的 STDIO MCP Server，并安装 `orbitssh-mcp` Skill。安装包会把 Skill 放在应用 `resources/skills/orbitssh-mcp` 目录，可将该目录复制到 `~/.codex/skills/orbitssh-mcp`。

开发环境可以执行：

```powershell
npm run build
codex mcp add orbitssh -- node I:\OrbitSSH\dist-electron\mcp\standalone.js
```

安装版需要使用 OrbitSSH 自带的 Electron 运行时以 Node 模式启动 MCP 入口。Windows 配置示例：

```toml
[mcp_servers.orbitssh]
command = "C:\\Program Files\\OrbitSSH\\OrbitSSH.exe"
args = ["C:\\Program Files\\OrbitSSH\\resources\\app.asar\\dist-electron\\mcp\\standalone.js"]
env = { ELECTRON_RUN_AS_NODE = "1" }
```

macOS 配置示例：

```toml
[mcp_servers.orbitssh]
command = "/Applications/OrbitSSH.app/Contents/MacOS/OrbitSSH"
args = ["/Applications/OrbitSSH.app/Contents/Resources/app.asar/dist-electron/mcp/standalone.js"]
env = { ELECTRON_RUN_AS_NODE = "1" }
```

实际安装目录不同时，需要把示例路径替换为本机路径。

## 行为边界

- 客户端未运行时返回“请先打开 OrbitSSH 客户端”。
- MCP 开关关闭时，提示前往“设置 → AI”开启访问。
- 开关开启后，OrbitSSH 不应用内置 AI 命令策略、敏感数据策略或逐条审批。
- MCP 仅返回连接 ID、连接名称和命令结果，不返回密码、密码索引、私钥、私钥路径或 passphrase。
- Codex 或其他 MCP Host 仍可应用自身的工具审批和安全策略。

## MCP 工具

- `get_status`：检查客户端与 MCP 开关状态。
- `list_connections`：返回经过裁剪的连接列表。
- `execute_command`：通过指定连接执行远程 Shell 命令。
