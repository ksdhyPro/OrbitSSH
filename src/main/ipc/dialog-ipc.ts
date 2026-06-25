import { BrowserWindow, dialog, ipcMain } from 'electron'

function getWindowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)

  if (!window) {
    throw new Error('当前窗口不存在')
  }

  return window
}

// 注册文件选择 IPC，Renderer 只接收用户选择后的路径，不直接访问 Electron dialog。
export function registerDialogIpc(): void {
  ipcMain.handle('dialog:select-private-key', async (event) => {
    const result = await dialog.showOpenDialog(getWindowFromEvent(event), {
      title: '选择 SSH 密钥文件',
      properties: ['openFile', 'showHiddenFiles'],
      filters: [{ name: '所有文件', extensions: ['*'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })
}
