import { clipboard, ipcMain } from 'electron'

// 注册剪贴板 IPC，Renderer 不直接访问 Electron clipboard，避免 sandbox preload 下能力缺失。
export function registerClipboardIpc(): void {
  ipcMain.handle('clipboard:read-text', () => clipboard.readText())

  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    if (typeof text !== 'string') {
      return false
    }

    clipboard.writeText(text)
    return true
  })
}
