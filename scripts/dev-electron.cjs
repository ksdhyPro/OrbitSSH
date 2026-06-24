const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')

const electron = require('electron')

const devServerUrl = 'http://127.0.0.1:5173'

function useUtf8Console() {
  if (process.platform !== 'win32') {
    return
  }

  spawnSync('chcp.com', ['65001'], {
    stdio: 'ignore',
    env: process.env
  })
}

function runStep(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function waitForPort(port, host) {
  return new Promise((resolve) => {
    const retry = () => {
      const socket = net.createConnection({ port, host }, () => {
        socket.end()
        resolve()
      })

      socket.on('error', () => {
        setTimeout(retry, 250)
      })
    }

    retry()
  })
}

useUtf8Console()

runStep(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.electron.json'])
runStep(process.execPath, ['scripts/copy-preload.cjs'])

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
  stdio: 'inherit',
  env: process.env
})

let electronProcess

function stopChildren() {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill()
  }

  if (!vite.killed) {
    vite.kill()
  }
}

process.on('SIGINT', () => {
  stopChildren()
  process.exit(130)
})

process.on('SIGTERM', () => {
  stopChildren()
  process.exit(143)
})

vite.on('exit', (code) => {
  if (!electronProcess) {
    process.exit(code ?? 1)
  }
})

waitForPort(5173, '127.0.0.1').then(() => {
  const electronEnv = {
    ...process.env,
    VITE_DEV_SERVER_URL: devServerUrl
  }
  delete electronEnv.ELECTRON_RUN_AS_NODE

  electronProcess = spawn(electron, ['.'], {
    stdio: 'inherit',
    env: electronEnv
  })

  electronProcess.on('exit', (code) => {
    stopChildren()
    process.exit(code ?? 0)
  })
})
