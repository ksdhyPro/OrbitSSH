import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('MCP STDIO 入口只暴露受控的 OrbitSSH 工具', async () => {
  const runtimeCommand = process.env.ORBITSSH_MCP_TEST_COMMAND ?? process.execPath
  const runtimeEntry = process.env.ORBITSSH_MCP_TEST_ENTRY ?? 'dist-electron/mcp/standalone.js'
  const childEnvironment = { ...process.env }
  if (process.env.ORBITSSH_MCP_TEST_COMMAND) {
    childEnvironment.ELECTRON_RUN_AS_NODE = '1'
  }
  const child = spawn(runtimeCommand, [runtimeEntry], {
    cwd: projectRoot,
    env: childEnvironment,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdoutBuffer = ''
  let stderrBuffer = ''

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => {
    stderrBuffer += chunk
  })

  try {
    const messages = []
    const tools = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`MCP STDIO 响应超时：${stderrBuffer}`))
      }, 15_000)

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        stdoutBuffer += chunk
        let newlineIndex = stdoutBuffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = stdoutBuffer.slice(0, newlineIndex).trim()
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
          if (line) messages.push(JSON.parse(line))

          const initialized = messages.find(message => message.id === 1)
          if (initialized && !messages.some(message => message.id === 2)) {
            child.stdin.write(`${JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/initialized'
            })}\n`)
            child.stdin.write(`${JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/list',
              params: {}
            })}\n`)
          }

          const toolList = messages.find(message => message.id === 2)
          if (toolList) {
            clearTimeout(timer)
            resolve(toolList.result.tools)
            return
          }
          newlineIndex = stdoutBuffer.indexOf('\n')
        }
      })
      child.once('error', reject)
      child.once('exit', code => {
        reject(new Error(`MCP STDIO 提前退出，代码 ${code}：${stderrBuffer}`))
      })
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'orbitssh-test', version: '1.0.0' }
        }
      })}\n`)
    })

    assert.deepEqual(
      tools.map(tool => tool.name).sort(),
      ['execute_command', 'get_status', 'list_connections']
    )
  } finally {
    child.stdin.end()
    child.kill()
  }
})
