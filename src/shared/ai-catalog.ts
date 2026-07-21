import type { AiInputModality } from './settings.js'

export interface AiCatalogReasoningOption {
  type: 'toggle' | 'effort' | 'budget_tokens'
  values?: string[]
  min?: number
  max?: number
}

export interface AiCatalogModel {
  id: string
  name: string
  description?: string
  attachment: boolean
  reasoning: boolean
  reasoningOptions: AiCatalogReasoningOption[]
  modalities: {
    input: AiInputModality[]
    output: string[]
  }
  contextWindow?: number
  maxOutputTokens?: number
}

export interface AiCatalogProvider {
  id: string
  name: string
  api: string
  npm?: string
  doc?: string
  models: AiCatalogModel[]
}

export interface AiModelCatalog {
  source: string
  fetchedAt: number
  providers: AiCatalogProvider[]
}
