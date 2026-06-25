export interface RemoteFileNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  modifyTime?: number
  children?: RemoteFileNode[]
  loaded?: boolean
}

export interface SftpListInput {
  tabId: string
  path: string
}

export interface SftpDeleteInput {
  tabId: string
  path: string
  type: RemoteFileNode['type']
}

export interface SftpDownloadInput {
  tabId: string
  path: string
  name: string
  size?: number
  taskId?: string
  localPath?: string
  transferredBytes?: number
}

export interface SftpDownloadResult {
  saved: boolean
  taskId?: string
  filePath?: string
}

export interface SftpUploadInput {
  tabId: string
  remoteDirectoryPath: string
  sourceType?: 'file' | 'directory'
  taskId?: string
}

export interface SftpUploadResult {
  uploaded: boolean
  taskId?: string
  remoteDirectoryPath?: string
  uploadedCount?: number
}

export interface SftpUploadControlInput {
  taskId: string
  action: 'pause' | 'resume' | 'cancel'
}

export interface SftpDownloadProgressEvent {
  taskId: string
  tabId: string
  name: string
  path: string
  status: 'started' | 'progress' | 'paused' | 'completed' | 'canceled' | 'error'
  transferredBytes: number
  totalBytes: number
  speedBytesPerSecond: number
  filePath?: string
  error?: string
}

export interface SftpUploadProgressEvent {
  taskId: string
  tabId: string
  name: string
  path: string
  status: 'started' | 'progress' | 'paused' | 'completed' | 'canceled' | 'error'
  transferredBytes: number
  totalBytes: number
  speedBytesPerSecond: number
  localPaths: string[]
  remoteDirectoryPath: string
  error?: string
}

export interface SftpDownloadControlInput {
  taskId: string
  action: 'pause' | 'resume' | 'cancel'
  localPath?: string
}

export interface SftpProbeTextInput {
  tabId: string
  path: string
  size?: number
}

export interface SftpProbeTextResult {
  path: string
  isText: boolean
  reason: 'empty' | 'text' | 'shebang' | 'binary' | 'too-large' | 'read-error'
  sampleSize: number
}

export interface SftpReadTextInput {
  tabId: string
  path: string
}

export interface SftpReadTextResult {
  path: string
  content: string
  encoding: 'utf8'
}

export interface SftpPreviewImageInput {
  tabId: string
  path: string
  name: string
  size?: number
}

export interface SftpPreviewImageResult {
  path: string
  name: string
  mimeType: string
  dataUrl: string
}

export interface SftpWriteTextInput {
  tabId: string
  path: string
  content: string
}

export interface SftpInitResult {
  homePath: string
  nodes: RemoteFileNode[]
}
