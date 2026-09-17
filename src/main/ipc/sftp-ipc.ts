import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'

import {
  closeSftpSession,
  createRemoteDirectory,
  createRemoteFile,
  deleteRemoteNode,
  assertSftpSessionAccess,
  listRemoteDirectory,
  openSftpSession,
  previewRemoteImageFile,
  probeRemoteTextFile,
  readRemoteTextFile,
  renameRemoteNode,
  writeRemoteTextFile
} from '../sftp/sftp-manager.js'
import {
  controlManagedTransferTask,
  createManagedTransferBatch,
  getManagedTransferSnapshot
} from '../sftp/sftp-managed-task-manager.js'
import {
  createManagedDownloadPlan,
  createManagedRelayPlan,
  createManagedUploadPlan
} from '../sftp/sftp-managed-transfer-planner.js'
import { getSftpSession } from '../sftp/sftp-session-registry.js'
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
  SftpManagedTaskControlInput,
  SftpWriteTextInput
} from '../../shared/sftp.js'
import {
  requireEnum,
  requireNonEmptyString,
  requireOptionalFiniteNumber,
  requireOptionalString,
  requireRecord,
  requireString,
  requireStringArray
} from './validation.js'

const remoteNodeTypes = ['file', 'directory'] as const
const transferControlActions = ['pause', 'resume', 'cancel'] as const
const managedTransferControlActions = ['pause', 'resume', 'delete', 'retry'] as const
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
    type: record.type === undefined ? 'file' : requireEnum(record.type, '节点类型', remoteNodeTypes),
    size: requireOptionalFiniteNumber(record.size, '文件大小'),
    taskId: requireOptionalString(record.taskId, '任务 ID'),
    localPath: requireOptionalString(record.localPath, '本地路径'),
    localDirectoryPath: requireOptionalString(record.localDirectoryPath, '本地目录'),
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
    localPaths:
      record.localPaths === undefined
        ? undefined
        : requireStringArray(record.localPaths, '本地来源路径')
            .map(path => path.trim())
            .filter(Boolean),
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

function normalizeManagedTaskControlInput(input: unknown): SftpManagedTaskControlInput {
  const record = requireRecord(input, '传输任务控制参数')

  return {
    taskId: requireNonEmptyString(record.taskId, '任务 ID'),
    nodeIds: record.nodeIds === undefined
      ? undefined
      : requireStringArray(record.nodeIds, '任务节点 ID'),
    action: requireEnum(record.action, '控制动作', managedTransferControlActions)
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

    if (input.type === 'directory' && !input.localDirectoryPath) {
      const directoryDialogOptions = {
        title: '选择文件夹下载位置',
        defaultPath: app.getPath('desktop'),
        buttonLabel: '选择此文件夹',
        properties: ['openDirectory', 'createDirectory'] as Electron.OpenDialogOptions['properties']
      }
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, directoryDialogOptions)
        : await dialog.showOpenDialog(directoryDialogOptions)

      if (result.canceled || !result.filePaths[0]) {
        return { saved: false }
      }

      input.localDirectoryPath = result.filePaths[0]
    }

    if (!filePath && input.localDirectoryPath) {
      // 目标文件名只取 basename，避免远程名称跳出用户当前选择的本地目录。
      filePath = join(input.localDirectoryPath, basename(input.name))
    }

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
    const targetPath = input.type === 'directory'
      ? join(input.localDirectoryPath as string, basename(input.name))
      : filePath as string
    const plan = await createManagedDownloadPlan(
      input.tabId,
      input.path,
      input.name,
      input.type ?? 'file',
      targetPath,
      input.size
    )
    const sourceServerId = getSftpSession(input.tabId).serverId

    createManagedTransferBatch({
      taskId,
      direction: 'download',
      plan,
      sender: event.sender,
      sourceServerId
    })

    return { saved: true, taskId, filePath: targetPath }
  })

  ipcMain.handle('sftp:download-control', (_event, rawInput: unknown) => {
    const input = normalizeDownloadControlInput(rawInput)
    return controlManagedTransferTask({
      taskId: input.taskId,
      action: input.action === 'cancel' ? 'delete' : input.action
    })
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
    let localPaths = input.localPaths

    if (!localPaths || localPaths.length === 0) {
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, openDialogOptions)
        : await dialog.showOpenDialog(openDialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        return { uploaded: false }
      }

      localPaths = result.filePaths
    }

    const taskId = input.taskId ?? randomUUID()
    const plan = await createManagedUploadPlan(input.remoteDirectoryPath, localPaths)
    const targetServerId = getSftpSession(input.tabId).serverId

    createManagedTransferBatch({
      taskId,
      direction: 'upload',
      plan,
      sender: event.sender,
      targetServerId
    })

    return {
      uploaded: true,
      taskId,
      remoteDirectoryPath: input.remoteDirectoryPath,
      uploadedCount: plan.entries.length
    }
  })

  ipcMain.handle('sftp:upload-control', (_event, rawInput: unknown) => {
    const input = normalizeUploadControlInput(rawInput)
    return controlManagedTransferTask({
      taskId: input.taskId,
      action: input.action === 'cancel' ? 'delete' : input.action
    })
  })

  ipcMain.handle('sftp:remote-transfer', async (event, rawInput: unknown) => {
    const input = normalizeRemoteTransferInput(rawInput)
    const taskId = input.taskId ?? randomUUID()
    const plan = await createManagedRelayPlan(
      input.sourceServerId,
      input.targetServerId,
      input.sources,
      input.targetDirectoryPath
    )

    createManagedTransferBatch({
      taskId,
      direction: 'server-transfer',
      plan,
      sender: event.sender,
      sourceServerId: input.sourceServerId,
      targetServerId: input.targetServerId
    })

    return { transferred: true, taskId, transferredCount: input.sources.length }
  })

  ipcMain.handle('sftp:remote-transfer-control', (_event, rawInput: unknown) => {
    const input = normalizeRemoteTransferControlInput(rawInput)
    return controlManagedTransferTask({
      taskId: input.taskId,
      action: input.action === 'cancel' ? 'delete' : input.action
    })
  })

  ipcMain.handle('sftp:managed-task-list', () => getManagedTransferSnapshot())
  ipcMain.handle('sftp:managed-task-control', (_event, rawInput: unknown) =>
    controlManagedTransferTask(normalizeManagedTaskControlInput(rawInput)))

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
