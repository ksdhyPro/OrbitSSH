import type { RemoteFileNode } from './sftp.js'

export interface LocalDirectoryInput {
  path: string
}

export interface LocalDirectoryResult {
  currentPath: string
  parentPath?: string
  nodes: RemoteFileNode[]
}
