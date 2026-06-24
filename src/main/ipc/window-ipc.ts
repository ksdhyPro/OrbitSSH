import { BrowserWindow, ipcMain } from 'electron'

function getWindowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)

  if (!window) {
    throw new Error('当前窗口不存在')
  }

  return window
}

// 注册窗口控制 IPC，Renderer 不直接访问 Electron BrowserWindow。
export function registerWindowIpc(): void {
  ipcMain.handle('window:minimize', (event) => {
    getWindowFromEvent(event).minimize()
    return true
  })

  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = getWindowFromEvent(event)

    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }

    return window.isMaximized()
  })

  ipcMain.handle('window:close', (event) => {
    getWindowFromEvent(event).close()
    return true
  })

  ipcMain.handle('window:is-maximized', (event) => getWindowFromEvent(event).isMaximized())
}
