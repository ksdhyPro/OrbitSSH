import type { AiModelConfig } from "../../shared/settings.js";
import { writeAppLog } from "../logger.js";
import {
  getRememberedProtocol,
  isToolChoiceUnsupported,
  rememberProtocol,
  rememberToolChoiceUnsupported,
  type AiApiProtocol,
} from "../storage/ai-protocol-store.js";
import {
  requestAiJsonWithCompatibilityFallback,
  type AiCompatibilityFallbackParameter,
} from "./ai-provider-compatibility.js";
import { isResponsesApiUnsupported } from "./ai-responses-adapter.js";

export type { AiApiProtocol } from "../storage/ai-protocol-store.js";

/**
 * 选择并发起模型请求：GLM 直接使用 Chat Completions，其他服务优先尝试 Responses，
 * 确认不支持后记住结果；不支持的兼容参数（如 tool_choice）同样跨重启记住。
 */
export function getCompatibilityKey(config: AiModelConfig): string {
  return `${config.baseUrl}\n${config.model}`;
}

/** DeepSeek 已支持 Responses；GLM 仍直接使用 Chat，其余按已确认的探测结果选择。 */
function getPreferredProtocol(config: AiModelConfig): AiApiProtocol | undefined {
  if (config.provider === "glm") return "chat_completions";
  return getRememberedProtocol(getCompatibilityKey(config));
}

export interface PreferredApiResponse {
  response: Response;
  protocol: AiApiProtocol;
  responseText: string;
  requestBody: Record<string, unknown>;
}

export async function requestPreferredApi(
  activeConfig: AiModelConfig,
  responsesBody: Record<string, unknown>,
  chatBody: Record<string, unknown>,
  signal: AbortSignal,
  providerName: string,
  tabId: string,
): Promise<PreferredApiResponse> {
  const headers = {
    Authorization: `Bearer ${activeConfig.apiKey}`,
    "Content-Type": "application/json",
  };
  const compatibilityKey = getCompatibilityKey(activeConfig);
  if (activeConfig.provider === "deepseek") {
    // DeepSeek 默认启用思考，不支持 required；保留工具与思考能力，由本地协议校验动作。
    if (responsesBody.tool_choice === "required") responsesBody.tool_choice = "auto";
    if (chatBody.tool_choice === "required") chatBody.tool_choice = "auto";
  }
  const createCompatibilityFallbackHandler =
    (protocol: AiApiProtocol) => (parameter: AiCompatibilityFallbackParameter) => {
      if (parameter === "tool_choice") {
        // 同一接口和模型以后不再发送已确认不支持的参数，结果跨重启保留。
        rememberToolChoiceUnsupported(compatibilityKey, protocol);
      }
      writeAppLog({
        scope: "main.ai",
        level: "warn",
        message: "AI 请求参数不受支持，已回退兼容模式",
        data: {
          provider: providerName,
          model: activeConfig.model,
          tabId,
          api: protocol,
          parameter,
        },
      });
    };

  if (getPreferredProtocol(activeConfig) !== "chat_completions") {
    if (isToolChoiceUnsupported(compatibilityKey, "responses")) {
      delete responsesBody.tool_choice;
    }
    const responsesResult = await requestAiJsonWithCompatibilityFallback(
      `${activeConfig.baseUrl}/responses`,
      headers,
      responsesBody,
      signal,
      false,
      fetch,
      createCompatibilityFallbackHandler("responses"),
    );
    const { response, responseText } = responsesResult;
    if (response.ok) {
      rememberProtocol(compatibilityKey, "responses");
      return { response, protocol: "responses", responseText: "", requestBody: responsesBody };
    }

    if (!isResponsesApiUnsupported(response.status, responseText)) {
      return { response, protocol: "responses", responseText, requestBody: responsesBody };
    }
    // 确认不支持后记住结果，之后直接使用 Chat Completions，不再每次启动都探测一次。
    rememberProtocol(compatibilityKey, "chat_completions");
    writeAppLog({
      scope: "main.ai",
      level: "warn",
      message: "Responses API 不受支持，回退 Chat Completions",
      data: {
        provider: providerName,
        model: activeConfig.model,
        tabId,
        status: response.status,
      },
    });
  }

  if (isToolChoiceUnsupported(compatibilityKey, "chat_completions")) {
    delete chatBody.tool_choice;
  }
  const chatResult = await requestAiJsonWithCompatibilityFallback(
    `${activeConfig.baseUrl}/chat/completions`,
    headers,
    chatBody,
    signal,
    Boolean(chatBody.stream),
    fetch,
    createCompatibilityFallbackHandler("chat_completions"),
  );
  return {
    response: chatResult.response,
    protocol: "chat_completions",
    responseText: chatResult.responseText,
    requestBody: chatBody,
  };
}
