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

export interface SftpWriteTextInput {
  tabId: string
  path: string
  content: string
}

export interface SftpInitResult {
  homePath: string
  nodes: RemoteFileNode[]
}
