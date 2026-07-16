// SFTP 对外门面：保持既有导出路径稳定，具体实现按职责拆分到深模块中。
export {
  assertSftpSessionAccess,
  closeAllSftpSessions,
  closeSftpSession,
  createRemoteDirectory,
  createRemoteFile,
  deleteRemoteNode,
  listRemoteDirectory,
  openSftpSession,
  previewRemoteImageFile,
  probeRemoteTextFile,
  readRemoteTextFile,
  renameRemoteNode,
  writeRemoteTextFile
} from './sftp-session.js'

export {
  controlRemoteUploadTask,
  createUploadPlan,
  uploadLocalPathsToRemoteDirectory,
  type UploadEntry,
  type UploadPlan
} from './sftp-upload-transfer.js'

export {
  controlRemoteTransferTask,
  transferRemoteSourcesBetweenServers
} from './sftp-remote-transfer.js'

export {
  controlRemoteDownloadTask,
  downloadRemoteFile
} from './sftp-download-transfer.js'

export { enqueueTransferTask } from './sftp-transfer-common.js'
