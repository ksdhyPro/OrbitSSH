<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  PhCommand,
  PhSlidersHorizontal,
  PhSparkle,
} from "@phosphor-icons/vue";
import {
  DEFAULT_AI_MAX_ATTACHMENT_SIZE_MB,
  MAX_AI_ATTACHMENT_SIZE_MB,
} from "../../shared/ai";
import type { AiCatalogModel, AiCatalogProvider, AiModelCatalog } from "../../shared/ai-catalog";
import {
  DEFAULT_AI_MAX_OUTPUT_TOKENS,
  DEFAULT_CUSTOM_AI_CONTEXT_WINDOW,
  type AiApiSpec,
  type AiInputModality,
  type AiModelConfig,
  type AiSettings,
  type AppSettings,
  type AppThemeMode,
} from "../../shared/settings";
import {
  normalizeAiReasoningEffort,
  normalizeAiReasoningParameter,
  normalizeAiReasoningValues,
} from "../../shared/ai-reasoning";
import {
  aiApiSpecLabels,
  getAiReasoningDefaults,
  inferAiApiSpecFromProvider,
} from "../../shared/ai-api-format";
import { getShortcutSections } from "../config/shortcuts";
import AppDialog from "./AppDialog.vue";
import NumberStepper from "./NumberStepper.vue";
import { useCoreStore } from "../stores/useCoreStore";
import editIcon from "../assets/icons/edit.svg";
import plusIcon from "../assets/icons/plus.svg";
import trashIcon from "../assets/icons/trash.svg";

const props = defineProps<{
  open: boolean;
  appSettings: AppSettings;
  activeSettingsSection: "general" | "ai" | "shortcuts";
  isMac: boolean;
  isSelectionBackgroundDropdownOpen: boolean;
  selectionBackgroundOptions: string[];
}>();

const emit = defineEmits<{
  close: [];
  updateActiveSection: [section: "general" | "ai" | "shortcuts"];
  updateSelectionDropdownOpen: [open: boolean];
  stepTerminalNumberSetting: [key: "fontSize" | "lineHeight", delta: number];
  updateKeepaliveIntervalSeconds: [value: number];
  updateIdleDisconnectMinutes: [value: number];
  updateOpenLocalTerminalOnStartup: [value: boolean];
  updateAiSetting: [key: keyof AiSettings, value: AiSettings[keyof AiSettings]];
  updateAiSettings: [
    value: AiSettings,
    onComplete?: (saved: boolean) => void,
  ];
  updateThemeMode: [mode: AppThemeMode];
  selectSelectionBackground: [color: string];
}>();

const shortcutSections = computed(() => getShortcutSections(props.isMac));
const core = useCoreStore();

const aiModeOptions: AiSettings["defaultMode"][] = ["ask", "full"];

const aiModeLabels: Record<AiSettings["defaultMode"], string> = {
  ask: "每次询问",
  full: "完全访问",
};

const aiConfigDraft = ref<AiModelConfig[]>([]);
const selectedAiProviderConfigId = ref("");
// 模型列表弹窗
const isAiConfigDialogOpen = ref(false);
// 新增/编辑表单子弹窗（与列表弹窗分离，避免常驻表单撑高弹窗）
const isAiConfigFormDialogOpen = ref(false);
const isAiConfigFormValidationVisible = ref(false);
const editingAiConfigId = ref<string | null>(null);
const aiConfigMessage = ref("");
const aiCatalog = ref<AiModelCatalog | null>(null);
const isAiCatalogLoading = ref(false);
const aiCatalogError = ref("");
const aiCatalogMatchMessage = ref("");
const aiConfigInitialModelId = ref("");
const isAiConfigSaving = ref(false);
let aiCatalogLoadPromise: Promise<void> | null = null;
let aiModelAutoFillTimer: number | undefined;
const isCreatingAiProvider = ref(false);
const isAiProviderFormDialogOpen = ref(false);
const editingAiProviderConfigIds = ref<string[]>([]);
const aiProviderFormMessage = ref("");
const aiProviderForm = ref({
  providerId: "custom",
  providerName: "自定义厂商",
  baseUrl: "",
  apiKey: "",
});
const aiConfigForm = ref({
  providerId: "custom",
  providerName: "自定义厂商",
  spec: "openai" as AiApiSpec,
  model: "",
  baseUrl: "",
  apiKey: "",
  contextWindow: DEFAULT_CUSTOM_AI_CONTEXT_WINDOW,
  maxOutputTokens: DEFAULT_AI_MAX_OUTPUT_TOKENS,
  reasoningEnabled: false,
  reasoningParameter: "reasoning_effort",
  reasoningEffort: "medium",
  reasoningEffortOptions: ["low", "medium", "high"],
  inputModalities: ["text"] as AiInputModality[],
  supportsAttachments: false,
});

const catalogProviders = computed(() => aiCatalog.value?.providers ?? []);
const selectedCatalogProvider = computed<AiCatalogProvider | null>(() =>
  catalogProviders.value.find(item => item.id === aiConfigForm.value.providerId) ?? null,
);
const catalogModels = computed<AiCatalogModel[]>(() =>
  selectedCatalogProvider.value?.models ?? [],
);
const reasoningEffortOptions = computed(() => {
  return Array.from(new Set([
    ...aiConfigForm.value.reasoningEffortOptions,
    aiConfigForm.value.reasoningEffort.trim(),
  ].filter(Boolean)));
});
const reasoningEffortOptionsText = computed({
  get: () => aiConfigForm.value.reasoningEffortOptions.join(", "),
  set: (value: string) => {
    aiConfigForm.value.reasoningEffortOptions = normalizeAiReasoningValues(
      value.split(/[,，\n]/),
    );
  },
});

type AiProviderGroup = {
  id: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  configs: AiModelConfig[];
};

function getAiProviderIdentity(config: AiModelConfig): string {
  return JSON.stringify([
    config.provider,
    config.providerName,
    config.baseUrl,
    config.apiKey,
  ]);
}

function groupAiConfigs(configs: AiModelConfig[]): AiProviderGroup[] {
  const groups = new Map<string, AiProviderGroup>();

  for (const config of configs) {
    const identity = getAiProviderIdentity(config);
    const existing = groups.get(identity);
    if (existing) {
      existing.configs.push(config);
      continue;
    }

    groups.set(identity, {
      id: config.id,
      providerId: config.provider,
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      configs: [config],
    });
  }

  return [...groups.values()];
}

const aiProviderGroups = computed(() => groupAiConfigs(aiConfigDraft.value));
const selectedAiProviderGroup = computed(() =>
  aiProviderGroups.value.find(group =>
    group.configs.some(config => config.id === selectedAiProviderConfigId.value),
  ) ?? aiProviderGroups.value[0] ?? null,
);
const selectedProviderCatalog = computed<AiCatalogProvider | null>(() =>
  catalogProviders.value.find(item => item.id === aiProviderForm.value.providerId) ?? null,
);
const multimodalAiConfigs = computed(() =>
  props.appSettings.ai.configs.filter(config => config.supportsAttachments),
);

const activeAiConfig = computed(() =>
  props.appSettings.ai.configs.find(
    config => config.id === props.appSettings.ai.activeConfigId,
  ),
);

const aiConfigSummary = computed(() => {
  const count = props.appSettings.ai.configs.length;
  if (count === 0) {
    return "未配置模型";
  }

  const providerCount = groupAiConfigs(props.appSettings.ai.configs).length;
  return activeAiConfig.value
    ? `${activeAiConfig.value.model} · ${providerCount} 个供应商 / ${count} 个模型`
    : `${providerCount} 个供应商 / ${count} 个模型，未选择当前模型`;
});

const isEditingAiConfig = computed(() => Boolean(editingAiConfigId.value));

const aiConfigFormDialogTitle = computed(() =>
  isEditingAiConfig.value
    ? "编辑模型"
    : isCreatingAiProvider.value
      ? "新增供应商"
      : "添加模型",
);

const aiConfigFormError = computed(() =>
  validateAiConfigForm(
    aiConfigForm.value.model,
    aiConfigForm.value.baseUrl,
    aiConfigForm.value.apiKey,
    aiConfigForm.value.contextWindow,
    aiConfigForm.value.maxOutputTokens,
    aiConfigForm.value.reasoningEnabled,
    aiConfigForm.value.reasoningParameter,
    aiConfigForm.value.reasoningEffort,
  ),
);

watch(
  () => props.open,
  open => {
    if (open) {
      resetAiConfigDraft();
    }
  },
  { immediate: true },
);

// 复制配置草稿，避免用户输入未完成时直接写入全局设置。
function cloneAiConfigs(configs: AiModelConfig[]): AiModelConfig[] {
  return configs.map(config => ({
    ...config,
    inputModalities: [...config.inputModalities],
    reasoningEffortOptions: [...config.reasoningEffortOptions],
  }));
}

// 打开设置页时从当前设置同步一份可编辑草稿。
function resetAiConfigDraft(): void {
  aiConfigDraft.value = cloneAiConfigs(props.appSettings.ai.configs);
  selectedAiProviderConfigId.value =
    props.appSettings.ai.activeConfigId || aiConfigDraft.value[0]?.id || "";
  resetAiConfigForm();
  resetAiProviderForm();
  aiConfigMessage.value = "";
}

// 去掉尾部斜杠，避免拼接 /chat/completions 时生成重复路径分隔符。
function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

// 校验 baseUrl 是否为可请求的 HTTP(S) 地址。
function isValidBaseUrl(value: string): boolean {
  if (!value || /\s/.test(value)) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// 校验新增/编辑表单，只有完整填写后才允许保存模型配置。
function validateAiConfigForm(
  model: string,
  baseUrl: string,
  apiKey: string,
  contextWindow: number,
  maxOutputTokens: number,
  reasoningEnabled: boolean,
  reasoningParameter: string,
  reasoningEffort: string,
): string {
  const normalizedModel = model.trim();
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedApiKey = apiKey.trim();

  if (
    !normalizedModel ||
    /\s/.test(normalizedModel) ||
    normalizedModel.length > 120
  ) {
    return "模型名不能为空、不能包含空格，且不超过 120 个字符。";
  }

  if (!isValidBaseUrl(normalizedBaseUrl)) {
    return "Base URL 必须是 http 或 https 地址，且不能包含空格。";
  }

  if (
    !normalizedApiKey ||
    /\s/.test(normalizedApiKey) ||
    normalizedApiKey.length < 8
  ) {
    return "API Key 至少 8 位，且不能包含空格。";
  }

  if (!Number.isInteger(contextWindow) || contextWindow < 4_096 || contextWindow > 4_000_000) {
    return "上下文大小必须是 4,096 到 4,000,000 之间的整数。";
  }
  if (
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 256 ||
    maxOutputTokens > 262_144
  ) {
    return "最大输出必须是 256 到 262,144 之间的整数。";
  }
  if (maxOutputTokens >= contextWindow) {
    return "最大输出必须小于上下文大小。";
  }
  const normalizedReasoningParameter =
    normalizeAiReasoningParameter(reasoningParameter);
  if (reasoningParameter.trim() && !normalizedReasoningParameter) {
    return "思考参数名无效，可填写 reasoning_effort 或 thinking.type 这类路径。";
  }
  if (reasoningEnabled && !normalizedReasoningParameter) {
    return "启用模型思考前必须填写有效的思考参数名。";
  }
  if (reasoningEnabled && !reasoningEffort.trim()) {
    return "启用模型思考前必须填写思考强度值。";
  }

  return "";
}

function resetAiConfigForm(): void {
  editingAiConfigId.value = null;
  isCreatingAiProvider.value = false;
  isAiConfigFormValidationVisible.value = false;
  aiConfigForm.value = {
    providerId: "custom",
    providerName: "自定义厂商",
    spec: "openai",
    model: "",
    baseUrl: "",
    apiKey: "",
    contextWindow: DEFAULT_CUSTOM_AI_CONTEXT_WINDOW,
    maxOutputTokens: DEFAULT_AI_MAX_OUTPUT_TOKENS,
    reasoningEnabled: false,
    reasoningParameter: "reasoning_effort",
    reasoningEffort: "medium",
    reasoningEffortOptions: ["low", "medium", "high"],
    inputModalities: ["text"],
    supportsAttachments: false,
  };
  aiConfigInitialModelId.value = "";
  isAiConfigSaving.value = false;
  aiCatalogMatchMessage.value = "";
}

function resetAiProviderForm(): void {
  editingAiProviderConfigIds.value = [];
  aiProviderFormMessage.value = "";
  aiProviderForm.value = {
    providerId: "custom",
    providerName: "自定义厂商",
    baseUrl: "",
    apiKey: "",
  };
}

async function loadAiCatalog(): Promise<void> {
  if (aiCatalog.value) return;
  if (aiCatalogLoadPromise) return aiCatalogLoadPromise;
  if (!core.orbitSSHApi?.ai.getCatalog) {
    aiCatalogError.value = "当前版本不支持在线模型目录";
    return;
  }
  aiCatalogLoadPromise = (async () => {
    isAiCatalogLoading.value = true;
    aiCatalogError.value = "";
    try {
      aiCatalog.value = await core.orbitSSHApi.ai.getCatalog();
    } catch (error) {
      aiCatalogError.value = error instanceof Error ? error.message : String(error);
    } finally {
      isAiCatalogLoading.value = false;
    }
  })();

  try {
    await aiCatalogLoadPromise;
  } finally {
    aiCatalogLoadPromise = null;
  }
}

type CatalogModelMatch = {
  provider: AiCatalogProvider;
  model: AiCatalogModel;
};

function getOfficialCatalogProviderId(modelId: string): string {
  const normalized = modelId.toLowerCase();
  if (/^(gpt-|o[134](?:-|$))/.test(normalized)) return "openai";
  if (normalized.startsWith("claude-")) return "anthropic";
  if (normalized.startsWith("gemini-")) return "google";
  if (normalized.startsWith("kimi-")) return "moonshotai";
  if (normalized.startsWith("deepseek-")) return "deepseek";
  return "";
}

function findCatalogModel(modelId: string): CatalogModelMatch | null {
  const normalizedInput = modelId.trim().toLowerCase();
  if (!normalizedInput) return null;
  const slashIndex = normalizedInput.indexOf("/");
  const providerPrefix = slashIndex > 0 ? normalizedInput.slice(0, slashIndex) : "";
  const normalizedModelId = slashIndex > 0
    ? normalizedInput.slice(slashIndex + 1)
    : normalizedInput;
  const preferredProviderIds = Array.from(new Set([
    providerPrefix,
    aiConfigForm.value.providerId !== "custom" ? aiConfigForm.value.providerId : "",
    getOfficialCatalogProviderId(normalizedModelId),
  ].filter(Boolean)));
  const orderedProviders = [
    ...preferredProviderIds.flatMap(providerId =>
      catalogProviders.value.filter(provider => provider.id.toLowerCase() === providerId),
    ),
    ...catalogProviders.value,
  ];
  const visitedProviders = new Set<string>();
  for (const provider of orderedProviders) {
    if (visitedProviders.has(provider.id)) continue;
    visitedProviders.add(provider.id);
    const model = provider.models.find(item =>
      item.id.toLowerCase() === normalizedModelId ||
      item.name.toLowerCase() === normalizedModelId,
    );
    if (model) return { provider, model };
  }
  return null;
}

function applyCatalogReasoning(model: AiCatalogModel): void {
  const defaults = getAiReasoningDefaults(
    aiConfigForm.value.spec,
    model.reasoningOptions,
    model.reasoning,
    model.maxOutputTokens ?? aiConfigForm.value.maxOutputTokens,
  );
  aiConfigForm.value.reasoningEnabled = defaults.enabled;
  aiConfigForm.value.reasoningParameter = defaults.parameter;
  aiConfigForm.value.reasoningEffort = defaults.effort;
  aiConfigForm.value.reasoningEffortOptions = defaults.options;
}

function applyCatalogModel(
  model: AiCatalogModel,
  provider: AiCatalogProvider,
  syncProvider = true,
): void {
  const inputModalities: AiInputModality[] =
    model.modalities.input.length > 0 ? model.modalities.input : ["text"];
  const spec = syncProvider
    ? inferAiApiSpecFromProvider(provider.id, provider.npm)
    : aiConfigForm.value.spec;
  aiConfigForm.value = {
    ...aiConfigForm.value,
    ...(syncProvider
      ? {
          providerId: provider.id,
          providerName: provider.name,
          baseUrl: provider.api || aiConfigForm.value.baseUrl,
        }
      : {}),
    spec,
    model: model.id,
    contextWindow: model.contextWindow ?? DEFAULT_CUSTOM_AI_CONTEXT_WINDOW,
    maxOutputTokens: model.maxOutputTokens ?? DEFAULT_AI_MAX_OUTPUT_TOKENS,
    inputModalities,
    supportsAttachments: model.attachment || inputModalities.some(item => item !== "text"),
  };
  applyCatalogReasoning(model);
  aiCatalogMatchMessage.value = `已从 models.dev 匹配 ${provider.name} / ${model.name}，保存后生效`;
}

function applySelectedProvider(): void {
  const provider = selectedCatalogProvider.value;
  if (!provider) {
    aiConfigForm.value = {
      ...aiConfigForm.value,
      providerName: "自定义厂商",
      spec: "openai",
      model: "",
      baseUrl: "",
      inputModalities: ["text"],
      supportsAttachments: false,
    };
    aiCatalogMatchMessage.value = "";
    return;
  }
  const firstModel = provider.models[0];
  if (firstModel) applyCatalogModel(firstModel, provider);
  else aiConfigForm.value.baseUrl = provider.api;
}

function applySelectedProviderToProviderForm(): void {
  const provider = selectedProviderCatalog.value;
  if (!provider) {
    aiProviderForm.value.providerName = "自定义厂商";
    return;
  }

  aiProviderForm.value.providerName = provider.name;
  aiProviderForm.value.baseUrl = provider.api || aiProviderForm.value.baseUrl;
}

function applySelectedModel(): void {
  const model = catalogModels.value.find(item => item.id === aiConfigForm.value.model);
  if (model && selectedCatalogProvider.value) {
    applyCatalogModel(model, selectedCatalogProvider.value);
    return;
  }
  const match = findCatalogModel(aiConfigForm.value.model);
  if (match) applyCatalogModel(match.model, match.provider, false);
  else aiCatalogMatchMessage.value = aiConfigForm.value.model.trim()
    ? "models.dev 未找到该模型，保留当前自定义参数"
    : "";
}

function queueModelCatalogAutoFill(): void {
  if (aiModelAutoFillTimer) window.clearTimeout(aiModelAutoFillTimer);

  const typedModelId = aiConfigForm.value.model.trim();
  if (!typedModelId || typedModelId === aiConfigInitialModelId.value.trim()) {
    aiCatalogMatchMessage.value = "";
    return;
  }

  aiModelAutoFillTimer = window.setTimeout(() => {
    aiModelAutoFillTimer = undefined;
    void loadAiCatalog().then(() => {
      if (
        !isAiConfigFormDialogOpen.value ||
        aiConfigForm.value.model.trim() !== typedModelId
      ) {
        return;
      }

      applySelectedModel();
    });
  }, 320);
}

function applySelectedApiSpec(): void {
  const match = findCatalogModel(aiConfigForm.value.model);
  if (match) applyCatalogReasoning(match.model);
  else {
    const defaults = getAiReasoningDefaults(
      aiConfigForm.value.spec,
      [],
      aiConfigForm.value.reasoningEnabled,
      aiConfigForm.value.maxOutputTokens,
    );
    aiConfigForm.value.reasoningParameter = defaults.parameter;
    aiConfigForm.value.reasoningEffort = defaults.effort;
    aiConfigForm.value.reasoningEffortOptions = defaults.options;
  }
}

function openAiConfigDialog(): void {
  resetAiConfigDraft();
  isAiConfigDialogOpen.value = true;
  void loadAiCatalog();
}

function closeAiConfigDialog(): void {
  isAiConfigDialogOpen.value = false;
  resetAiConfigForm();
  isAiConfigFormDialogOpen.value = false;
  aiConfigMessage.value = "";
}

// 关闭新增/编辑子弹窗并清空表单。
function closeAiConfigFormDialog(): void {
  if (aiModelAutoFillTimer) window.clearTimeout(aiModelAutoFillTimer);
  isAiConfigFormDialogOpen.value = false;
  resetAiConfigForm();
}

function startAddAiProvider(): void {
  resetAiConfigForm();
  isCreatingAiProvider.value = true;
  aiConfigMessage.value = "";
  isAiConfigFormDialogOpen.value = true;
}

function startAddAiModel(group: AiProviderGroup): void {
  resetAiConfigForm();
  aiConfigForm.value = {
    ...aiConfigForm.value,
    providerId: group.providerId,
    providerName: group.providerName,
    spec: group.configs[0]?.spec ?? "openai",
    baseUrl: group.baseUrl,
    apiKey: group.apiKey,
  };
  aiConfigMessage.value = "";
  isAiConfigFormDialogOpen.value = true;
}

function startEditAiConfig(config: AiModelConfig): void {
  editingAiConfigId.value = config.id;
  aiConfigForm.value = {
    providerId: config.provider,
    providerName: config.providerName,
    spec: config.spec,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    contextWindow: config.contextWindow,
    maxOutputTokens: config.maxOutputTokens,
    reasoningEnabled: config.reasoningEnabled,
    reasoningParameter: config.reasoningParameter,
    reasoningEffort: config.reasoningEffort,
    reasoningEffortOptions: [...config.reasoningEffortOptions],
    inputModalities: [...config.inputModalities],
    supportsAttachments: config.supportsAttachments,
  };
  aiConfigInitialModelId.value = config.model.trim();
  aiConfigMessage.value = "";
  isAiConfigFormDialogOpen.value = true;
}

function selectAiProvider(group: AiProviderGroup): void {
  selectedAiProviderConfigId.value = group.configs[0]?.id ?? "";
}

function startEditAiProvider(group: AiProviderGroup): void {
  editingAiProviderConfigIds.value = group.configs.map(config => config.id);
  aiProviderForm.value = {
    providerId: group.providerId,
    providerName: group.providerName,
    baseUrl: group.baseUrl,
    apiKey: group.apiKey,
  };
  aiProviderFormMessage.value = "";
  isAiProviderFormDialogOpen.value = true;
}

function closeAiProviderFormDialog(): void {
  isAiProviderFormDialogOpen.value = false;
  resetAiProviderForm();
}

function saveAiProviderForm(): void {
  const normalizedBaseUrl = normalizeBaseUrl(aiProviderForm.value.baseUrl);
  const normalizedApiKey = aiProviderForm.value.apiKey.trim();
  const normalizedProviderName = aiProviderForm.value.providerName.trim();

  if (!normalizedProviderName) {
    aiProviderFormMessage.value = "供应商名称不能为空。";
    return;
  }
  if (!isValidBaseUrl(normalizedBaseUrl)) {
    aiProviderFormMessage.value = "Base URL 必须是 http 或 https 地址。";
    return;
  }
  if (!normalizedApiKey || /\s/.test(normalizedApiKey) || normalizedApiKey.length < 8) {
    aiProviderFormMessage.value = "API Key 至少 8 位，且不能包含空格。";
    return;
  }

  const editedIds = new Set(editingAiProviderConfigIds.value);
  const nextConfigs = aiConfigDraft.value.map(config =>
    editedIds.has(config.id)
      ? {
          ...config,
          provider: aiProviderForm.value.providerId.trim() || "custom",
          providerName: normalizedProviderName,
          baseUrl: normalizedBaseUrl,
          apiKey: normalizedApiKey,
        }
      : config,
  );
  const selectedConfigId = editingAiProviderConfigIds.value[0] ?? "";
  persistAiConfigs(nextConfigs, props.appSettings.ai.activeConfigId);
  selectedAiProviderConfigId.value = selectedConfigId;
  isAiProviderFormDialogOpen.value = false;
  resetAiProviderForm();
  aiConfigMessage.value = "供应商配置已更新，组内模型已同步。";
}

function maskApiKey(apiKey: string): string {
  const value = apiKey.trim();
  if (!value) return "-";
  if (value.length <= 8) return "*".repeat(value.length);

  return `${value.slice(0, 3)}${"*".repeat(Math.min(value.length - 6, 12))}${value.slice(-3)}`;
}

function persistAiConfigs(
  configs: AiModelConfig[],
  activeConfigId: string,
  onComplete: (saved: boolean) => void = () => undefined,
): void {
  const requestedMultimodalConfigId = props.appSettings.ai.multimodalConfigId;
  const multimodalConfigId = configs.some(
    config => config.id === requestedMultimodalConfigId && config.supportsAttachments,
  )
    ? requestedMultimodalConfigId
    : "";
  emit(
    "updateAiSettings",
    {
      ...props.appSettings.ai,
      activeConfigId,
      multimodalConfigId,
      configs,
    },
    saved => {
      if (saved) aiConfigDraft.value = cloneAiConfigs(configs);
      onComplete(saved);
    },
  );
}

function saveAiConfigForm(): void {
  if (isAiConfigSaving.value) return;
  isAiConfigFormValidationVisible.value = true;
  const error = validateAiConfigForm(
    aiConfigForm.value.model,
    aiConfigForm.value.baseUrl,
    aiConfigForm.value.apiKey,
    aiConfigForm.value.contextWindow,
    aiConfigForm.value.maxOutputTokens,
    aiConfigForm.value.reasoningEnabled,
    aiConfigForm.value.reasoningParameter,
    aiConfigForm.value.reasoningEffort,
  );
  if (error) {
    aiConfigMessage.value = error;
    return;
  }

  const normalizedConfig: AiModelConfig = {
    id: editingAiConfigId.value ?? `ai-${crypto.randomUUID()}`,
    name: aiConfigForm.value.model.trim(),
    spec: aiConfigForm.value.spec,
    provider: aiConfigForm.value.providerId.trim() || "custom",
    providerName: aiConfigForm.value.providerName.trim() || "自定义厂商",
    baseUrl: normalizeBaseUrl(aiConfigForm.value.baseUrl),
    apiKey: aiConfigForm.value.apiKey.trim(),
    model: aiConfigForm.value.model.trim(),
    contextWindow: Math.max(4_096, Math.floor(aiConfigForm.value.contextWindow)),
    maxOutputTokens: Math.max(256, Math.floor(aiConfigForm.value.maxOutputTokens)),
    reasoningEnabled: aiConfigForm.value.reasoningEnabled,
    reasoningParameter: normalizeAiReasoningParameter(
      aiConfigForm.value.reasoningParameter,
    ),
    reasoningEffort: normalizeAiReasoningEffort(aiConfigForm.value.reasoningEffort),
    reasoningEffortOptions: normalizeAiReasoningValues(
      aiConfigForm.value.reasoningEffortOptions,
    ),
    inputModalities: [...aiConfigForm.value.inputModalities],
    supportsAttachments:
      aiConfigForm.value.supportsAttachments ||
      aiConfigForm.value.inputModalities.some(item => item !== "text"),
    catalogMetadataSynced: true,
  };
  const nextConfigs = editingAiConfigId.value
    ? aiConfigDraft.value.map(config =>
        config.id === editingAiConfigId.value ? normalizedConfig : config,
      )
    : [...aiConfigDraft.value, normalizedConfig];
  const nextActiveConfigId =
    props.appSettings.ai.activeConfigId || normalizedConfig.id;

  isAiConfigSaving.value = true;
  aiConfigMessage.value = "正在保存模型配置...";
  persistAiConfigs(nextConfigs, nextActiveConfigId, saved => {
    isAiConfigSaving.value = false;
    if (!saved) {
      aiConfigMessage.value = "模型配置保存失败，请检查日志后重试。";
      return;
    }

    selectedAiProviderConfigId.value = normalizedConfig.id;
    isAiConfigFormDialogOpen.value = false;
    resetAiConfigForm();
    aiConfigMessage.value = "模型配置已保存。";
  });
}

function selectAiConfig(configId: string): void {
  persistAiConfigs(aiConfigDraft.value, configId);
  aiConfigMessage.value = "当前模型已更新。";
}

function removeAiConfig(configId: string): void {
  const nextConfigs = aiConfigDraft.value.filter(
    config => config.id !== configId,
  );
  const nextActiveConfigId =
    props.appSettings.ai.activeConfigId === configId
      ? (nextConfigs[0]?.id ?? "")
      : props.appSettings.ai.activeConfigId;
  const nextMultimodalConfigId =
    props.appSettings.ai.multimodalConfigId === configId
      ? ""
      : props.appSettings.ai.multimodalConfigId;

  emit("updateAiSettings", {
    ...props.appSettings.ai,
    activeConfigId: nextActiveConfigId,
    multimodalConfigId: nextMultimodalConfigId,
    configs: nextConfigs,
  });
  aiConfigDraft.value = cloneAiConfigs(nextConfigs);
  if (editingAiConfigId.value === configId) {
    resetAiConfigForm();
  }
  aiConfigMessage.value = "模型配置已删除。";
}

function getAiProviderApiSpecSummary(group: AiProviderGroup): string {
  return Array.from(new Set(group.configs.map(config => aiApiSpecLabels[config.spec]))).join(" / ");
}

function removeAiProvider(group: AiProviderGroup): void {
  const removedIds = new Set(group.configs.map(config => config.id));
  const nextConfigs = aiConfigDraft.value.filter(config => !removedIds.has(config.id));
  const nextActiveConfigId = removedIds.has(props.appSettings.ai.activeConfigId)
    ? (nextConfigs[0]?.id ?? "")
    : props.appSettings.ai.activeConfigId;
  const nextMultimodalConfigId = removedIds.has(props.appSettings.ai.multimodalConfigId)
    ? ""
    : props.appSettings.ai.multimodalConfigId;

  emit("updateAiSettings", {
    ...props.appSettings.ai,
    activeConfigId: nextActiveConfigId,
    multimodalConfigId: nextMultimodalConfigId,
    configs: nextConfigs,
  });
  aiConfigDraft.value = cloneAiConfigs(nextConfigs);
  selectedAiProviderConfigId.value = nextConfigs[0]?.id ?? "";
  aiConfigMessage.value = "供应商及其模型已删除。";
}
</script>

<template>
  <AppDialog
    v-if="open"
    title="设置"
    description="调整应用偏好。"
    width="large"
    @close="emit('close')">
    <div class="settings-layout">
      <aside class="settings-nav" aria-label="设置分类">
        <button
          type="button"
          :class="[
            'settings-nav-item',
            { active: activeSettingsSection === 'general' },
          ]"
          @click="emit('updateActiveSection', 'general')">
          <PhSlidersHorizontal :size="16" />
          通用
        </button>
        <button
          type="button"
          :class="[
            'settings-nav-item',
            { active: activeSettingsSection === 'ai' },
          ]"
          @click="emit('updateActiveSection', 'ai')">
          <PhSparkle :size="16" />
          AI
        </button>
        <button
          type="button"
          :class="[
            'settings-nav-item',
            { active: activeSettingsSection === 'shortcuts' },
          ]"
          @click="emit('updateActiveSection', 'shortcuts')">
          <PhCommand :size="16" />
          快捷键
        </button>
      </aside>

      <section
        v-if="activeSettingsSection === 'general'"
        class="settings-content">
        <div class="settings-field">
          <div>
            <h3>主题</h3>
            <p>切换深色或浅色外观。</p>
          </div>
          <div class="theme-mode-control" aria-label="主题">
            <button
              type="button"
              :class="[
                'theme-mode-option',
                { active: appSettings.appearance.themeMode === 'dark' },
              ]"
              @click="emit('updateThemeMode', 'dark')">
              深色
            </button>
            <button
              type="button"
              :class="[
                'theme-mode-option',
                { active: appSettings.appearance.themeMode === 'light' },
              ]"
              @click="emit('updateThemeMode', 'light')">
              浅色
            </button>
          </div>
        </div>

        <div class="settings-field">
          <div>
            <h3>终端字体大小</h3>
            <p>控制当前和后续终端的字体大小。</p>
          </div>
          <div class="stepper-control">
            <button
              type="button"
              @click="emit('stepTerminalNumberSetting', 'fontSize', -1)">
              -
            </button>
            <output>{{ appSettings.terminal.fontSize }}</output>
            <button
              type="button"
              @click="emit('stepTerminalNumberSetting', 'fontSize', 1)">
              +
            </button>
          </div>
        </div>

        <div class="settings-field">
          <div>
            <h3>终端行高</h3>
            <p>调整终端行之间的垂直间距。</p>
          </div>
          <div class="stepper-control">
            <button
              type="button"
              @click="emit('stepTerminalNumberSetting', 'lineHeight', -0.1)">
              -
            </button>
            <output>{{ appSettings.terminal.lineHeight.toFixed(1) }}</output>
            <button
              type="button"
              @click="emit('stepTerminalNumberSetting', 'lineHeight', 0.1)">
              +
            </button>
          </div>
        </div>

        <div class="settings-field">
          <div>
            <h3>选区颜色</h3>
            <p>选择终端文本选区的背景颜色。</p>
          </div>
          <div class="color-select">
            <button
              type="button"
              class="color-select-trigger"
              @click="
                emit(
                  'updateSelectionDropdownOpen',
                  !isSelectionBackgroundDropdownOpen,
                )
              ">
              <span
                class="color-swatch"
                :style="{
                  background: appSettings.terminal.selectionBackground,
                }"></span>
              <span>{{ appSettings.terminal.selectionBackground }}</span>
            </button>

            <div
              v-if="isSelectionBackgroundDropdownOpen"
              class="color-select-menu">
              <button
                v-for="color in selectionBackgroundOptions"
                :key="color"
                type="button"
                class="color-select-option"
                @click="emit('selectSelectionBackground', color)">
                <span
                  class="color-swatch"
                  :style="{ background: color }"></span>
                <span>{{ color }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="settings-field">
          <div>
            <h3>SSH 保活间隔（秒）</h3>
            <p>设置为 0 时禁用 SSH 和 SFTP 保活包。</p>
          </div>
          <NumberStepper
            :model-value="appSettings.connection.keepaliveIntervalSeconds"
            :min="0"
            :max="300"
            :step="5"
            placeholder="30"
            @update:model-value="
              emit('updateKeepaliveIntervalSeconds', $event)
            " />
        </div>

        <div class="settings-field">
          <div>
            <h3>空闲断开时间（分钟）</h3>
            <p>默认不自动断开；设置大于 0 可启用空闲自动断开。</p>
          </div>
          <NumberStepper
            :model-value="appSettings.connection.idleDisconnectMinutes"
            :min="0"
            :max="1440"
            :step="5"
            placeholder="0"
            @update:model-value="emit('updateIdleDisconnectMinutes', $event)" />
        </div>

        <div class="settings-field">
          <div>
            <h3>启动时打开本地终端</h3>
            <p>应用启动并加载设置后，自动创建一个本地 shell 会话。</p>
          </div>
          <label class="settings-switch-control">
            <input
              type="checkbox"
              :checked="appSettings.terminal.openLocalTerminalOnStartup"
              @change="
                emit(
                  'updateOpenLocalTerminalOnStartup',
                  ($event.target as HTMLInputElement).checked,
                )
              " />
            <i aria-hidden="true"></i>
            <span>
              {{ appSettings.terminal.openLocalTerminalOnStartup ? "已开启" : "已关闭" }}
            </span>
          </label>
        </div>
      </section>

      <section
        v-else-if="activeSettingsSection === 'ai'"
        class="settings-content">
        <div class="settings-field">
          <div>
            <h3>启用 AI</h3>
            <p>在 AI 助手面板中启用在线模型回答能力。</p>
          </div>
          <label class="settings-switch-control">
            <input
              type="checkbox"
              :checked="appSettings.ai.enabled"
              @change="
                emit(
                  'updateAiSetting',
                  'enabled',
                  ($event.target as HTMLInputElement).checked,
                )
              " />
            <i aria-hidden="true"></i>
            <span>{{ appSettings.ai.enabled ? "开启" : "关闭" }}</span>
          </label>
        </div>

        <div class="settings-field">
          <div>
            <h3>模型配置</h3>
            <p>{{ aiConfigSummary }}</p>
          </div>
          <button
            type="button"
            class="settings-primary-button"
            @click="openAiConfigDialog">
            查看
          </button>
        </div>

        <div class="settings-field">
          <div>
            <h3>多模态模型</h3>
            <p>输入图片或文件时优先使用该模型；不选择时跟随当前模型。</p>
          </div>
          <select
            class="settings-select"
            :value="appSettings.ai.multimodalConfigId"
            @change="
              emit(
                'updateAiSetting',
                'multimodalConfigId',
                ($event.target as HTMLSelectElement).value,
              )
            ">
            <option value="">跟随当前模型</option>
            <option
              v-for="config in multimodalAiConfigs"
              :key="config.id"
              :value="config.id">
              {{ config.providerName }} / {{ config.model }}
            </option>
          </select>
        </div>

        <div class="settings-field">
          <div>
            <h3>发送最近终端输出</h3>
            <p>
              每次请求附带当前 Tab 最后 3,000 个字符；发送前会脱敏常见凭据。
              当前状态会保存在本机设置中。
            </p>
          </div>
          <label class="settings-switch-control">
            <input
              type="checkbox"
              :checked="appSettings.ai.shareTerminalContext"
              @change="
                emit(
                  'updateAiSetting',
                  'shareTerminalContext',
                  ($event.target as HTMLInputElement).checked,
                )
              " />
            <i aria-hidden="true"></i>
            <span>
              {{ appSettings.ai.shareTerminalContext ? "已开启" : "已关闭" }}
            </span>
          </label>
        </div>

        <div class="settings-field">
          <div>
            <h3>默认模式</h3>
            <p>AI 助手启动时默认使用的权限模式。</p>
          </div>
          <div class="theme-mode-control ai-mode-setting">
            <button
              v-for="item in aiModeOptions"
              :key="item"
              type="button"
              :class="[
                'theme-mode-option',
                { active: appSettings.ai.defaultMode === item },
              ]"
              @click="emit('updateAiSetting', 'defaultMode', item)">
              {{ aiModeLabels[item] }}
            </button>
          </div>
        </div>

        <div class="settings-field">
          <div>
            <h3>单次任务命令上限</h3>
            <p>每次提问最多允许 AI 执行的命令数；重复命令不会计数或再次执行。</p>
          </div>
          <NumberStepper
            :model-value="appSettings.ai.maxAgentCommandCount"
            :min="1"
            :max="100"
            :step="1"
            placeholder="20"
            @update:model-value="
              emit('updateAiSetting', 'maxAgentCommandCount', $event)
            " />
        </div>

        <div class="settings-field">
          <div>
            <h3>AI 命令超时（分钟）</h3>
            <p>单条命令默认最多执行 10 分钟；设置为 0 时不自动终止，持续日志命令需手动停止。</p>
          </div>
          <NumberStepper
            :model-value="appSettings.ai.commandTimeoutMinutes"
            :min="0"
            :max="1440"
            :step="5"
            placeholder="10"
            @update:model-value="
              emit('updateAiSetting', 'commandTimeoutMinutes', $event)
            " />
        </div>

        <div class="settings-field">
          <div>
            <h3>单个 AI 附件上限（MB）</h3>
            <p>默认 {{ DEFAULT_AI_MAX_ATTACHMENT_SIZE_MB }} MB，最大 {{ MAX_AI_ATTACHMENT_SIZE_MB }} MB；超过 1 MB 的文本、代码和日志由 AI 按需分段读取。</p>
          </div>
          <NumberStepper
            :model-value="appSettings.ai.maxAttachmentSizeMb"
            :min="1"
            :max="MAX_AI_ATTACHMENT_SIZE_MB"
            :step="1"
            :placeholder="String(DEFAULT_AI_MAX_ATTACHMENT_SIZE_MB)"
            @update:model-value="
              emit('updateAiSetting', 'maxAttachmentSizeMb', $event)
            " />
        </div>

        <div class="settings-field">
          <div>
            <h3>命令批准有效期（分钟）</h3>
            <p>设置为 0 时批准请求不会自动过期；开始新任务或关闭终端仍会撤销。</p>
          </div>
          <NumberStepper
            :model-value="appSettings.ai.commandApprovalTimeoutMinutes"
            :min="0"
            :max="1440"
            :step="5"
            placeholder="0"
            @update:model-value="
              emit('updateAiSetting', 'commandApprovalTimeoutMinutes', $event)
            " />
        </div>
      </section>

      <section
        v-else-if="activeSettingsSection === 'shortcuts'"
        class="settings-content">
        <div
          v-for="section in shortcutSections"
          :key="section.id"
          class="shortcut-section">
          <header class="shortcut-section-header">
            <h3>{{ section.title }}</h3>
            <p>{{ section.description }}</p>
          </header>

          <div
            v-for="shortcut in section.shortcuts"
            :key="shortcut.id"
            class="settings-field shortcut-field">
            <div>
              <h4>{{ shortcut.title }}</h4>
              <p>{{ shortcut.description }}</p>
            </div>
            <div class="shortcut-key-group">
              <kbd v-for="key in shortcut.keys" :key="key" class="shortcut-key">
                {{ key }}
              </kbd>
            </div>
          </div>
        </div>
      </section>
    </div>
  </AppDialog>

  <AppDialog
    v-if="isAiConfigDialogOpen"
    title="模型设置"
    description="按供应商管理连接信息和可用模型。"
    width="large"
    @close="closeAiConfigDialog">
    <div class="ai-config-dialog">
      <div class="ai-config-toolbar">
        <p>
          API Key 加密保存在本机。
          <span v-if="isAiCatalogLoading">正在加载模型目录…</span>
          <span v-else-if="aiCatalogError" class="ai-catalog-error">{{ aiCatalogError }}</span>
          <span v-else-if="aiConfigMessage" class="ai-config-message">{{ aiConfigMessage }}</span>
        </p>
        <button
          v-if="aiProviderGroups.length > 0"
          type="button"
          class="settings-primary-button"
          @click="startAddAiProvider">
          <img :src="plusIcon" alt="" />
          新增供应商
        </button>
      </div>

      <div v-if="aiProviderGroups.length > 0" class="ai-provider-workspace">
        <aside class="ai-provider-sidebar" aria-label="供应商列表">
          <header>
            <span>供应商</span>
            <small>{{ aiProviderGroups.length }}</small>
          </header>
          <button
            v-for="group in aiProviderGroups"
            :key="group.id"
            type="button"
            :class="[
              'ai-provider-item',
              { active: selectedAiProviderGroup?.id === group.id },
            ]"
            @click="selectAiProvider(group)">
            <span class="ai-provider-mark">{{ group.providerName.slice(0, 1).toUpperCase() }}</span>
            <span class="ai-provider-item-copy">
              <strong>{{ group.providerName }}</strong>
              <small>{{ group.configs.length }} 个模型</small>
            </span>
            <i
              v-if="group.configs.some(config => config.id === appSettings.ai.activeConfigId)"
              class="ai-provider-active-dot"
              title="包含当前模型"></i>
          </button>
        </aside>

        <section v-if="selectedAiProviderGroup" class="ai-provider-detail">
          <header class="ai-provider-detail-header">
            <div>
              <span class="ai-provider-mark ai-provider-mark-large">
                {{ selectedAiProviderGroup.providerName.slice(0, 1).toUpperCase() }}
              </span>
              <span>
                <strong>{{ selectedAiProviderGroup.providerName }}</strong>
                <small>{{ selectedAiProviderGroup.providerId }}</small>
              </span>
            </div>
            <div class="ai-provider-header-actions">
              <button
                type="button"
                title="编辑供应商"
                aria-label="编辑供应商"
                @click="startEditAiProvider(selectedAiProviderGroup)">
                <img :src="editIcon" alt="" />
              </button>
              <button
                type="button"
                class="danger"
                title="删除供应商"
                aria-label="删除供应商"
                @click="removeAiProvider(selectedAiProviderGroup)">
                <img :src="trashIcon" alt="" />
              </button>
            </div>
          </header>

          <dl class="ai-provider-meta">
            <div>
              <dt>Base URL</dt>
              <dd>{{ selectedAiProviderGroup.baseUrl }}</dd>
            </div>
                <div>
                  <dt>API 格式</dt>
                  <dd>{{ getAiProviderApiSpecSummary(selectedAiProviderGroup) }}</dd>
                </div>
            <div>
              <dt>API Key</dt>
              <dd>{{ maskApiKey(selectedAiProviderGroup.apiKey) }}</dd>
            </div>
          </dl>

          <div class="ai-provider-model-heading">
            <div>
              <strong>模型列表</strong>
              <small>{{ selectedAiProviderGroup.configs.length }} 个可用模型</small>
            </div>
            <button
              type="button"
              class="ai-config-mini-button"
              @click="startAddAiModel(selectedAiProviderGroup)">
              <img :src="plusIcon" alt="" />
              添加模型
            </button>
          </div>

          <div class="ai-provider-model-list">
            <article
              v-for="config in selectedAiProviderGroup.configs"
              :key="config.id"
              :class="[
                'ai-provider-model-row',
                { active: config.id === appSettings.ai.activeConfigId },
              ]">
              <div class="ai-provider-model-copy">
                <strong>{{ config.model }}</strong>
                <span>
                  <small>{{ config.contextWindow.toLocaleString() }} 上下文</small>
                  <small>{{ config.maxOutputTokens.toLocaleString() }} 输出</small>
                  <small v-if="config.reasoningParameter">支持推理</small>
                  <small v-if="config.supportsAttachments">多模态</small>
                </span>
              </div>
              <span
                v-if="config.id === appSettings.ai.activeConfigId"
                class="ai-config-current-badge">
                当前
              </span>
              <button
                v-else
                type="button"
                class="ai-config-mini-button"
                @click="selectAiConfig(config.id)">
                使用
              </button>
              <div class="ai-provider-model-actions">
                <button
                  type="button"
                  title="编辑模型"
                  aria-label="编辑模型"
                  @click="startEditAiConfig(config)">
                  <img :src="editIcon" alt="" />
                </button>
                <button
                  type="button"
                  class="danger"
                  title="删除模型"
                  aria-label="删除模型"
                  @click="removeAiConfig(config.id)">
                  <img :src="trashIcon" alt="" />
                </button>
              </div>
            </article>
          </div>
        </section>
      </div>

      <div v-else class="ai-config-empty-state">
        <span class="ai-provider-mark ai-provider-mark-large">AI</span>
        <strong>还没有模型供应商</strong>
        <p>添加供应商并配置第一个模型后，即可在 AI 对话中选择使用。</p>
        <button type="button" class="settings-primary-button" @click="startAddAiProvider">
          <img :src="plusIcon" alt="" />
          新增供应商
        </button>
      </div>
    </div>
  </AppDialog>

  <!-- 新增/编辑模型：独立子弹窗，避免常驻表单撑高列表弹窗 -->
  <AppDialog
    v-if="isAiConfigFormDialogOpen"
    :title="aiConfigFormDialogTitle"
    :description="
      isEditingAiConfig
        ? '修改模型能力和调用参数。'
        : isCreatingAiProvider
          ? '配置供应商连接并添加第一个模型。'
          : `向 ${aiConfigForm.providerName} 添加模型。`
    "
    width="config"
    @close="closeAiConfigFormDialog">
    <form class="ai-config-form" @submit.prevent="saveAiConfigForm">
      <div
        v-if="isAiConfigFormValidationVisible && aiConfigFormError"
        class="ai-config-form-error"
        role="alert">
        {{ aiConfigFormError }}
      </div>

      <div class="ai-config-form-body">
        <section class="ai-config-form-section">
          <h3>{{ isCreatingAiProvider ? "供应商与模型" : "模型信息" }}</h3>
          <div v-if="!isCreatingAiProvider" class="ai-model-provider-context">
            <span class="ai-provider-mark">{{ aiConfigForm.providerName.slice(0, 1).toUpperCase() }}</span>
            <span>
              <strong>{{ aiConfigForm.providerName }}</strong>
              <small>{{ aiConfigForm.baseUrl }}</small>
            </span>
          </div>
          <div class="ai-config-form-grid">
            <label v-if="isCreatingAiProvider">
              <span>厂商</span>
              <select
                v-model="aiConfigForm.providerId"
                class="settings-select"
                @change="applySelectedProvider">
                <option value="custom">自定义厂商</option>
                <option
                  v-for="provider in catalogProviders"
                  :key="provider.id"
                  :value="provider.id">
                  {{ provider.name }}
                </option>
              </select>
            </label>

            <label v-if="isCreatingAiProvider && aiConfigForm.providerId === 'custom'">
              <span>厂商名称</span>
              <input
                v-model="aiConfigForm.providerName"
                class="settings-text-input"
                type="text"
                placeholder="自定义厂商" />
            </label>

            <label>
              <span>模型 ID</span>
              <input
                v-model="aiConfigForm.model"
                class="settings-text-input"
                type="text"
                list="ai-model-catalog-options"
                placeholder="输入或选择模型 ID"
                @input="queueModelCatalogAutoFill" />
              <datalist id="ai-model-catalog-options">
                <option v-for="model in catalogModels" :key="model.id" :value="model.id">
                  {{ model.name }}
                </option>
              </datalist>
              <small v-if="aiCatalogMatchMessage" class="ai-catalog-match-message">
                {{ aiCatalogMatchMessage }}
              </small>
            </label>

            <label>
              <span>API 格式</span>
              <select
                v-model="aiConfigForm.spec"
                class="settings-select"
                @change="applySelectedApiSpec">
                <option v-for="(label, spec) in aiApiSpecLabels" :key="spec" :value="spec">
                  {{ label }}
                </option>
              </select>
            </label>

            <label v-if="isCreatingAiProvider">
              <span>Base URL</span>
              <input
                v-model="aiConfigForm.baseUrl"
                class="settings-text-input"
                type="url"
                placeholder="https://api.example.com" />
            </label>

            <label v-if="isCreatingAiProvider">
              <span>API Key</span>
              <input
                v-model="aiConfigForm.apiKey"
                class="settings-text-input"
                type="password"
                autocomplete="off"
                placeholder="sk-..." />
            </label>
          </div>
        </section>

        <section class="ai-config-form-section">
          <h3>模型限制</h3>
          <div class="ai-config-form-grid">
            <label>
              <span>上下文大小（tokens）</span>
              <input
                v-model.number="aiConfigForm.contextWindow"
                class="settings-text-input"
                type="number"
                min="4096"
                max="4000000"
                step="1024" />
            </label>
            <label>
              <span>最大输出（tokens）</span>
              <input
                v-model.number="aiConfigForm.maxOutputTokens"
                class="settings-text-input"
                type="number"
                min="256"
                max="262144"
                step="256" />
            </label>
          </div>
          <p class="ai-config-limit-note">
            目录模型会使用 models.dev 公布的上下文与输出上限；目录缺失或自定义模型默认使用
            200,000 tokens，请按厂商文档校准。
          </p>
        </section>

        <section class="ai-config-form-section">
          <h3>能力与思考</h3>
          <div class="ai-config-form-grid ai-config-reasoning-grid">
            <label class="ai-config-switch-row ai-config-reasoning-switch">
              <span>
                <strong>模型思考</strong>
                <small>关闭时不向模型发送思考参数</small>
              </span>
              <input v-model="aiConfigForm.reasoningEnabled" type="checkbox" />
              <i aria-hidden="true"></i>
            </label>
            <label>
              <span>思考参数名</span>
              <input
                v-model="aiConfigForm.reasoningParameter"
                class="settings-text-input"
                type="text"
                placeholder="reasoning_effort 或 thinking.type" />
            </label>
            <label>
              <span>思考强度值</span>
              <input
                v-model="aiConfigForm.reasoningEffort"
                class="settings-text-input"
                list="ai-reasoning-effort-options"
                placeholder="例如 medium 或 enabled" />
              <datalist id="ai-reasoning-effort-options">
                <option
                  v-for="effort in reasoningEffortOptions"
                  :key="effort"
                  :value="effort" />
              </datalist>
            </label>
            <label>
              <span>支持的思考强度</span>
              <input
                v-model="reasoningEffortOptionsText"
                class="settings-text-input"
                type="text"
                placeholder="low, medium, high" />
            </label>
          </div>

          <fieldset class="ai-config-modalities">
            <legend>输入能力</legend>
            <div class="ai-config-modality-grid">
              <label
                v-for="modality in ['text', 'image', 'audio', 'video', 'pdf', 'file']"
                :key="modality"
                class="ai-config-modality">
                <input
                  v-model="aiConfigForm.inputModalities"
                  type="checkbox"
                  :value="modality" />
                <span>{{ modality }}</span>
              </label>
            </div>
          </fieldset>

          <label class="ai-config-switch-row ai-config-attachment-switch">
            <span>
              <strong>附件输入</strong>
              <small>{{ aiConfigForm.supportsAttachments ? "已允许" : "未允许" }}</small>
            </span>
            <input v-model="aiConfigForm.supportsAttachments" type="checkbox" />
            <i aria-hidden="true"></i>
          </label>
        </section>
      </div>

      <div class="ai-config-form-actions">
        <button
          type="button"
          class="ai-config-mini-button"
          @click="closeAiConfigFormDialog">
          取消
        </button>
        <button
          type="button"
          class="settings-primary-button"
          :disabled="isAiConfigSaving"
          @click="saveAiConfigForm">
          {{ isAiConfigSaving ? "保存中..." : "保存" }}
        </button>
      </div>
    </form>
  </AppDialog>

  <AppDialog
    v-if="isAiProviderFormDialogOpen"
    title="编辑供应商"
    description="连接信息会同步到该供应商下的全部模型。"
    width="small"
    @close="closeAiProviderFormDialog">
    <form class="ai-provider-form" @submit.prevent="saveAiProviderForm">
      <p v-if="aiProviderFormMessage" class="ai-config-form-error" role="alert">
        {{ aiProviderFormMessage }}
      </p>
      <div class="ai-provider-form-fields">
        <label>
          <span>厂商</span>
          <select
            v-model="aiProviderForm.providerId"
            class="settings-select"
            @change="applySelectedProviderToProviderForm">
            <option value="custom">自定义厂商</option>
            <option
              v-for="provider in catalogProviders"
              :key="provider.id"
              :value="provider.id">
              {{ provider.name }}
            </option>
          </select>
        </label>
        <label>
          <span>供应商名称</span>
          <input
            v-model="aiProviderForm.providerName"
            class="settings-text-input"
            type="text"
            placeholder="供应商名称" />
        </label>
        <label>
          <span>Base URL</span>
          <input
            v-model="aiProviderForm.baseUrl"
            class="settings-text-input"
            type="url"
            placeholder="https://api.example.com" />
        </label>
        <label>
          <span>API Key</span>
          <input
            v-model="aiProviderForm.apiKey"
            class="settings-text-input"
            type="password"
            autocomplete="off"
            placeholder="sk-..." />
        </label>
      </div>
      <div class="ai-config-form-actions">
        <button type="button" class="ai-config-mini-button" @click="closeAiProviderFormDialog">
          取消
        </button>
        <button type="button" class="settings-primary-button" @click="saveAiProviderForm">保存</button>
      </div>
    </form>
  </AppDialog>
</template>
