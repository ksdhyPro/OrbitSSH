import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'

import {
  closeSftpSession,
  controlRemoteDownloadTask,
  controlRemoteTransferTask,
  controlRemoteUploadTask,
  createRemoteDirectory,
  createRemoteFile,
  deleteRemoteNode,
  downloadRemoteFile,
  enqueueTransferTask,
  assertSftpSessionAccess,
  listRemoteDirectory,
  openSftpSession,
  previewRemoteImageFile,
  probeRemoteTextFile,
  readRemoteTextFile,
  renameRemoteNode,
  transferRemoteSourcesBetweenServers,
  uploadLocalPathsToRemoteDirectory,
  writeRemoteTextFile
} from '../sftp/sftp-manager.js'
import type {
  SftpCreateNodeInput,
  SftpDeleteInput,
  SftpDownloadControlInput,
  SftpDownloadInput,
  SftpListInput,
  SftpPreviewImageInput,
  SftpProbeTextInput,
  SftpReadTextInput,
  SftpRemoteTransferControlInput,
  SftpRemoteTransferInput,
  SftpRenameInput,
  SftpUploadControlInput,
  SftpUploadInput,
  SftpWriteTextInput
} from '../../shared/sftp.js'
import {
  requireEnum,
  requireNonEmptyString,
  requireOptionalFiniteNumber,
  requireOptionalString,
  requireRecord,
  requireString
} from './validation.js'

const remoteNodeTypes = ['file', 'directory'] as const
const transferControlActions = ['pause', 'resume', 'cancel'] as const
const uploadSourceTypes = ['file', 'directory'] as const

function normalizeTabPathInput(
  event: Electron.IpcMainInvokeEvent,
  input: unknown,
  label: string
): SftpListInput {
  const record = requireRecord(input, label)
  const tabId = requireNonEmptyString(record.tabId, '终端标签页 ID')
  assertSftpSessionAccess(tabId, event.sender)

  return {
    tabId,
    path: requireNonEmptyString(record.path, '远程路径')
  }
}

function normalizeCreateNodeInput(
  event: Electron.IpcMainInvokeEvent,
  input: unknown
): SftpCreateNodeInput {
  return normalizeTabPathInput(event, input, '创建节点参数')
}

function normalizeDeleteInput(
  event: Electron.IpcMainInvokeEvent,
  input: unknown
): SftpDeleteInput {
  const record = requireRecord(input, '删除节点参数')
  const tabId = requireNonEmptyString(record.tabId, '终端标签页 ID')
  assertSftpSessionAccess(tabId, event.sender)

  return {
    tabId,
    path: requireNonEmptyString(record.path, '远程路径'),
    type: requireEnum(record.type, '节点类型', remoteNodeTypes)
  }
}

function normalizeRenameInput(
  event: Electron.IpcMainInvokeEvent,
  input: unknown
): SftpRenameInput {
  const record = requireRecord(input, '重命名参数')
  const tabId = requireNonEmptyString(record.tabId, '终端标签页 ID')
  assertSftpSessionAccess(tabId, event.sender)

  return {
    tabId,
    path: requireNonEmptyString(record.path, '原路径'),
    newPath: requireNonEmptyString(record.newPath, '新路径')
  }
}

function normalizeDownloadInput(
  event: Electron.IpcMainInvokeEvent,
  input: unknown
): SftpDownloadInput {
  const record = requireRecord(input, '下载参数')
  const tabId = requireNonEmptyString(record.tabId, '终端标签页 ID')
  assertSftpSessionAccess(tabId, event.sender)

  return {
    tabId,
    path: requireNonEmptyString(record.path, '远程路径'),
    name: requireNonEmptyString(record.name, '文件名'),
    size: requireOptionalFiniteNumber(record.size, '文件大小'),
    taskId: requireOptionalString(record.taskId, '任务 ID'),
    localPath: requireOptionalString(record.localPath, '本地路径'),
    transferredBytes: requireOptionalFiniteNumber(record.transferredBytes, '已传输字节数')
  }
}

function normalizeUploadInput(
  event: Electron.IpcMainInvokeEvent,
  input: unknown
): SftpUploadInput {
  const record = requireRecord(input, '上传参数')
  const tabId = requireNonEmptyString(record.tabId, '终端标签页 ID')
  assertSftpSessionAccess(tabId, event.sender)

  return {
    tabId,
    remoteDirectoryPath: requireNonEmptyString(record.remoteDirectoryPath, '远程目录'),
    sourceType:
      record.sourceType === undefined
        ? undefined
        : requireEnum(record.sourceType, '上传来源类型', uploadSourceTypes),
    taskId: requireOptionalString(record.taskId, '任务 ID')
  }
}

function normalizeDownloadControlInput(input: unknown): SftpDownloadControlInput {
  const record = requireRecord(input, '下载控制参数')

  return {
    taskId: requireNonEmptyString(record.taskId, '任务 ID'),
    action: requireEnum(record.action, '控制动作', transferControlActions),
    localPath: requireOptionalString(record.localPath, '本地路径')
  }
}

function normalizeUploadControlInput(input: unknown): SftpUploadControlInput {
  const record = requireRecord(input, '上传控制参数')

  return {
    taskId: requireNonEmptyString(record.taskId, '任务 ID'),
    action: requireEnum(record.action, '控制动作', transferControlActions)
  }
}

function normalizeRemoteTransferInput(input: unknown): SftpRemoteTransferInput {
  const record = requireRecord(input, '服务器间传输参数')
  const rawSources = record.sources

  if (!Array.isArray(rawSources)) {
    throw new Error('传输来源必须是数组')
  }

  const sources = rawSources.map((source, index) => {
    const item = requireRecord(source, `传输来源 ${index + 1}`)

    return {
      path: requireNonEmptyString(item.path, '来源路径'),
      name: requireNonEmptyString(item.name, '来源名称'),
      type: requireEnum(item.type, '来源类型', remoteNodeTypes),
      size: requireOptionalFiniteNumber(item.size, '来源大小')
    }
  })

  return {
    sourceServerId: requireNonEmptyString(record.sourceServerId, '来源服务器 ID'),
    targetServerId: requireNonEmptyString(record.targetServerId, '目标服务器 ID'),
    sources,
    targetDirectoryPath: requireNonEmptyString(record.targetDirectoryPath, '目标目录'),
    taskId: requireOptionalString(record.taskId, '任务 ID')
  }
}

function normalizeRemoteTransferControlInput(input: unknown): SftpRemoteTransferControlInput {
  const record = requireRecord(input, '服务器间传输控制参数')

  return {
    taskId: requireNonEmptyString(record.taskId, '任务 ID'),
    action: requireEnum(record.action, '控制动作', transferControlActions)
  }
}

function normalizeProbeTextInput(
  event: Electron.IpcMainInvokeEvent,
  input: unknown
): SftpProbeTextInput {
  const base = normalizeTabPathInput(event, input, '文本探测参数')
  const record = requireRecord(input, '文本探测参数')

  return {
    ...base,
    size: requireOptionalFiniteNumber(record.size, '文件大小')
  }
}

function normalizePreviewImageInput(
  event: Electron.IpcMainInvokeEvent,
  input: unknown
): SftpPreviewImageInput {
  const record = requireRecord(input, '图片预览参数')
  const tabId = requireNonEmptyString(record.tabId, '终端标签页 ID')
  assertSftpSessionAccess(tabId, event.sender)

  return {
    tabId,
    path: requireNonEmptyString(record.path, '远程路径'),
    name: requireNonEmptyString(record.name, '文件名'),
    size: requireOptionalFiniteNumber(record.size, '文件大小')
  }
}

function normalizeWriteTextInput(
  event: Electron.IpcMainInvokeEvent,
  input: unknown
): SftpWriteTextInput {
  const record = requireRecord(input, '写入文本参数')
  const tabId = requireNonEmptyString(record.tabId, '终端标签页 ID')
  assertSftpSessionAccess(tabId, event.sender)

  return {
    tabId,
    path: requireNonEmptyString(record.path, '远程路径'),
    content: requireString(record.content, '文件内容')
  }
}

// 注册 SFTP IPC，目录读取和连接信息全部留在 Main Process。
export function registerSftpIpc(): void {
  ipcMain.handle('sftp:open', (event, tabId: unknown, serverId: unknown) => {
    const normalizedTabId = requireNonEmptyString(tabId, '终端标签页 ID')
    assertSftpSessionAccess(normalizedTabId, event.sender, { allowMissing: true })
    return openSftpSession(
      normalizedTabId,
      requireNonEmptyString(serverId, '服务器 ID'),
      event.sender
    )
  })

  ipcMain.handle('sftp:list', (event, input: unknown) => {
    const normalizedInput = normalizeTabPathInput(event, input, '目录读取参数')
    return listRemoteDirectory(normalizedInput.tabId, normalizedInput.path)
  })

  ipcMain.handle('sftp:probe-text', (event, input: unknown) => {
    const normalizedInput = normalizeProbeTextInput(event, input)
    return probeRemoteTextFile(normalizedInput.tabId, normalizedInput.path, normalizedInput.size)
  })

  ipcMain.handle('sftp:read-text', (event, input: unknown) => {
    const normalizedInput = normalizeTabPathInput(event, input, '文本读取参数') satisfies SftpReadTextInput
    return readRemoteTextFile(normalizedInput.tabId, normalizedInput.path)
  })

  ipcMain.handle('sftp:preview-image', (event, input: unknown) => {
    const normalizedInput = normalizePreviewImageInput(event, input)
    return previewRemoteImageFile(normalizedInput.tabId, normalizedInput.path, normalizedInput.name, normalizedInput.size)
  })

  ipcMain.handle('sftp:write-text', (event, input: unknown) => {
    const normalizedInput = normalizeWriteTextInput(event, input)
    return writeRemoteTextFile(normalizedInput.tabId, normalizedInput.path, normalizedInput.content)
  })

  ipcMain.handle('sftp:download', async (event, rawInput: unknown) => {
    const input = normalizeDownloadInput(event, rawInput)
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
      status: 'queued'
    })

    // 下载任务放到后台执行，IPC 调用只负责创建任务并立即返回，避免长下载被暂停后出现 reply 未返回。
    void enqueueTransferTask(taskId, () => downloadRemoteFile(
        input.tabId,
        input.path,
        filePath,
        { taskId, name: input.name },
        input.size,
        (progressEvent) => event.sender.send('sftp:download-progress', progressEvent)
      ))
      .catch((error) => {
        event.sender.send('sftp:download-progress', {
          ...baseEvent,
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        })
      })

    return { saved: true, taskId, filePath }
  })

  ipcMain.handle('sftp:download-control', (_event, rawInput: unknown) => {
    const input = normalizeDownloadControlInput(rawInput)
    return controlRemoteDownloadTask(input.taskId, input.action, input.localPath)
  })

  ipcMain.handle('sftp:upload', async (event, rawInput: unknown) => {
    const input = normalizeUploadInput(event, rawInput)
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
      status: 'queued'
    })

    void enqueueTransferTask(taskId, () => uploadLocalPathsToRemoteDirectory(
      input.tabId,
      input.remoteDirectoryPath,
      result.filePaths,
      { taskId },
      (progressEvent) => event.sender.send('sftp:upload-progress', progressEvent)
    )).catch((error) => {
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

  ipcMain.handle('sftp:upload-control', (event, rawInput: unknown) => {
    const input = normalizeUploadControlInput(rawInput)
    return controlRemoteUploadTask(input.taskId, input.action, (progressEvent) =>
      event.sender.send('sftp:upload-progress', progressEvent)
    )
  })

  ipcMain.handle('sftp:remote-transfer', async (event, rawInput: unknown) => {
    const input = normalizeRemoteTransferInput(rawInput)
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
      status: 'queued'
    })

    void enqueueTransferTask(taskId, () => transferRemoteSourcesBetweenServers(
      {
        ...input,
        taskId
      },
      (progressEvent) => event.sender.send('sftp:remote-transfer-progress', progressEvent)
    )).catch((error) => {
      event.sender.send('sftp:remote-transfer-progress', {
        ...baseEvent,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      })
    })

    return { transferred: true, taskId, transferredCount: input.sources.length }
  })

  ipcMain.handle('sftp:remote-transfer-control', (event, rawInput: unknown) => {
    const input = normalizeRemoteTransferControlInput(rawInput)
    return controlRemoteTransferTask(input.taskId, input.action, (progressEvent) =>
      event.sender.send('sftp:remote-transfer-progress', progressEvent)
    )
  })

  ipcMain.handle('sftp:delete', (event, rawInput: unknown) => {
    const input = normalizeDeleteInput(event, rawInput)
    return deleteRemoteNode(input.tabId, input.path, input.type)
  })

  ipcMain.handle('sftp:rename', (event, rawInput: unknown) => {
    const input = normalizeRenameInput(event, rawInput)
    return renameRemoteNode(input.tabId, input.path, input.newPath)
  })

  ipcMain.handle('sftp:create-file', (event, rawInput: unknown) => {
    const input = normalizeCreateNodeInput(event, rawInput)
    return createRemoteFile(input.tabId, input.path)
  })

  ipcMain.handle('sftp:create-directory', (event, rawInput: unknown) => {
    const input = normalizeCreateNodeInput(event, rawInput)
    return createRemoteDirectory(input.tabId, input.path)
  })

  ipcMain.handle('sftp:close', async (event, tabId: unknown) => {
    const normalizedTabId = requireNonEmptyString(tabId, '终端标签页 ID')
    assertSftpSessionAccess(normalizedTabId, event.sender, { allowMissing: true })
    await closeSftpSession(normalizedTabId)
    return true
  })
}
