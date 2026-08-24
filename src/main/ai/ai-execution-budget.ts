import type { AiCommandResult } from '../../shared/ai.js'
import type { ExecutedAiCommandContext } from './ai-context.js'

// 采用资源预算与进展检测控制 Agent，避免固定命令数误伤正常排障流程。
const maxAgentElapsedMs = 10 * 60 * 1000
const emergencyCommandCeiling = 80
const maxRepeatedCommandCount = 2
const maxConsecutiveNoProgressCount = 3

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ').toLowerCase()
}

function getResultFingerprint(result: AiCommandResult): string {
  return [result.exitCode, result.timedOut, result.stdout.trim(), result.stderr.trim()].join('\n')
}

function hasUsefulResult(result: AiCommandResult): boolean {
  return Boolean(result.stdout.trim() || result.stderr.trim() || result.exitCode === 0)
}

function getTrailingRepeatedCommandCount(executed: ExecutedAiCommandContext[]): number {
  const latest = executed.at(-1)
  if (!latest) return 0

  const command = normalizeCommand(latest.command)
  let count = 0
  for (let index = executed.length - 1; index >= 0; index -= 1) {
    if (normalizeCommand(executed[index]!.command) !== command) break
    count += 1
  }
  return count
}

function getTrailingNoProgressCount(executed: ExecutedAiCommandContext[]): number {
  let count = 0
  let previousFingerprint = ''
  for (let index = executed.length - 1; index >= 0; index -= 1) {
    const result = executed[index]!.result
    const fingerprint = getResultFingerprint(result)
    const noProgress = !hasUsefulResult(result) || (previousFingerprint !== '' && previousFingerprint === fingerprint)
    if (!noProgress) break
    count += 1
    previousFingerprint = fingerprint
  }
  return count
}

export function getAiExecutionStopReason(
  executed: ExecutedAiCommandContext[],
  startedAt: number
): string | null {
  if (Date.now() - startedAt >= maxAgentElapsedMs) {
    return '本轮 AI 执行已达到 10 分钟时长预算，已停止以避免长时间占用连接。'
  }

  if (executed.length >= emergencyCommandCeiling) {
    return `本轮已执行 ${emergencyCommandCeiling} 条命令，触发紧急保护阈值。`
  }

  if (getTrailingRepeatedCommandCount(executed) >= maxRepeatedCommandCount) {
    return 'AI 连续重复执行相同命令，已停止以避免无效循环。'
  }

  if (getTrailingNoProgressCount(executed) >= maxConsecutiveNoProgressCount) {
    return 'AI 连续多步未获得有效新结果，已停止并等待新的信息或方向。'
  }

  return null
}
