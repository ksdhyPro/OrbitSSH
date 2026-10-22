import type { AiModelConfig, AiProvider, AppSettings } from "../../shared/settings.js";

export const AI_DISABLED_MESSAGE = "AI 功能当前未开启。请在「设置 → AI」中切换到 AI 模式后重试。";

export const AI_MODEL_NOT_CONFIGURED_MESSAGE =
  "尚未配置可用的 AI 模型。请在「设置 → AI → 模型配置」中填写 Base URL、API Key 和模型名称后重试。";

// 只认官方接口域名及其子域名；自建代理或网关无法确认支持哪些接口，仍按 other 处理。
const knownProviderDomains: ReadonlyArray<[AiProvider, readonly string[]]> = [
  ["deepseek", ["deepseek.com"]],
  ["glm", ["bigmodel.cn", "z.ai"]],
];

/**
 * 设置界面新增的模型统一保存为 other，这里按 Base URL 识别 DeepSeek 与 GLM，
 * 让它们直接使用 Chat Completions，不必先请求一次不存在的 Responses 接口。
 */
export function inferAiProvider(baseUrl: string): AiProvider {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "other";
  }
  for (const [provider, domains] of knownProviderDomains) {
    if (domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return provider;
    }
  }
  return "other";
}

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
  const provider =
    activeConfig.provider === "other" ? inferAiProvider(baseUrl) : activeConfig.provider;
  return { ...activeConfig, provider, baseUrl, apiKey, model };
}

/** 模型不可用时直接告知用户原因，不生成任何本地猜测的回复或命令。 */
export function getAiUnavailableMessage(settings: AppSettings): string {
  return settings.ai.enabled ? AI_MODEL_NOT_CONFIGURED_MESSAGE : AI_DISABLED_MESSAGE;
}
