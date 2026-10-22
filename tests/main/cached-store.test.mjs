import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { CachedStore, flushAllCachedStores } from '../../dist-electron/main/storage/cached-store.js'

async function createBacking(initial) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'orbitssh-store-'))
  const filePath = path.join(directory, 'data.json')
  await writeFile(filePath, JSON.stringify(initial, undefined, '\t'))
  let reads = 0
  const backing = {
    path: filePath,
    get store() {
      reads += 1
      return JSON.parse(readFileSync(filePath, 'utf8'))
    }
  }
  return {
    backing,
    directory,
    filePath,
    reads: () => reads,
    readFile: async () => JSON.parse(await readFile(filePath, 'utf8')),
    cleanup: () => rm(directory, { recursive: true, force: true })
  }
}

test('只在创建时读取一次文件，之后读写都走内存', async () => {
  const fixture = await createBacking({ items: [1], meta: { count: 1 } })
  try {
    const store = new CachedStore(fixture.backing)
    for (let index = 0; index < 50; index += 1) store.get('items')
    store.read('meta')
    assert.equal(fixture.reads(), 1)
  } finally {
    await fixture.cleanup()
  }
})

test('get/set 使用深拷贝，调用方修改不会污染缓存', async () => {
  const fixture = await createBacking({ items: [{ name: 'a' }] })
  try {
    const store = new CachedStore(fixture.backing)
    store.get('items')[0].name = 'changed'
    assert.equal(store.read('items')[0].name, 'a')

    const next = [{ name: 'b' }]
    store.set('items', next)
    next[0].name = 'changed-after-set'
    assert.equal(store.read('items')[0].name, 'b')
  } finally {
    await fixture.cleanup()
  }
})

test('同步模式每次修改立即写盘，格式与 electron-store 一致', async () => {
  const fixture = await createBacking({ items: [] })
  try {
    const store = new CachedStore(fixture.backing)
    store.set('items', ['x'])
    const content = await readFile(fixture.filePath, 'utf8')
    assert.equal(content, JSON.stringify({ items: ['x'] }, undefined, '\t'))
  } finally {
    await fixture.cleanup()
  }
})

test('延迟模式合并多次修改为一次异步写入，且不残留临时文件', async () => {
  const fixture = await createBacking({ items: [] })
  try {
    const store = new CachedStore(fixture.backing, { writeDelayMs: 20 })
    for (let index = 0; index < 10; index += 1) {
      store.write('items', [...store.read('items'), index])
    }
    assert.deepEqual((await fixture.readFile()).items, [])

    await store.whenIdle()
    assert.deepEqual((await fixture.readFile()).items, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    assert.deepEqual(await readdir(fixture.directory), ['data.json'])
  } finally {
    await fixture.cleanup()
  }
})

test('退出前同步落盘，异步写入中的旧快照不会覆盖更新的数据', async () => {
  const fixture = await createBacking({ value: 0 })
  try {
    const store = new CachedStore(fixture.backing, { writeDelayMs: 1_000 })
    store.write('value', 1)
    // 立即启动版本 1 的异步写入，它会停在写临时文件的 await 处。
    const pending = store.whenIdle()
    // 同一轮事件循环内写入版本 2 并同步落盘，模拟应用退出。
    store.write('value', 2)
    flushAllCachedStores()
    assert.equal((await fixture.readFile()).value, 2)
    const flushedInode = statSync(fixture.filePath).ino

    await pending
    await store.whenIdle()
    // 旧快照被丢弃而不是先覆盖再重写：退出时进程随时可能结束，文件不能短暂回退到旧版本。
    assert.equal(statSync(fixture.filePath).ino, flushedInode)
    assert.equal((await fixture.readFile()).value, 2)
    assert.deepEqual(await readdir(fixture.directory), ['data.json'])
  } finally {
    await fixture.cleanup()
  }
})

test('写盘失败时报告错误并保留未落盘状态，之后可以重试', async () => {
  const fixture = await createBacking({ value: 0 })
  const errors = []
  try {
    const store = new CachedStore(
      { ...fixture.backing, path: path.join(fixture.directory, 'missing', 'data.json'), store: { value: 0 } },
      { writeDelayMs: 1, onWriteError: error => errors.push(error) }
    )
    store.write('value', 1)
    await store.whenIdle()
    assert.equal(errors.length, 1)
    assert.throws(() => store.flushSync())
    assert.equal(errors.length, 2)
  } finally {
    await fixture.cleanup()
  }
})

test('应用正常退出和收到终止信号时都会同步落盘', async () => {
  const source = await readFile(new URL('../../src/main/index.ts', import.meta.url), 'utf8')

  assert.match(source, /app\.on\("will-quit", \(\) => \{\s*flushAllCachedStores\(\);/)
  assert.match(source, /for \(const signal of \["SIGINT", "SIGTERM", "SIGHUP"\] as const\)[\s\S]*?flushAllCachedStores\(\);[\s\S]*?app\.quit\(\);/)
})
