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

export interface SftpInitResult {
  homePath: string
  nodes: RemoteFileNode[]
}
