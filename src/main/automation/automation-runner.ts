import type { WebContents } from 'electron'
import { Client, type ClientChannel } from 'ssh2'

import type { AutomationTaskRunEvent, AutomationTaskRunResult } from '../../shared/automation.js'
import { getServerAutomationTask, getServerAuthConfig } from '../storage/server-store.js'
import { createServerConnectOptions } from '../ssh/auth-options.js'

interface RunningAutomationTask {
  taskId: string
  owner: WebContents
  client: Client
  stream?: ClientChannel
  cancelled: boolean
  finished: boolean
}

const runningTasks = new Map<string, RunningAutomationTask>()

function sendRunEvent(owner: WebContents, payload: AutomationTaskRunEvent): void {
  if (!owner.isDestroyed()) {
    owner.send('automation:run-event', payload)
  }
}

function finishRun(runId: string, payload: Omit<AutomationTaskRunEvent, 'runId' | 'taskId'>): void {
  const runningTask = runningTasks.get(runId)
  if (!runningTask || runningTask.finished) return

  runningTask.finished = true
  runningTasks.delete(runId)
  runningTask.client.end()
  sendRunEvent(runningTask.owner, { runId, taskId: runningTask.taskId, ...payload })
}

/** 使用独立 SSH 连接执行任务，避免干扰用户正在操作的交互终端。 */
export function runAutomationTask(owner: WebContents, taskId: string): AutomationTaskRunResult {
  const task = getServerAutomationTask(taskId)
  const server = getServerAuthConfig(task.serverId)
  const runId = crypto.randomUUID()
  const client = new Client()
  const runningTask: RunningAutomationTask = {
    taskId: task.id,
    owner,
    client,
    cancelled: false,
    finished: false
  }
  runningTasks.set(runId, runningTask)

  client.on('ready', () => {
    sendRunEvent(owner, { runId, taskId: task.id, type: 'started' })
    client.exec(task.script, (error, stream) => {
      if (error) {
        finishRun(runId, { type: 'failed', text: error.message })
        return
      }

      runningTask.stream = stream
      stream.on('data', (data: Buffer) => {
        sendRunEvent(owner, { runId, taskId: task.id, type: 'output', stream: 'stdout', text: data.toString('utf8') })
      })
      stream.stderr.on('data', (data: Buffer) => {
        sendRunEvent(owner, { runId, taskId: task.id, type: 'output', stream: 'stderr', text: data.toString('utf8') })
      })
      stream.on('error', (error: Error) => finishRun(runId, { type: 'failed', text: error.message }))
      stream.on('close', (code: number | undefined) => {
        if (runningTask.cancelled) {
          finishRun(runId, { type: 'cancelled' })
          return
        }
        finishRun(runId, {
          type: code === 0 ? 'completed' : 'failed',
          exitCode: typeof code === 'number' ? code : null,
          text: code === 0 ? undefined : `任务以退出码 ${String(code ?? '未知')} 结束`
        })
      })
    })
  })
  client.on('error', error => {
    if (runningTask.cancelled) {
      finishRun(runId, { type: 'cancelled' })
      return
    }
    finishRun(runId, { type: 'failed', text: error.message })
  })

  // 让 IPC 调用先返回 runId，确保 Renderer 已可按 runId 接收后续输出。
  setImmediate(() => client.connect(createServerConnectOptions(server)))
  return { runId }
}

export function cancelAutomationTask(owner: WebContents, runId: string): boolean {
  const runningTask = runningTasks.get(runId)
  if (!runningTask || runningTask.owner !== owner || runningTask.finished) return false

  runningTask.cancelled = true
  try {
    runningTask.stream?.signal('INT')
  } catch {
    // 部分 SSH 服务端不支持信号请求，仍会关闭 Channel 和连接。
  }
  runningTask.stream?.close()
  finishRun(runId, { type: 'cancelled' })
  return true
}
