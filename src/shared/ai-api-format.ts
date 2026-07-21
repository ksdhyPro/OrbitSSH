import type { AiCatalogReasoningOption } from './ai-catalog.js'
import type { AiApiSpec } from './settings.js'

export const aiApiSpecLabels: Record<AiApiSpec, string> = {
  openai: 'OpenAI Chat Completions',
  anthropic: 'Anthropic（AC）Messages',
  responses: 'OpenAI Responses'
}

export function inferAiApiSpecFromProvider(
  providerId: string,
  npmPackage = ''
): AiApiSpec {
  const normalizedNpm = npmPackage.toLowerCase()
  if (normalizedNpm.includes('anthropic') || providerId === 'anthropic') {
    return 'anthropic'
  }
  if (normalizedNpm === '@ai-sdk/openai' || providerId === 'openai') {
    return 'responses'
  }
  return 'openai'
}

export interface AiReasoningDefaults {
  enabled: boolean
  parameter: string
  effort: string
  options: string[]
}

function buildBudgetOptions(
  option: AiCatalogReasoningOption,
  maxOutputTokens: number
): string[] {
  const minimum = Math.max(1_024, Math.floor(option.min ?? 1_024))
  const maximum = Math.max(
    minimum,
    Math.floor(Math.min(option.max ?? maxOutputTokens, maxOutputTokens))
  )
  return Array.from(new Set([
    minimum,
    2_048,
    4_096,
    8_192,
    16_384,
    32_768
  ]))
    .filter(value => value >= minimum && value <= maximum)
    .map(String)
}

export function getAiReasoningDefaults(
  spec: AiApiSpec,
  reasoningOptions: AiCatalogReasoningOption[] = [],
  reasoningSupported = false,
  maxOutputTokens = 8_192
): AiReasoningDefaults {
  const effortOption = reasoningOptions.find(option => option.type === 'effort')
  const budgetOption = reasoningOptions.find(option => option.type === 'budget_tokens')
  const toggleOption = reasoningOptions.find(option => option.type === 'toggle')
  const enabled = reasoningSupported || reasoningOptions.length > 0

  if (effortOption || (enabled && !budgetOption && !toggleOption)) {
    const options = effortOption?.values?.length
      ? Array.from(new Set(effortOption.values.map(value => value.trim()).filter(Boolean)))
      : ['low', 'medium', 'high']
    return {
      enabled,
      parameter:
        spec === 'responses'
          ? 'reasoning.effort'
          : spec === 'anthropic'
            ? 'output_config.effort'
            : 'reasoning_effort',
      effort: options.includes('medium') ? 'medium' : options[0] ?? 'medium',
      options
    }
  }

  if (budgetOption) {
    const options = buildBudgetOptions(budgetOption, maxOutputTokens)
    return {
      enabled,
      parameter: 'thinking.budget_tokens',
      effort: options.includes('4096') ? '4096' : options[0] ?? '1024',
      options
    }
  }

  if (toggleOption) {
    if (spec === 'responses') {
      return {
        enabled,
        parameter: 'reasoning.effort',
        effort: 'medium',
        options: ['low', 'medium', 'high']
      }
    }
    const effort = spec === 'anthropic' ? 'adaptive' : 'enabled'
    return {
      enabled,
      parameter: 'thinking.type',
      effort,
      options: [effort]
    }
  }

  return { enabled: false, parameter: '', effort: '', options: [] }
}
