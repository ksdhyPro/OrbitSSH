import { clipboard, ipcMain } from 'electron'

// 注册剪贴板 IPC，Renderer 不直接访问 Electron clipboard，避免 sandbox preload 下能力缺失。
export function registerClipboardIpc(): void {
  ipcMain.handle('clipboard:read-text', () => clipboard.readText())
  ipcMain.handle('clipboard:read-image-data-url', () => {
    const image = clipboard.readImage()
    return image.isEmpty() ? null : image.toDataURL()
  })

  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    if (typeof text !== 'string') {
      return false
    }

    clipboard.writeText(text)
    return true
  })
}
