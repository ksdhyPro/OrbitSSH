import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'

import {
  closeSftpSession,
  controlRemoteDownloadTask,
  deleteRemoteNode,
  downloadRemoteFile,
  listRemoteDirectory,
  openSftpSession,
  previewRemoteImageFile,
  probeRemoteTextFile,
  readRemoteTextFile,
  writeRemoteTextFile
} from '../sftp/sftp-manager.js'
import type {
  SftpDeleteInput,
  SftpDownloadControlInput,
  SftpDownloadInput,
  SftpListInput,
  SftpPreviewImageInput,
  SftpProbeTextInput,
  SftpReadTextInput,
  SftpWriteTextInput
} from '../../shared/sftp.js'

// 注册 SFTP IPC，目录读取和连接信息全部留在 Main Process。
export function registerSftpIpc(): void {
  ipcMain.handle('sftp:open', (_event, tabId: string, serverId: string) => openSftpSession(tabId, serverId))

  ipcMain.handle('sftp:list', (_event, input: SftpListInput) => listRemoteDirectory(input.tabId, input.path))

  ipcMain.handle('sftp:probe-text', (_event, input: SftpProbeTextInput) =>
    probeRemoteTextFile(input.tabId, input.path, input.size)
  )

  ipcMain.handle('sftp:read-text', (_event, input: SftpReadTextInput) =>
    readRemoteTextFile(input.tabId, input.path)
  )

  ipcMain.handle('sftp:preview-image', (_event, input: SftpPreviewImageInput) =>
    previewRemoteImageFile(input.tabId, input.path, input.name, input.size)
  )

  ipcMain.handle('sftp:write-text', (_event, input: SftpWriteTextInput) =>
    writeRemoteTextFile(input.tabId, input.path, input.content)
  )

  ipcMain.handle('sftp:download', async (event, input: SftpDownloadInput) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    let filePath = input.localPath

    if (!filePath) {
      const saveDialogOptions = {
        title: '下载远程文件',
        defaultPath: input.name,
        buttonLabel: '下载'
      }
      const result = ownerWindow
        ? await dialog.showSaveDialog(ownerWindow, saveDialogOptions)
        : await dialog.showSaveDialog(saveDialogOptions)

      if (result.canceled || !result.filePath) {
        return { saved: false }
      }

      filePath = result.filePath
    }

    const taskId = input.taskId ?? randomUUID()
    const baseEvent = {
      taskId,
      tabId: input.tabId,
      name: input.name,
      path: input.path,
      transferredBytes: input.transferredBytes ?? 0,
      totalBytes: input.size ?? 0,
      speedBytesPerSecond: 0,
      filePath
    }
    event.sender.send('sftp:download-progress', {
      ...baseEvent,
      status: 'started'
    })

    // 下载任务放到后台执行，IPC 调用只负责创建任务并立即返回，避免长下载被暂停后出现 reply 未返回。
    void downloadRemoteFile(
        input.tabId,
        input.path,
        filePath,
        { taskId, name: input.name },
        input.size,
        (progressEvent) => event.sender.send('sftp:download-progress', progressEvent)
      )
      .catch((error) => {
        event.sender.send('sftp:download-progress', {
          ...baseEvent,
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        })
      })

    return { saved: true, taskId, filePath }
  })

  ipcMain.handle('sftp:download-control', (_event, input: SftpDownloadControlInput) =>
    controlRemoteDownloadTask(input.taskId, input.action, input.localPath)
  )

  ipcMain.handle('sftp:delete', (_event, input: SftpDeleteInput) =>
    deleteRemoteNode(input.tabId, input.path, input.type)
  )

  ipcMain.handle('sftp:close', async (_event, tabId: string) => {
    await closeSftpSession(tabId)
    return true
  })
}
