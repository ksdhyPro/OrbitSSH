import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// 以下模块依赖 Electron（ipcMain / safeStorage），无法在纯 Node 环境加载，暂以源码契约校验。
const readSource = relativePath => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8')

test('主进程只接受显式开启的 SSH/SFTP MCP 授权', async () => {
  const source = await readSource('src/main/storage/settings-store.ts')

  assert.match(source, /allowMcpAccess:\s*value\?\.allowMcpAccess === true/)
  assert.match(source, /allowMcpSftpAccess:\s*value\?\.allowMcpSftpAccess === true/)
})

test('MCP 安装信息使用主程序入口而非系统 Node.js', async () => {
  const [setupSource, preloadSource] = await Promise.all([
    readSource('src/main/ipc/mcp-setup-ipc.ts'),
    readSource('src/preload/index.cts')
  ])

  assert.match(setupSource, /process\.execPath/)
  assert.match(setupSource, /'--mcp-stdio'/)
  assert.match(preloadSource, /mcp:get-install-info/)
})
