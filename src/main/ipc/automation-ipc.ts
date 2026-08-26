import { ipcMain } from 'electron'

import { cancelAutomationTask, runAutomationTask } from '../automation/automation-runner.js'
import { requireNonEmptyString, requireRecord } from './validation.js'

/** 自动化任务仅接受任务 ID，主进程从已保存配置读取脚本，避免 Renderer 直接传入待执行内容。 */
export function registerAutomationIpc(): void {
  ipcMain.handle('automation:run', (event, input: unknown) => {
    const record = requireRecord(input, '自动化任务参数')
    return runAutomationTask(event.sender, requireNonEmptyString(record.taskId, '自动化任务 ID'))
  })

  ipcMain.handle('automation:cancel', (event, runId: unknown) =>
    cancelAutomationTask(event.sender, requireNonEmptyString(runId, '任务运行 ID'))
  )
}
