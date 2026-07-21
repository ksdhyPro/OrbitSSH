import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { dirname, parse, resolve } from 'node:path'
import { promisify } from 'node:util'

import type {
  LocalDirectoryResult,
  LocalRootEntry,
  LocalRootsResult
} from '../../shared/local-files.js'

const execFileAsync = promisify(execFile)

async function readWindowsDriveRoots(): Promise<LocalRootEntry[]> {
  const command = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '@(Get-PSDrive -PSProvider FileSystem | Sort-Object Name | ForEach-Object {',
    '  [pscustomobject]@{ path = $_.Root; label = if ($_.DisplayRoot) { "$($_.Name): $($_.DisplayRoot)" } else { "$($_.Name):\\" } }',
    '}) | ConvertTo-Json -Compress'
  ].join('; ')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', windowsHide: true, timeout: 5_000 }
  )
  const parsed = JSON.parse(stdout.trim() || '[]') as
    | { path?: unknown; label?: unknown }
    | Array<{ path?: unknown; label?: unknown }>
  const entries = Array.isArray(parsed) ? parsed : [parsed]

  return entries
    .filter((entry): entry is { path: string; label?: unknown } =>
      typeof entry.path === 'string' && Boolean(entry.path.trim())
    )
    .map((entry) => ({
      path: resolve(entry.path),
      label:
        typeof entry.label === 'string' && entry.label.trim()
          ? entry.label.trim()
          : entry.path,
      kind: 'drive' as const
    }))
}

export async function listLocalRoots(homePath: string): Promise<LocalRootsResult> {
  const normalizedHomePath = resolve(homePath)
  const fallbackRoot = parse(normalizedHomePath).root
  let roots: LocalRootEntry[] = []

  if (process.platform === 'win32') {
    try {
      roots = await readWindowsDriveRoots()
    } catch {
      roots = [{ path: fallbackRoot, label: fallbackRoot, kind: 'drive' }]
    }
  } else {
    roots = [{ path: fallbackRoot, label: fallbackRoot, kind: 'root' }]
  }

  const uniqueRoots = new Map<string, LocalRootEntry>()
  uniqueRoots.set(normalizedHomePath.toLowerCase(), {
    path: normalizedHomePath,
    label: `主目录 · ${normalizedHomePath}`,
    kind: 'home'
  })
  for (const root of roots) {
    uniqueRoots.set(root.path.toLowerCase(), root)
  }

  return {
    homePath: normalizedHomePath,
    roots: [...uniqueRoots.values()]
  }
}

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
