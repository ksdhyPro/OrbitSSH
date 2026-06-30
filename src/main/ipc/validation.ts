import type { IpcMainInvokeEvent } from 'electron'

import { assertTerminalSessionAccess } from '../ssh/session-manager.js'

type UnknownRecord = Record<string, unknown>

export function requireRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`)
  }

  return value as UnknownRecord
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是字符串`)
  }

  return value
}

export function requireNonEmptyString(value: unknown, label: string): string {
  const text = requireString(value, label).trim()

  if (!text) {
    throw new Error(`${label} 不能为空`)
  }

  return text
}

export function requireOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  return requireString(value, label)
}

export function requireFiniteNumber(value: unknown, label: string): number {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    throw new Error(`${label} 必须是有效数字`)
  }

  return numericValue
}

export function requireOptionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  return requireFiniteNumber(value, label)
}

export function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${label} 必须是字符串数组`)
  }

  return value
}

export function requireEnum<T extends string>(
  value: unknown,
  label: string,
  allowedValues: readonly T[]
): T {
  if (typeof value !== 'string' || !allowedValues.includes(value as T)) {
    throw new Error(`${label} 不在允许范围内`)
  }

  return value as T
}

export function assertTabAccess(
  event: IpcMainInvokeEvent,
  tabId: string,
  options: { allowMissing?: boolean } = {}
): void {
  assertTerminalSessionAccess(tabId, event.sender, options)
}

