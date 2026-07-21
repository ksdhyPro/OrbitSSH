import type { AiChatInput } from "../../shared/ai.js";
import type {
  AiModelConfig,
  AppSettings,
} from "../../shared/settings.js";
import { resolveAiConfigForAttachments } from "../../shared/ai-model-capabilities.js";

export function getActiveAiConfig(
  settings: AppSettings,
  input: AiChatInput,
): AiModelConfig | null {
  const inlineAttachments = (input.attachments ?? []).filter(
    attachment => attachment.delivery !== "chunked",
  );
  const activeConfig = resolveAiConfigForAttachments(
    settings.ai.configs,
    settings.ai.activeConfigId,
    settings.ai.multimodalConfigId,
    inlineAttachments,
  );

  if (
    !settings.ai.enabled ||
    !activeConfig ||
    !activeConfig.baseUrl.trim() ||
    !activeConfig.apiKey.trim() ||
    !activeConfig.model.trim()
  ) {
    return null;
  }
  return {
    ...activeConfig,
    baseUrl: activeConfig.baseUrl.trim().replace(/\/+$/, ""),
    apiKey: activeConfig.apiKey.trim(),
    model: activeConfig.model.trim(),
  };
}
