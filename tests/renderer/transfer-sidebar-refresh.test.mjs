import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const downloadsStoreUrl = new URL(
  '../../src/renderer/stores/useDownloadsStore.ts',
  import.meta.url,
)
const sftpStoreUrl = new URL(
  '../../src/renderer/stores/useSftpStore.ts',
  import.meta.url,
)
const uploadSourceUrl = new URL(
  '../../src/main/sftp/sftp-upload-transfer.ts',
  import.meta.url,
)
const sharedSftpUrl = new URL('../../src/shared/sftp.ts', import.meta.url)

test('上传完成后按服务器刷新所有正在显示目标目录的终端文件树', async () => {
  const [downloadsStore, uploadSource, sharedSftp] = await Promise.all([
    readFile(downloadsStoreUrl, 'utf8'),
    readFile(uploadSourceUrl, 'utf8'),
    readFile(sharedSftpUrl, 'utf8'),
  ])

  assert.match(sharedSftp, /serverId\?: string/)
  assert.match(uploadSource, /serverId: session\.serverId/)
  assert.match(downloadsStore, /function refreshOpenServerDirectories\(/)
  assert.match(downloadsStore, /if \(tab\.serverId === serverId\) candidateTabIds\.add\(tab\.id\)/)
  assert.match(downloadsStore, /normalizeRemoteDirectoryPath\(tree\.homePath\) !== targetPath/)
  assert.match(
    downloadsStore,
    /refreshOpenServerDirectories\(\s*event\.serverId,\s*event\.tabId,\s*event\.remoteDirectoryPath/,
  )
})

test('服务器间传输完成后刷新目标服务器当前目录且不在排队阶段提前刷新', async () => {
  const [downloadsStore, sftpStore] = await Promise.all([
    readFile(downloadsStoreUrl, 'utf8'),
    readFile(sftpStoreUrl, 'utf8'),
  ])

  assert.match(
    downloadsStore,
    /refreshOpenServerDirectories\(\s*event\.targetServerId,\s*undefined,\s*event\.targetDirectoryPath/,
  )

  const uploadFunction =
    sftpStore.match(/async function uploadToRemoteDirectory[\s\S]*?async function refreshRemoteDirectoryPath/)?.[0] ?? ''
  assert.doesNotMatch(uploadFunction, /await refreshRemoteDirectoryPath\(/)
})
