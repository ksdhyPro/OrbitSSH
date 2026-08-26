<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  AiModelConfig,
  AiSettings,
  AppSettings,
  AppThemeMode,
  CodexCliDetection,
  CodexReasoningEffort,
} from "../../shared/settings";
import { getShortcutSections } from "../config/shortcuts";
import arrowLeftIcon from "../assets/icons/arrow-left.svg";
import chevronRightIcon from "../assets/icons/chevron-right.svg";
import AppDialog from "./AppDialog.vue";
import AppSelect, { type AppSelectOption } from "./AppSelect.vue";
import NumberStepper from "./NumberStepper.vue";

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
  updateAiSetting: [key: keyof AiSettings, value: AiSettings[keyof AiSettings]];
  updateAiSettings: [value: AiSettings];
  updateThemeMode: [mode: AppThemeMode];
  selectSelectionBackground: [color: string];
}>();

const shortcutSections = computed(() => getShortcutSections(props.isMac));

const aiModeOptions: AiSettings["defaultMode"][] = ["ask", "full"];

const aiModeLabels: Record<AiSettings["defaultMode"], string> = {
  ask: "每次询问",
  full: "完全访问",
};

const aiConfigDraft = ref<AiModelConfig[]>([]);
// 模型列表弹窗
const isAiConfigDialogOpen = ref(false);
// 新增/编辑表单子弹窗（与列表弹窗分离，避免常驻表单撑高弹窗）
const isAiConfigFormDialogOpen = ref(false);
const editingAiConfigId = ref<string | null>(null);
const aiConfigMessage = ref("");
const codexDetection = ref<CodexCliDetection | null>(null);
const isDetectingCodex = ref(false);
const isCodexConfigFormDialogOpen = ref(false);
const codexModel = ref("");
// 检测失败时允许用户手动指定 Codex CLI 可执行文件地址。
const codexExecutablePath = ref("");
const codexReasoningEffort = ref<CodexReasoningEffort>("medium");
const codexModelOptions: AppSelectOption[] = [
  { value: "", label: "默认模型" },
  { value: "gpt-5.6-terra", label: "gpt-5.6-terra" },
  { value: "gpt-5.6-sol", label: "gpt-5.6-sol" },
  { value: "gpt-5.5", label: "gpt-5.5" },
  { value: "gpt-5.4", label: "gpt-5.4" },
];
const codexReasoningOptions: AppSelectOption[] = [
  { value: "low", label: "低", detail: "low" },
  { value: "medium", label: "中", detail: "medium" },
  { value: "high", label: "高", detail: "high" },
  { value: "xhigh", label: "极高", detail: "xhigh" },
];
const aiConfigForm = ref({
  model: "",
  baseUrl: "",
  apiKey: "",
});

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

  return activeAiConfig.value
    ? `${activeAiConfig.value.model}（共 ${count} 个）`
    : `共 ${count} 个，未选择当前模型`;
});

const isEditingAiConfig = computed(() => Boolean(editingAiConfigId.value));

const aiConfigFormDialogTitle = computed(() =>
  isEditingAiConfig.value ? "编辑模型" : "新增模型",
);

const aiConfigFormError = computed(() =>
  validateAiConfigForm(
    aiConfigForm.value.model,
    aiConfigForm.value.baseUrl,
    aiConfigForm.value.apiKey,
  ),
);

const canSaveAiConfigForm = computed(() => !aiConfigFormError.value);

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
  return configs.map(config => ({ ...config }));
}

// 打开设置页时从当前设置同步一份可编辑草稿。
function resetAiConfigDraft(): void {
  aiConfigDraft.value = cloneAiConfigs(props.appSettings.ai.configs);
  resetAiConfigForm();
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

  return "";
}

function resetAiConfigForm(): void {
  editingAiConfigId.value = null;
  aiConfigForm.value = {
    model: "",
    baseUrl: "",
    apiKey: "",
  };
}

function openAiConfigDialog(): void {
  resetAiConfigDraft();
  isAiConfigDialogOpen.value = true;
}

function closeAiConfigDialog(): void {
  isAiConfigDialogOpen.value = false;
  resetAiConfigForm();
  isAiConfigFormDialogOpen.value = false;
  isCodexConfigFormDialogOpen.value = false;
  aiConfigMessage.value = "";
  codexModel.value = "";
  codexExecutablePath.value = "";
  codexReasoningEffort.value = "medium";
  codexDetection.value = null;
}

async function detectLocalCodex(): Promise<void> {
  if (isDetectingCodex.value) return;
  isDetectingCodex.value = true;
  aiConfigMessage.value = "";
  try {
    const result = await window.orbitSSH.ai.detectLocalCodex();
    codexDetection.value = result;
    if (result.available && result.executablePath) {
      // 检测成功后直接进入配置，不在列表弹窗中暴露本地可执行文件路径。
      openCodexConfigForm();
      return;
    }

    openCodexConfigForm();
    aiConfigMessage.value = "未检测到本地 Codex CLI，请手动输入可执行文件地址。";
  } catch {
    codexDetection.value = { available: false };
    openCodexConfigForm();
    aiConfigMessage.value = "未检测到本地 Codex CLI，请手动输入可执行文件地址。";
  } finally {
    isDetectingCodex.value = false;
  }
}

function openCodexConfigForm(): void {
  codexModel.value = "";
  codexExecutablePath.value = codexDetection.value?.executablePath ?? "";
  codexReasoningEffort.value = "medium";
  isCodexConfigFormDialogOpen.value = true;
}

/** AppSelect 的值为字符串，在这里收窄为 Codex 支持的思考强度。 */
function updateCodexReasoningEffort(value: string): void {
  codexReasoningEffort.value = value as CodexReasoningEffort;
}

function addDetectedCodexCli(): void {
  const executablePath = codexExecutablePath.value.trim();
  if (!executablePath) {
    aiConfigMessage.value = "请输入 Codex CLI 可执行文件地址。";
    return;
  }
  // 留空时明确表示使用本机 Codex 配置的默认模型。
  const selectedModel = codexModel.value.trim() || "默认模型";
  const existing = aiConfigDraft.value.find(
    config =>
      config.spec === "codex-cli" &&
      config.codexExecutablePath === executablePath &&
      config.model === selectedModel &&
      config.codexReasoningEffort === codexReasoningEffort.value,
  );
  if (existing) {
    selectAiConfig(existing.id);
    aiConfigMessage.value = "Codex CLI 配置已存在，已切换为当前模型。";
    return;
  }
  const config: AiModelConfig = {
    id: `ai-${crypto.randomUUID()}`,
    name: `Codex · ${selectedModel} · ${codexReasoningEffort.value}`,
    spec: "codex-cli",
    provider: "codex",
    baseUrl: "",
    apiKey: "",
    model: selectedModel,
    codexExecutablePath: executablePath,
    codexReasoningEffort: codexReasoningEffort.value,
  };
  const configs = [...aiConfigDraft.value, config];
  persistAiConfigs(configs, config.id);
  isCodexConfigFormDialogOpen.value = false;
  aiConfigMessage.value = "Codex 交接模型已添加并设为当前模型。";
}

// 关闭新增/编辑子弹窗并清空表单。
function closeAiConfigFormDialog(): void {
  isAiConfigFormDialogOpen.value = false;
  resetAiConfigForm();
}

function startAddAiConfig(): void {
  editingAiConfigId.value = null;
  aiConfigForm.value = {
    model: "",
    baseUrl: "",
    apiKey: "",
  };
  aiConfigMessage.value = "";
  isAiConfigFormDialogOpen.value = true;
}

function startEditAiConfig(config: AiModelConfig): void {
  editingAiConfigId.value = config.id;
  aiConfigForm.value = {
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  };
  aiConfigMessage.value = "";
  isAiConfigFormDialogOpen.value = true;
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
): void {
  emit("updateAiSettings", {
    ...props.appSettings.ai,
    activeConfigId,
    configs,
  });
  aiConfigDraft.value = cloneAiConfigs(configs);
}

function saveAiConfigForm(): void {
  const error = validateAiConfigForm(
    aiConfigForm.value.model,
    aiConfigForm.value.baseUrl,
    aiConfigForm.value.apiKey,
  );
  if (error) {
    aiConfigMessage.value = error;
    return;
  }

  const normalizedConfig: AiModelConfig = {
    id: editingAiConfigId.value ?? `ai-${crypto.randomUUID()}`,
    name: aiConfigForm.value.model.trim(),
    spec: "openai",
    provider: "other",
    baseUrl: normalizeBaseUrl(aiConfigForm.value.baseUrl),
    apiKey: aiConfigForm.value.apiKey.trim(),
    model: aiConfigForm.value.model.trim(),
  };
  const nextConfigs = editingAiConfigId.value
    ? aiConfigDraft.value.map(config =>
        config.id === editingAiConfigId.value ? normalizedConfig : config,
      )
    : [...aiConfigDraft.value, normalizedConfig];
  const nextActiveConfigId =
    props.appSettings.ai.activeConfigId || normalizedConfig.id;

  persistAiConfigs(nextConfigs, nextActiveConfigId);
  isAiConfigFormDialogOpen.value = false;
  resetAiConfigForm();
  aiConfigMessage.value = "模型配置已保存。";
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

  persistAiConfigs(nextConfigs, nextActiveConfigId);
  if (editingAiConfigId.value === configId) {
    resetAiConfigForm();
  }
  aiConfigMessage.value = "模型配置已删除。";
}
</script>

<template>
  <Teleport to="body">
    <section
      v-if="open"
      class="settings-page"
      role="dialog"
      aria-modal="true"
      aria-label="设置">
      <div class="settings-layout">
        <aside class="settings-nav" aria-label="设置分类">
          <button type="button" class="settings-back" @click="emit('close')">
            <img :src="arrowLeftIcon" alt="" />
            返回应用
          </button>
          <p class="settings-nav-label">偏好设置</p>
          <button
            type="button"
            :class="[
              'settings-nav-item',
              { active: activeSettingsSection === 'general' },
            ]"
            @click="emit('updateActiveSection', 'general')">
            通用
          </button>
          <button
            type="button"
            :class="[
              'settings-nav-item',
              { active: activeSettingsSection === 'ai' },
            ]"
            @click="emit('updateActiveSection', 'ai')">
            AI
          </button>
          <button
            type="button"
            :class="[
              'settings-nav-item',
              { active: activeSettingsSection === 'shortcuts' },
            ]"
            @click="emit('updateActiveSection', 'shortcuts')">
            快捷键
          </button>
        </aside>

        <section
          v-if="activeSettingsSection === 'general'"
          class="settings-content">
          <header class="settings-content-heading">
            <h1>通用</h1>
          </header>
        <div class="settings-field">
            <div>
              <h3>主题</h3>
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
              placeholder="10"
              @update:model-value="
                emit('updateKeepaliveIntervalSeconds', $event)
              " />
          </div>

          <div class="settings-field">
            <div>
              <h3>空闲断开时间（分钟）</h3>
              <p>设置为 0 时禁用空闲自动断开。</p>
            </div>
            <NumberStepper
              :model-value="appSettings.connection.idleDisconnectMinutes"
              :min="0"
              :max="1440"
              :step="5"
              placeholder="0"
              @update:model-value="
                emit('updateIdleDisconnectMinutes', $event)
              " />
          </div>
        </section>

        <section
          v-else-if="activeSettingsSection === 'ai'"
          class="settings-content ai-settings-content">
          <header class="settings-content-heading">
            <h1>AI</h1>
          </header>
          <div class="settings-field">
            <div>
              <h3>启用 AI</h3>
            </div>
            <label class="settings-toggle">
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
            </label>
          </div>

          <div
            class="settings-field settings-field-link"
            role="button"
            tabindex="0"
            aria-label="查看模型配置"
            @click="openAiConfigDialog"
            @keydown.enter="openAiConfigDialog"
            @keydown.space.prevent="openAiConfigDialog">
            <div>
              <h3>模型配置</h3>
              <p>{{ aiConfigSummary }}</p>
            </div>
          <span class="settings-row-arrow" aria-hidden="true">
            <img :src="chevronRightIcon" alt="" />
          </span>
          </div>

          <div class="settings-field">
            <div>
              <h3>发送最近终端输出</h3>
              <p>发送前自动脱敏。</p>
            </div>
            <label class="settings-toggle">
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
            </label>
          </div>

          <div class="settings-field">
            <div>
              <h3>默认模式</h3>
            </div>
            <div class="theme-mode-control ai-mode-setting">
              <button
                v-for="item in aiModeOptions"
                :key="item"
                type="button"
                :class="[
                  'theme-mode-option',
                  {
                    active: appSettings.ai.defaultMode === item,
                    'is-full-access': item === 'full',
                  },
                ]"
                @click="emit('updateAiSetting', 'defaultMode', item)">
                {{ aiModeLabels[item] }}
              </button>
            </div>
          </div>
        </section>

        <section
          v-else-if="activeSettingsSection === 'shortcuts'"
          class="settings-content">
          <header class="settings-content-heading">
            <h1>快捷键</h1>
          </header>
          <div
            v-for="section in shortcutSections"
            :key="section.id"
            class="shortcut-section">
            <header class="shortcut-section-header">
              <h3>{{ section.title }}</h3>
            </header>

            <div
              v-for="shortcut in section.shortcuts"
              :key="shortcut.id"
              class="settings-field shortcut-field">
              <div>
                <h4>{{ shortcut.title }}</h4>
              </div>
              <div class="shortcut-key-group">
                <kbd
                  v-for="key in shortcut.keys"
                  :key="key"
                  class="shortcut-key">
                  {{ key }}
                </kbd>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  </Teleport>

  <AppDialog
    v-if="isAiConfigDialogOpen"
    title="模型配置"
    width="large"
    @close="closeAiConfigDialog">
    <div class="ai-config-dialog">
      <div class="ai-config-toolbar">
        <p>API Key 仅本地保存；Codex 使用当前系统已登录的命令行账号。</p>
        <div class="ai-config-actions">
          <button
            type="button"
            class="ai-config-mini-button"
            :disabled="isDetectingCodex"
            @click="detectLocalCodex">
            {{ isDetectingCodex ? "检测中..." : "检测本地 Codex" }}
          </button>
          <button
            type="button"
            class="settings-primary-button"
            @click="startAddAiConfig">
            新增在线模型
          </button>
        </div>
      </div>

      <div v-if="aiConfigMessage" class="ai-config-status">
        <p v-if="aiConfigMessage" class="ai-config-form-tip">
          {{ aiConfigMessage }}
        </p>
      </div>

      <div class="ai-config-table-wrap">
        <table class="ai-config-table">
          <thead>
            <tr>
              <th>模型名</th>
              <th>提供商</th>
              <th>连接信息</th>
              <th>当前</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="aiConfigDraft.length === 0">
              <td colspan="5" class="ai-config-empty">
                暂无模型配置，点击「新增」开始配置
              </td>
            </tr>
            <tr
              v-for="config in aiConfigDraft"
              :key="config.id"
              :class="{
                'ai-config-row-active':
                  config.id === appSettings.ai.activeConfigId,
              }">
              <td>
                {{
                  config.spec === "codex-cli"
                    ? `Codex · ${config.model}`
                    : config.model
                }}
              </td>
              <td>
                {{ config.spec === "codex-cli" ? "Codex 交接" : "OpenAI 兼容" }}
              </td>
              <td>
                {{
                  config.spec === "codex-cli"
                    ? `思考强度：${config.codexReasoningEffort ?? "medium"}`
                    : maskApiKey(config.apiKey)
                }}
              </td>
              <td>
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
              </td>
              <td>
                <div class="ai-config-actions">
                  <button
                    type="button"
                    class="ai-config-mini-button"
                    :disabled="config.spec === 'codex-cli'"
                    @click="startEditAiConfig(config)">
                    编辑
                  </button>
                  <button
                    type="button"
                    class="ai-config-mini-button ai-config-danger-button"
                    @click="removeAiConfig(config.id)">
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppDialog>

  <AppDialog
    v-if="isCodexConfigFormDialogOpen"
    title="配置 Codex 交接"
    width="medium"
    @close="isCodexConfigFormDialogOpen = false">
    <form class="ai-config-form" @submit.prevent="addDetectedCodexCli">
      <p class="ai-config-form-tip">
        请选择要使用的模型；默认模型会使用本机 Codex 默认模型。
      </p>

      <label>
        <span>Codex CLI 地址</span>
        <input
          v-model="codexExecutablePath"
          class="settings-text-input"
          type="text"
          placeholder="例如：C:\\Users\\用户名\\AppData\\Roaming\\npm\\codex.cmd"
          autocomplete="off" />
      </label>

      <label>
        <span>模型</span>
        <AppSelect
          v-model="codexModel"
          :options="codexModelOptions"
          ariaLabel="推荐模型" />
      </label>

      <label>
        <span>思考强度</span>
        <AppSelect
          :model-value="codexReasoningEffort"
          :options="codexReasoningOptions"
          ariaLabel="思考强度"
          @update:model-value="updateCodexReasoningEffort" />
      </label>

      <div class="ai-config-form-actions">
        <button
          type="button"
          class="ai-config-mini-button"
          @click="isCodexConfigFormDialogOpen = false">
          取消
        </button>
        <button type="submit" class="settings-primary-button">
          添加到对话模型
        </button>
      </div>
    </form>
  </AppDialog>

  <!-- 新增/编辑模型：独立子弹窗，避免常驻表单撑高列表弹窗 -->
  <AppDialog
    v-if="isAiConfigFormDialogOpen"
    :title="aiConfigFormDialogTitle"
    width="medium"
    @close="closeAiConfigFormDialog">
    <form class="ai-config-form" @submit.prevent="saveAiConfigForm">
      <p class="ai-config-form-tip" :class="{ 'is-error': aiConfigFormError }">
        {{ aiConfigFormError || "填写完整后保存，API Key 仅本地保存。" }}
      </p>

      <label>
        <span>模型名</span>
        <input
          v-model="aiConfigForm.model"
          class="settings-text-input"
          type="text"
          placeholder="deepseek-chat" />
      </label>

      <label>
        <span>Base URL</span>
        <input
          v-model="aiConfigForm.baseUrl"
          class="settings-text-input"
          type="url"
          placeholder="https://api.example.com" />
      </label>

      <label>
        <span>API Key</span>
        <input
          v-model="aiConfigForm.apiKey"
          class="settings-text-input"
          type="password"
          autocomplete="off"
          placeholder="sk-..." />
      </label>

      <div class="ai-config-form-actions">
        <button
          type="button"
          class="ai-config-mini-button"
          @click="closeAiConfigFormDialog">
          取消
        </button>
        <button
          type="submit"
          class="settings-primary-button"
          :disabled="!canSaveAiConfigForm">
          保存
        </button>
      </div>
    </form>
  </AppDialog>
</template>
