import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  listLocalRoots,
  readLocalDirectory,
} from '../../dist-electron/main/local-files/local-file-browser.js'

test('本地位置包含主目录和可用文件系统根目录', async () => {
  const result = await listLocalRoots(tmpdir())

  assert.equal(result.homePath, tmpdir())
  assert.equal(result.roots[0].kind, 'home')
  assert.equal(result.roots[0].path, tmpdir())
  assert.ok(result.roots.some((root) => root.kind === 'drive' || root.kind === 'root'))
  assert.equal(new Set(result.roots.map((root) => root.path.toLowerCase())).size, result.roots.length)
})

test('本地目录默认按文件夹优先展示并返回父目录', async (context) => {
  const directoryPath = await mkdtemp(join(tmpdir(), 'orbitssh-local-files-'))
  context.after(() => rm(directoryPath, { recursive: true, force: true }))

  await mkdir(join(directoryPath, 'folder'))
  await writeFile(join(directoryPath, 'file.txt'), 'orbitssh', 'utf8')

  const result = await readLocalDirectory(directoryPath)

  assert.equal(result.currentPath, directoryPath)
  assert.equal(result.parentPath, dirname(directoryPath))
  assert.deepEqual(result.nodes.map((node) => [node.name, node.type]), [
    ['folder', 'directory'],
    ['file.txt', 'file'],
  ])
  assert.equal(result.nodes[1].size, 8)
})

test('本地文件路径不能作为目录读取', async (context) => {
  const directoryPath = await mkdtemp(join(tmpdir(), 'orbitssh-local-file-'))
  const filePath = join(directoryPath, 'file.txt')
  context.after(() => rm(directoryPath, { recursive: true, force: true }))
  await writeFile(filePath, 'content', 'utf8')

  await assert.rejects(() => readLocalDirectory(filePath), /本地路径不是目录/)
})
