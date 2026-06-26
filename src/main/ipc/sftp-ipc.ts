import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'

import {
  closeSftpSession,
  controlRemoteDownloadTask,
  controlRemoteTransferTask,
  controlRemoteUploadTask,
  deleteRemoteNode,
  downloadRemoteFile,
  listRemoteDirectory,
  openSftpSession,
  previewRemoteImageFile,
  probeRemoteTextFile,
  readRemoteTextFile,
  transferRemoteSourcesBetweenServers,
  uploadLocalPathsToRemoteDirectory,
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
  SftpRemoteTransferControlInput,
  SftpRemoteTransferInput,
  SftpUploadControlInput,
  SftpUploadInput,
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

  ipcMain.handle('sftp:upload', async (event, input: SftpUploadInput) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const sourceType = input.sourceType ?? 'file'
    const openDialogOptions: Electron.OpenDialogOptions = {
      title: sourceType === 'directory' ? '上传文件夹' : '上传文件',
      buttonLabel: '上传',
      properties:
        sourceType === 'directory'
          ? ['openDirectory', 'multiSelections', 'showHiddenFiles']
          : ['openFile', 'multiSelections', 'showHiddenFiles']
    }
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, openDialogOptions)
      : await dialog.showOpenDialog(openDialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return { uploaded: false }
    }

    const taskId = input.taskId ?? randomUUID()
    const baseEvent = {
      taskId,
      tabId: input.tabId,
      name: result.filePaths.length === 1 ? result.filePaths[0].split(/[\\/]/).at(-1) ?? '上传任务' : `${result.filePaths.length} 个项目`,
      path: input.remoteDirectoryPath,
      transferredBytes: 0,
      totalBytes: 0,
      speedBytesPerSecond: 0,
      localPaths: result.filePaths,
      remoteDirectoryPath: input.remoteDirectoryPath
    }
    event.sender.send('sftp:upload-progress', {
      ...baseEvent,
      status: 'started'
    })

    void uploadLocalPathsToRemoteDirectory(
      input.tabId,
      input.remoteDirectoryPath,
      result.filePaths,
      { taskId },
      (progressEvent) => event.sender.send('sftp:upload-progress', progressEvent)
    ).catch((error) => {
      event.sender.send('sftp:upload-progress', {
        ...baseEvent,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      })
    })

    return {
      uploaded: true,
      taskId,
      remoteDirectoryPath: input.remoteDirectoryPath,
      uploadedCount: result.filePaths.length
    }
  })

  ipcMain.handle('sftp:upload-control', (event, input: SftpUploadControlInput) =>
    controlRemoteUploadTask(input.taskId, input.action, (progressEvent) =>
      event.sender.send('sftp:upload-progress', progressEvent)
    )
  )

  ipcMain.handle('sftp:remote-transfer', async (event, input: SftpRemoteTransferInput) => {
    const taskId = input.taskId ?? randomUUID()
    const baseEvent = {
      taskId,
      sourceServerId: input.sourceServerId,
      targetServerId: input.targetServerId,
      name: input.sources.length === 1 ? input.sources[0].name : `${input.sources.length} 个项目`,
      path: input.sources[0]?.path ?? '',
      targetDirectoryPath: input.targetDirectoryPath,
      phase: 'preparing',
      transferredBytes: 0,
      totalBytes: input.sources.reduce((total, source) => total + (source.size ?? 0), 0),
      speedBytesPerSecond: 0,
      sources: input.sources
    }

    event.sender.send('sftp:remote-transfer-progress', {
      ...baseEvent,
      status: 'started'
    })

    void transferRemoteSourcesBetweenServers(
      {
        ...input,
        taskId
      },
      (progressEvent) => event.sender.send('sftp:remote-transfer-progress', progressEvent)
    ).catch((error) => {
      event.sender.send('sftp:remote-transfer-progress', {
        ...baseEvent,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      })
    })

    return { transferred: true, taskId, transferredCount: input.sources.length }
  })

  ipcMain.handle('sftp:remote-transfer-control', (event, input: SftpRemoteTransferControlInput) =>
    controlRemoteTransferTask(input.taskId, input.action, (progressEvent) =>
      event.sender.send('sftp:remote-transfer-progress', progressEvent)
    )
  )

  ipcMain.handle('sftp:delete', (_event, input: SftpDeleteInput) =>
    deleteRemoteNode(input.tabId, input.path, input.type)
  )

  ipcMain.handle('sftp:close', async (_event, tabId: string) => {
    await closeSftpSession(tabId)
    return true
  })
}
