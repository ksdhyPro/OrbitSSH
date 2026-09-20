import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { callOrbitSsh } from '../../dist-electron/mcp/orbitssh-client.js'
import {
  ORBITSSH_MCP_DESCRIPTOR_FILE,
  ORBITSSH_MCP_PROTOCOL_VERSION
} from '../../dist-electron/shared/mcp.js'

test('客户端未运行时返回明确提示', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'orbitssh-mcp-offline-'))
  try {
    await assert.rejects(
      () => callOrbitSsh(directory, 'get_status'),
      error => error?.code === 'CLIENT_NOT_RUNNING' && error?.message === '请先打开 OrbitSSH 客户端'
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('桥接客户端通过本地 IPC 转发请求且携带会话令牌', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'orbitssh-mcp-online-'))
  const suffix = randomBytes(8).toString('hex')
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\orbitssh-test-${suffix}`
    : path.join(directory, `orbitssh-${suffix}.sock`)
  const token = 'test-session-token'
  let receivedRequest

  const server = net.createServer(socket => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex === -1) return
      receivedRequest = JSON.parse(buffer.slice(0, newlineIndex))
      socket.end(`${JSON.stringify({
        requestId: receivedRequest.requestId,
        ok: true,
        result: { available: true }
      })}\n`)
    })
  })

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(endpoint, resolve)
    })
    await writeFile(
      path.join(directory, ORBITSSH_MCP_DESCRIPTOR_FILE),
      JSON.stringify({
        version: ORBITSSH_MCP_PROTOCOL_VERSION,
        endpoint,
        token,
        pid: process.pid
      }),
      'utf8'
    )

    const result = await callOrbitSsh(directory, 'get_status')
    assert.deepEqual(result, { available: true })
    assert.equal(receivedRequest.token, token)
    assert.equal(receivedRequest.method, 'get_status')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
