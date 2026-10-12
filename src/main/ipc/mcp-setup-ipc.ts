import { app, ipcMain } from 'electron'
import path from 'node:path'

import type { OrbitSshMcpInstallInfo } from '../../shared/mcp.js'

function getMcpInstallInfo(): OrbitSshMcpInstallInfo {
  const appPath = app.getAppPath()

  return {
    name: 'orbitssh',
    transport: 'stdio',
    command: process.execPath,
    // 开发环境需先指定 Electron 应用目录；安装版可直接使用主程序参数。
    args: app.isPackaged ? ['--mcp-stdio'] : [appPath, '--mcp-stdio'],
    skillDirectory: app.isPackaged
      ? path.join(process.resourcesPath, 'skills', 'orbitssh-mcp')
      : path.join(appPath, '.agents', 'skills', 'orbitssh-mcp')
  }
}

export function registerMcpSetupIpc(): void {
  ipcMain.handle('mcp:get-install-info', () => getMcpInstallInfo())
}
