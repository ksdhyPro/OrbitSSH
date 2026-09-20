import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** 返回主程序与独立 MCP 进程都能确定的跨平台运行时目录。 */
export function getOrbitSshMcpRuntimeDirectory(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'OrbitSSH', 'mcp')
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'OrbitSSH', 'mcp')
  }

  return path.join(
    process.env.XDG_RUNTIME_DIR ?? path.join(os.homedir(), '.config'),
    'orbitssh',
    'mcp'
  )
}

export async function ensureOrbitSshMcpRuntimeDirectory(): Promise<string> {
  const directory = getOrbitSshMcpRuntimeDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return directory
}
