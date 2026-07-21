import type { RemoteFileNode } from './sftp.js'

export interface LocalDirectoryInput {
  path: string
}

export interface LocalDirectoryResult {
  currentPath: string
  parentPath?: string
  nodes: RemoteFileNode[]
}

export interface LocalRootEntry {
  path: string
  label: string
  kind: 'home' | 'drive' | 'root'
}

export interface LocalRootsResult {
  homePath: string
  roots: LocalRootEntry[]
}
