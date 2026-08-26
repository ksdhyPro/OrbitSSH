/** 自动化任务在 Renderer 中展示的执行状态。 */
export type AutomationTaskRunStatus = 'confirm' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface AutomationTaskRunResult {
  runId: string
}

export interface AutomationTaskRunEvent {
  runId: string
  taskId: string
  type: 'started' | 'output' | 'completed' | 'failed' | 'cancelled'
  stream?: 'stdout' | 'stderr'
  text?: string
  exitCode?: number | null
}
