import { readdir, stat } from 'node:fs/promises'
import { dirname, parse, resolve } from 'node:path'

import type { LocalDirectoryResult } from '../../shared/local-files.js'

export async function readLocalDirectory(path: string): Promise<LocalDirectoryResult> {
  const currentPath = resolve(path)
  const currentStat = await stat(currentPath)

  if (!currentStat.isDirectory()) {
    throw new Error('本地路径不是目录')
  }

  const entries = await readdir(currentPath, { withFileTypes: true })
  const nodes = await Promise.all(entries.map(async (entry) => {
    const childPath = resolve(currentPath, entry.name)

    try {
      const childStat = await stat(childPath)

      if (!childStat.isFile() && !childStat.isDirectory()) {
        return null
      }

      return {
        path: childPath,
        name: entry.name,
        type: childStat.isDirectory() ? 'directory' as const : 'file' as const,
        size: childStat.isFile() ? childStat.size : undefined,
        modifyTime: childStat.mtimeMs
      }
    } catch {
      // 单个文件无权限或瞬时消失时跳过，避免整个目录无法展示。
      return null
    }
  }))

  const rootPath = parse(currentPath).root

  return {
    currentPath,
    parentPath: currentPath === rootPath ? undefined : dirname(currentPath),
    nodes: nodes
      .filter((node): node is NonNullable<typeof node> => node !== null)
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1
        }

        return a.name.localeCompare(b.name)
      })
  }
}
