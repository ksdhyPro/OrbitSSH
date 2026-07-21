import type { ExecutedAiCommandContext } from './ai-context.js'

export function normalizeAiCommandForDedup(command: string): string {
  return command.trim().replace(/\r\n?/g, '\n')
}

export function findExecutedAiCommand(
  executedCommands: ExecutedAiCommandContext[],
  command: string
): ExecutedAiCommandContext | undefined {
  const normalizedCommand = normalizeAiCommandForDedup(command)

  for (let index = executedCommands.length - 1; index >= 0; index -= 1) {
    const executedCommand = executedCommands[index]
    if (
      executedCommand &&
      normalizeAiCommandForDedup(executedCommand.command) === normalizedCommand
    ) {
      return executedCommand
    }
  }

  return undefined
}
