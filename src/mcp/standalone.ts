import { startOrbitSshMcpServer } from './index.js'

// 独立入口供 Codex 以 Node/STDIO 方式启动，不创建 Electron 窗口。
startOrbitSshMcpServer()
