import { app, ipcMain } from 'electron'

import { readLocalDirectory } from '../local-files/local-file-browser.js'
import { requireNonEmptyString, requireRecord } from './validation.js'

// 本地目录只提供只读浏览能力，文件变更仍通过已有传输流程完成。
export function registerLocalFilesIpc(): void {
  ipcMain.handle('local-files:open-default', () => readLocalDirectory(app.getPath('home')))
  ipcMain.handle('local-files:list', (_event, input: unknown) => {
    const record = requireRecord(input, '本地目录读取参数')
    return readLocalDirectory(requireNonEmptyString(record.path, '本地路径'))
  })
}
