import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FILE_FINGERPRINT_MIN_SIZE_BYTES,
  compareFileFingerprints
} from '../../dist-electron/main/sftp/file-fingerprint.js'

function createMemoryReader(files, options = {}) {
  const statCalls = new Map()

  return {
    async stat(path) {
      const file = files.get(path)

      if (!file) {
        return null
      }

      const callCount = (statCalls.get(path) ?? 0) + 1
      statCalls.set(path, callCount)

      return {
        size: file.length,
        modifyTime:
          options.changeAfterRead && callCount > 1
            ? 2
            : 1
      }
    },
    async open(path) {
      const file = files.get(path)

      if (!file || options.failRead) {
        throw new Error('模拟读取失败')
      }

      return {
        async read(offset, length) {
          return file.subarray(offset, Math.min(offset + length, file.length))
        },
        async close() {}
      }
    }
  }
}

function createLocations(sourceBuffer, targetBuffer, options = {}) {
  const sourcePath = '/source.bin'
  const targetPath = '/target.bin'
  const reader = createMemoryReader(
    new Map([
      [sourcePath, sourceBuffer],
      [targetPath, targetBuffer]
    ]),
    options
  )

  return {
    source: { reader, path: sourcePath },
    target: { reader, path: targetPath }
  }
}

test('仅严格大于 5 MiB 的文件参与指纹比较', async () => {
  const content = Buffer.alloc(FILE_FINGERPRINT_MIN_SIZE_BYTES, 1)
  const locations = createLocations(content, Buffer.from(content))
  const result = await compareFileFingerprints(
    locations.source,
    locations.target,
    content.length
  )

  assert.deepEqual(result, { matched: false, reason: 'below-threshold' })
})

test('完整 SHA-256 一致时命中，相同大小但内容不同时不命中', async () => {
  const size = FILE_FINGERPRINT_MIN_SIZE_BYTES + 1
  const sourceContent = Buffer.alloc(size, 1)
  const matchedLocations = createLocations(sourceContent, Buffer.from(sourceContent))
  const matchedResult = await compareFileFingerprints(
    matchedLocations.source,
    matchedLocations.target,
    size
  )

  assert.deepEqual(matchedResult, { matched: true, reason: 'matched' })

  const mismatchedLocations = createLocations(sourceContent, Buffer.alloc(size, 2))
  const mismatchedResult = await compareFileFingerprints(
    mismatchedLocations.source,
    mismatchedLocations.target,
    size
  )

  assert.deepEqual(mismatchedResult, {
    matched: false,
    reason: 'fingerprint-mismatch'
  })
})

test('目标缺失、大小不同、读取失败和校验期间变化均降级为不命中', async () => {
  const size = FILE_FINGERPRINT_MIN_SIZE_BYTES + 1
  const content = Buffer.alloc(size, 1)
  const missingReader = createMemoryReader(new Map([['/source.bin', content]]))
  const missingResult = await compareFileFingerprints(
    { reader: missingReader, path: '/source.bin' },
    { reader: missingReader, path: '/target.bin' },
    size
  )

  assert.equal(missingResult.reason, 'target-unavailable')

  const differentSizeLocations = createLocations(content, Buffer.alloc(size + 1, 1))
  const differentSizeResult = await compareFileFingerprints(
    differentSizeLocations.source,
    differentSizeLocations.target,
    size
  )

  assert.equal(differentSizeResult.reason, 'size-mismatch')

  const failedLocations = createLocations(content, Buffer.from(content), { failRead: true })
  const failedResult = await compareFileFingerprints(
    failedLocations.source,
    failedLocations.target,
    size
  )

  assert.equal(failedResult.reason, 'read-error')

  const changedLocations = createLocations(content, Buffer.from(content), { changeAfterRead: true })
  const changedResult = await compareFileFingerprints(
    changedLocations.source,
    changedLocations.target,
    size
  )

  assert.equal(changedResult.reason, 'file-changed')
})
