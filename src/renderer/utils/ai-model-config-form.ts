import type { AiModelConfig } from "../../shared/settings";

export interface AiModelConfigForm {
  model: string;
  baseUrl: string;
  apiKey: string;
  contextTokenLimitK: number;
}

export function createEmptyAiModelConfigForm(): AiModelConfigForm {
  return { model: "", baseUrl: "", apiKey: "", contextTokenLimitK: 0 };
}

// 去掉尾部斜杠，避免拼接 /chat/completions 时生成重复路径分隔符。
export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

// 校验 baseUrl 是否为可请求的 HTTP(S) 地址。
export function isValidBaseUrl(value: string): boolean {
  if (!value || /\s/.test(value)) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// 校验新增/编辑表单，只有完整填写后才允许保存模型配置。
export function validateAiModelConfigForm(form: AiModelConfigForm): string {
  const model = form.model.trim();
  const baseUrl = normalizeBaseUrl(form.baseUrl);
  const apiKey = form.apiKey.trim();

  if (!model || /\s/.test(model) || model.length > 120) {
    return "模型名不能为空、不能包含空格，且不超过 120 个字符。";
  }
  if (!isValidBaseUrl(baseUrl)) {
    return "Base URL 必须是 http 或 https 地址，且不能包含空格。";
  }
  if (!apiKey || /\s/.test(apiKey) || apiKey.length < 8) {
    return "API Key 至少 8 位，且不能包含空格。";
  }
  if (!Number.isSafeInteger(form.contextTokenLimitK) || form.contextTokenLimitK <= 0) {
    return "上下文总 Token 限制必须是大于 0 的整数。";
  }
  return "";
}

/** 把通过校验的表单转换为保存用的模型配置。 */
export function toAiModelConfig(form: AiModelConfigForm, id: string): AiModelConfig {
  const model = form.model.trim();
  return {
    id,
    name: model,
    provider: "other",
    baseUrl: normalizeBaseUrl(form.baseUrl),
    apiKey: form.apiKey.trim(),
    model,
    contextTokenLimitK: form.contextTokenLimitK,
  };
}

export function maskApiKey(apiKey: string): string {
  const value = apiKey.trim();
  if (!value) return "-";
  if (value.length <= 8) return "*".repeat(value.length);

  return `${value.slice(0, 3)}${"*".repeat(Math.min(value.length - 6, 12))}${value.slice(-3)}`;
}
