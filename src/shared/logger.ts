export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogPayload {
  scope: string
  message: string
  level?: LogLevel
  data?: Record<string, unknown>
}
