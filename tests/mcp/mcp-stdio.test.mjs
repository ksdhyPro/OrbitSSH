import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

async function readMcpTools(runtimeCommand, runtimeArgs, childEnvironment = process.env) {
  const child = spawn(runtimeCommand, runtimeArgs, {
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

    return tools
  } finally {
    child.stdin.end()
    child.kill()
  }
}

function assertOrbitSshTools(tools) {
  assert.deepEqual(
    tools.map(tool => tool.name).sort(),
    [
      'download_file',
      'execute_command',
      'get_status',
      'get_transfer_status',
      'list_connections',
      'upload_file'
    ]
  )

  const uploadTool = tools.find(tool => tool.name === 'upload_file')
  const downloadTool = tools.find(tool => tool.name === 'download_file')
  const statusTool = tools.find(tool => tool.name === 'get_transfer_status')
  assert.deepEqual(uploadTool.inputSchema.required.sort(), ['connectionId', 'localPath', 'remotePath'])
  assert.deepEqual(downloadTool.inputSchema.required.sort(), ['connectionId', 'localPath', 'remotePath'])
  assert.deepEqual(statusTool.inputSchema.required, ['id'])
  assert.equal(uploadTool.annotations.destructiveHint, true)
  assert.equal(downloadTool.annotations.destructiveHint, true)
  assert.equal(statusTool.annotations.readOnlyHint, true)
}

test('MCP STDIO 入口只暴露受控的 OrbitSSH 工具', async () => {
  const tools = await readMcpTools(process.execPath, ['dist-electron/mcp/standalone.js'])
  assertOrbitSshTools(tools)
})

test('OrbitSSH 主程序可直接进入 MCP 模式且不依赖系统 Node.js', async () => {
  const packagedExecutable = process.env.ORBITSSH_MCP_TEST_APP_COMMAND
  const electronExecutable = packagedExecutable ?? (process.platform === 'win32'
    ? path.join(projectRoot, 'node_modules/electron/dist/electron.exe')
    : process.platform === 'darwin'
      ? path.join(projectRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
      : path.join(projectRoot, 'node_modules/electron/dist/electron'))
  const childEnvironment = { ...process.env }
  delete childEnvironment.ELECTRON_RUN_AS_NODE

  const tools = await readMcpTools(
    electronExecutable,
    packagedExecutable ? ['--mcp-stdio'] : [projectRoot, '--mcp-stdio'],
    childEnvironment
  )
  assertOrbitSshTools(tools)
})
