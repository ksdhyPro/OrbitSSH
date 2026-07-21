import type { ExecutedAiCommandContext } from './ai-context.js'

export function normalizeAiCommandForDedup(command: string): string {
  const normalized = command.trim().replace(/\r\n?/g, '\n')
  if (/<<-?\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/.test(normalized)) {
    return normalized
  }

  let result = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  let pendingSpace = false

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] ?? ''
    const next = normalized[index + 1] ?? ''

    if (escaped) {
      result += char
      escaped = false
      continue
    }
    if (char === '\\') {
      if (!quote && next === '\n') {
        index += 1
        pendingSpace = true
        continue
      }
      result += char
      escaped = true
      continue
    }
    if (char === "'" || char === '"') {
      if (pendingSpace && result && !result.endsWith('\n')) result += ' '
      pendingSpace = false
      quote = quote === char ? null : (quote ?? char)
      result += char
      continue
    }
    if (!quote && char === '\n') {
      result = result.trimEnd()
      if (!result.endsWith('\n')) result += '\n'
      pendingSpace = false
      continue
    }
    if (!quote && /[\t ]/.test(char)) {
      if (result.endsWith('&&') || result.endsWith('||') || result.endsWith(';')) {
        continue
      }
      pendingSpace = true
      continue
    }
    if (!quote && (char === ';' || (char === '&' && next === '&') || (char === '|' && next === '|'))) {
      result = result.trimEnd()
      result += char
      if (char !== ';') {
        result += next
        index += 1
      }
      pendingSpace = false
      continue
    }
    if (pendingSpace && result && !result.endsWith('\n')) result += ' '
    pendingSpace = false
    result += char
  }

  return result.trim()
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
