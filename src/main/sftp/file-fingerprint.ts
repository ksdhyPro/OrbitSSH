import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'

export const FILE_FINGERPRINT_MIN_SIZE_BYTES = 5 * 1024 * 1024
const FILE_FINGERPRINT_CHUNK_SIZE_BYTES = 1024 * 1024

export interface FileFingerprintMetadata {
  size: number
  modifyTime: number
}

export interface FileFingerprintHandle {
  read: (offset: number, length: number) => Promise<Buffer>
  close: () => Promise<void>
}

export interface FileFingerprintReader {
  stat: (path: string) => Promise<FileFingerprintMetadata | null>
  open: (path: string) => Promise<FileFingerprintHandle>
}

export interface FileFingerprintLocation {
  reader: FileFingerprintReader
  path: string
}

export type FileFingerprintComparisonReason =
  | 'matched'
  | 'below-threshold'
  | 'source-unavailable'
  | 'target-unavailable'
  | 'size-mismatch'
  | 'file-changed'
  | 'fingerprint-mismatch'
  | 'read-error'

export interface FileFingerprintComparisonResult {
  matched: boolean
  reason: FileFingerprintComparisonReason
  error?: string
}

function isStableSnapshot(
  before: FileFingerprintMetadata,
  after: FileFingerprintMetadata
): boolean {
  return before.size === after.size && before.modifyTime === after.modifyTime
}

async function calculateFileFingerprint(
  location: FileFingerprintLocation,
  size: number
): Promise<string> {
  const handle = await location.reader.open(location.path)
  const hash = createHash('sha256')
  let offset = 0

  try {
    while (offset < size) {
      const readLength = Math.min(FILE_FINGERPRINT_CHUNK_SIZE_BYTES, size - offset)
      const chunk = await handle.read(offset, readLength)

      if (chunk.length === 0) {
        throw new Error(`文件读取提前结束：${location.path}`)
      }

      hash.update(chunk)
      offset += chunk.length
    }

    return hash.digest('hex')
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/**
 * 仅在目标文件稳定且完整 SHA-256 一致时返回 matched，任何校验异常都由调用方降级为正常传输。
 */
export async function compareFileFingerprints(
  source: FileFingerprintLocation,
  target: FileFingerprintLocation,
  expectedSize: number
): Promise<FileFingerprintComparisonResult> {
  if (expectedSize <= FILE_FINGERPRINT_MIN_SIZE_BYTES) {
    return { matched: false, reason: 'below-threshold' }
  }

  try {
    const [sourceBefore, targetBefore] = await Promise.all([
      source.reader.stat(source.path),
      target.reader.stat(target.path)
    ])

    if (!sourceBefore || sourceBefore.size !== expectedSize) {
      return { matched: false, reason: 'source-unavailable' }
    }

    if (!targetBefore) {
      return { matched: false, reason: 'target-unavailable' }
    }

    if (targetBefore.size !== expectedSize) {
      return { matched: false, reason: 'size-mismatch' }
    }

    const [sourceFingerprint, targetFingerprint] = await Promise.all([
      calculateFileFingerprint(source, expectedSize),
      calculateFileFingerprint(target, expectedSize)
    ])
    const [sourceAfter, targetAfter] = await Promise.all([
      source.reader.stat(source.path),
      target.reader.stat(target.path)
    ])

    if (
      !sourceAfter
      || !targetAfter
      || !isStableSnapshot(sourceBefore, sourceAfter)
      || !isStableSnapshot(targetBefore, targetAfter)
    ) {
      return { matched: false, reason: 'file-changed' }
    }

    if (sourceFingerprint !== targetFingerprint) {
      return { matched: false, reason: 'fingerprint-mismatch' }
    }

    return { matched: true, reason: 'matched' }
  } catch (error) {
    return {
      matched: false,
      reason: 'read-error',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export function createLocalFileFingerprintReader(): FileFingerprintReader {
  return {
    async stat(path) {
      try {
        const metadata = await stat(path)

        if (!metadata.isFile()) {
          return null
        }

        return {
          size: metadata.size,
          modifyTime: metadata.mtimeMs
        }
      } catch {
        return null
      }
    },
    async open(path) {
      const handle = await open(path, 'r')

      return {
        async read(offset, length) {
          const buffer = Buffer.allocUnsafe(length)
          const { bytesRead } = await handle.read(buffer, 0, length, offset)

          return bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead)
        },
        close: () => handle.close()
      }
    }
  }
}
