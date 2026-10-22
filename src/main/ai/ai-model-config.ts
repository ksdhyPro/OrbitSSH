import type { AiModelConfig, AppSettings } from "../../shared/settings.js";

export const AI_DISABLED_MESSAGE =
  "AI 功能当前未开启。请在「设置 → AI」中切换到 AI 模式后重试。";

export const AI_MODEL_NOT_CONFIGURED_MESSAGE =
  "尚未配置可用的 AI 模型。请在「设置 → AI → 模型配置」中填写 Base URL、API Key 和模型名称后重试。";

/** 返回当前生效且字段完整的模型配置；AI 关闭或配置不完整时返回 null。 */
export function resolveActiveAiConfig(settings: AppSettings): AiModelConfig | null {
  if (!settings.ai.enabled) return null;
  const activeConfig =
    settings.ai.configs.find(config => config.id === settings.ai.activeConfigId) ??
    settings.ai.configs[0];
  if (!activeConfig) return null;

  const baseUrl = activeConfig.baseUrl.trim().replace(/\/+$/, "");
  const apiKey = activeConfig.apiKey.trim();
  const model = activeConfig.model.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { ...activeConfig, baseUrl, apiKey, model };
}

/** 模型不可用时直接告知用户原因，不生成任何本地猜测的回复或命令。 */
export function getAiUnavailableMessage(settings: AppSettings): string {
  return settings.ai.enabled ? AI_MODEL_NOT_CONFIGURED_MESSAGE : AI_DISABLED_MESSAGE;
}
