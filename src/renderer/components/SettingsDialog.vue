<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  AI_PRESET_PROMPT_MAX_CHARS,
  SFTP_TRANSFER_CONCURRENCY_MAX,
  SFTP_TRANSFER_CONCURRENCY_MIN,
  type AiSettings,
  type AppSettings,
  type AppThemeMode,
} from "../../shared/settings";
import { getShortcutSections } from "../config/shortcuts";
import arrowLeftIcon from "../assets/icons/arrow-left.svg";
import chevronRightIcon from "../assets/icons/chevron-right.svg";
import AiModelConfigDialog from "./settings/AiModelConfigDialog.vue";
import McpInstallDialog from "./settings/McpInstallDialog.vue";
import AppSelect, { type AppSelectOption } from "./ui/AppSelect.vue";
import NumberStepper from "./NumberStepper.vue";
import AppSwitch from "./ui/AppSwitch.vue";
import SegmentedControl, { type SegmentedOption } from "./ui/SegmentedControl.vue";

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
  updateSftpMaxConcurrentTransfers: [value: number];
  updateAiSetting: [key: keyof AiSettings, value: AiSettings[keyof AiSettings]];
  updateAiSettings: [value: AiSettings];
  updateThemeMode: [mode: AppThemeMode];
  selectSelectionBackground: [color: string];
}>();

const shortcutSections = computed(() => getShortcutSections(props.isMac));

const sftpTransferConcurrencyOptions: AppSelectOption[] = Array.from(
  {
    length: SFTP_TRANSFER_CONCURRENCY_MAX - SFTP_TRANSFER_CONCURRENCY_MIN + 1,
  },
  (_, index) => ({
    value: String(index + SFTP_TRANSFER_CONCURRENCY_MIN),
    label: `${index + SFTP_TRANSFER_CONCURRENCY_MIN} 个任务`,
  }),
);

const aiModeOptions: AiSettings["defaultMode"][] = ["ask", "auto", "full_access"];

const themeModeOptions: SegmentedOption<AppThemeMode>[] = [
  { value: "dark", label: "深色" },
  { value: "light", label: "浅色" },
];

// 工作模式直接映射 ai.enabled：普通模式关闭 AI，AI 模式开启 AI 并切换为对话主视图。
const workModeOptions: SegmentedOption<boolean>[] = [
  { value: false, label: "普通模式" },
  { value: true, label: "AI 模式" },
];

const aiModeLabels: Record<AiSettings["defaultMode"], string> = {
  ask: "请求批准",
  auto: "自主执行",
  full_access: "完全访问",
};

const aiModeDescriptions: Record<AiSettings["defaultMode"], string> = {
  ask: "每条有效命令执行前都需要确认。",
  auto: "常规操作自动执行，仅高风险和敏感操作需要确认。",
  full_access: "授权范围内的有效命令直接执行，不再弹出审批。",
};

const aiModeSegmentedOptions: SegmentedOption<AiSettings["defaultMode"]>[] = aiModeOptions.map(
  mode => ({
    value: mode,
    label: aiModeLabels[mode],
    tone: mode === "full_access" ? "warning" : undefined,
  }),
);

// MCP 安装提示词与模型配置各自是独立弹窗组件，这里只控制打开状态。
const isMcpInstallDialogOpen = ref(false);
const isAiConfigDialogOpen = ref(false);
const aiPresetPromptDraft = ref("");
const isAiPresetPromptDirty = computed(
  () => aiPresetPromptDraft.value !== props.appSettings.ai.presetPrompt,
);

const activeAiConfig = computed(() =>
  props.appSettings.ai.configs.find(config => config.id === props.appSettings.ai.activeConfigId),
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

watch(
  () => props.open,
  open => {
    if (open) {
      resetAiPresetPromptDraft();
    }
  },
  { immediate: true },
);

// 预提示词只在点击保存后写入全局设置，编辑过程保持为本地草稿。
function resetAiPresetPromptDraft(): void {
  aiPresetPromptDraft.value = props.appSettings.ai.presetPrompt;
}

function saveAiPresetPrompt(): void {
  if (!isAiPresetPromptDirty.value) return;

  aiPresetPromptDraft.value = aiPresetPromptDraft.value.trim();
  emit("updateAiSetting", "presetPrompt", aiPresetPromptDraft.value);
}

function openMcpInstallDialog(): void {
  isMcpInstallDialogOpen.value = true;
}

function openAiConfigDialog(): void {
  isAiConfigDialogOpen.value = true;
}
</script>

<template>
  <Teleport to="body">
    <section v-if="open" class="settings-page" role="dialog" aria-modal="true" aria-label="设置">
      <div class="settings-layout">
        <aside class="settings-nav" aria-label="设置分类">
          <button type="button" class="settings-back" @click="emit('close')">
            <img :src="arrowLeftIcon" alt="" />
            返回应用
          </button>
          <p class="settings-nav-label">偏好设置</p>
          <button
            type="button"
            :class="['settings-nav-item', { active: activeSettingsSection === 'general' }]"
            @click="emit('updateActiveSection', 'general')"
          >
            通用
          </button>
          <button
            type="button"
            :class="['settings-nav-item', { active: activeSettingsSection === 'ai' }]"
            @click="emit('updateActiveSection', 'ai')"
          >
            AI
          </button>
          <button
            type="button"
            :class="['settings-nav-item', { active: activeSettingsSection === 'shortcuts' }]"
            @click="emit('updateActiveSection', 'shortcuts')"
          >
            快捷键
          </button>
        </aside>

        <section v-if="activeSettingsSection === 'general'" class="settings-content">
          <header class="settings-content-heading">
            <h1>通用</h1>
          </header>
          <div class="settings-field">
            <div>
              <h3>主题</h3>
            </div>
            <SegmentedControl
              :model-value="appSettings.appearance.themeMode"
              :options="themeModeOptions"
              ariaLabel="主题"
              @update:model-value="emit('updateThemeMode', $event)"
            />
          </div>

          <div class="settings-field">
            <div>
              <h3>终端字体大小</h3>
            </div>
            <div class="stepper-control">
              <button type="button" @click="emit('stepTerminalNumberSetting', 'fontSize', -1)">
                -
              </button>
              <output>{{ appSettings.terminal.fontSize }}</output>
              <button type="button" @click="emit('stepTerminalNumberSetting', 'fontSize', 1)">
                +
              </button>
            </div>
          </div>

          <div class="settings-field">
            <div>
              <h3>终端行高</h3>
            </div>
            <div class="stepper-control">
              <button type="button" @click="emit('stepTerminalNumberSetting', 'lineHeight', -0.1)">
                -
              </button>
              <output>{{ appSettings.terminal.lineHeight.toFixed(1) }}</output>
              <button type="button" @click="emit('stepTerminalNumberSetting', 'lineHeight', 0.1)">
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
                @click="emit('updateSelectionDropdownOpen', !isSelectionBackgroundDropdownOpen)"
              >
                <span
                  class="color-swatch"
                  :style="{
                    background: appSettings.terminal.selectionBackground,
                  }"
                ></span>
                <span>{{ appSettings.terminal.selectionBackground }}</span>
              </button>

              <div v-if="isSelectionBackgroundDropdownOpen" class="color-select-menu">
                <button
                  v-for="color in selectionBackgroundOptions"
                  :key="color"
                  type="button"
                  class="color-select-option"
                  @click="emit('selectSelectionBackground', color)"
                >
                  <span class="color-swatch" :style="{ background: color }"></span>
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
              @update:model-value="emit('updateKeepaliveIntervalSeconds', $event)"
            />
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
              @update:model-value="emit('updateIdleDisconnectMinutes', $event)"
            />
          </div>

          <div class="settings-field">
            <div>
              <h3>SFTP 同时传输数量</h3>
              <p>上传、下载和服务器间传输共享该文件并发数；中转时每个文件最多占用两条连接。</p>
            </div>
            <AppSelect
              :model-value="String(appSettings.connection.sftpMaxConcurrentTransfers)"
              :options="sftpTransferConcurrencyOptions"
              ariaLabel="SFTP 同时传输数量"
              @update:model-value="emit('updateSftpMaxConcurrentTransfers', Number($event))"
            />
          </div>
        </section>

        <section
          v-else-if="activeSettingsSection === 'ai'"
          class="settings-content ai-settings-content"
        >
          <header class="settings-content-heading">
            <h1>AI</h1>
          </header>
          <div class="settings-field">
            <div>
              <h3>工作模式</h3>
              <p>
                普通模式以终端为主，不启用 AI；AI 模式以 AI 对话为主视图，SSH 在后台连接，可通过 AI
                助手标题栏的「打开 SSH」查看终端。
              </p>
            </div>
            <SegmentedControl
              :model-value="appSettings.ai.enabled"
              :options="workModeOptions"
              ariaLabel="工作模式"
              @update:model-value="emit('updateAiSetting', 'enabled', $event)"
            />
          </div>

          <div class="settings-field">
            <div>
              <h3>是否允许跨服务器执行操作</h3>
              <p>开启后，AI 可以请求操作其他已保存服务器；每次跨服务器命令仍需单独确认。</p>
            </div>
            <AppSwitch
              :model-value="appSettings.ai.allowCrossServerOperations"
              ariaLabel="是否允许跨服务器执行操作"
              @update:model-value="emit('updateAiSetting', 'allowCrossServerOperations', $event)"
            />
          </div>

          <div class="settings-field">
            <div>
              <h3>允许第三方 AI 通过 MCP 使用 SSH</h3>
              <p>
                默认关闭。开启后，本机第三方 AI 可使用已保存连接自由执行远程命令，不经过 OrbitSSH
                的命令策略和逐条审批，但不会获得密码或私钥。
              </p>
            </div>
            <AppSwitch
              :model-value="appSettings.ai.allowMcpAccess"
              ariaLabel="允许第三方 AI 通过 MCP 使用 SSH"
              @update:model-value="emit('updateAiSetting', 'allowMcpAccess', $event)"
            />
          </div>

          <div class="settings-field">
            <div>
              <h3>允许第三方 AI 通过 MCP 使用 SFTP</h3>
              <p>
                默认关闭。开启后，调用方可使用已保存连接在指定的本地路径和远程路径之间上传或下载单文件，完成后会覆盖同名目标文件。
              </p>
            </div>
            <AppSwitch
              :model-value="appSettings.ai.allowMcpSftpAccess"
              ariaLabel="允许第三方 AI 通过 MCP 使用 SFTP"
              @update:model-value="emit('updateAiSetting', 'allowMcpSftpAccess', $event)"
            />
          </div>

          <div
            class="settings-field settings-field-link"
            role="button"
            tabindex="0"
            aria-label="如何安装到 Agent"
            @click="openMcpInstallDialog"
            @keydown.enter="openMcpInstallDialog"
            @keydown.space.prevent="openMcpInstallDialog"
          >
            <div>
              <h3>如何安装到 Agent？</h3>
              <p>复制适配提示词，交给支持本地 MCP 的 AI 客户端完成配置。</p>
            </div>
            <span class="settings-row-arrow" aria-hidden="true">
              <img :src="chevronRightIcon" alt="" />
            </span>
          </div>

          <div
            class="settings-field settings-field-link"
            role="button"
            tabindex="0"
            aria-label="查看模型配置"
            @click="openAiConfigDialog"
            @keydown.enter="openAiConfigDialog"
            @keydown.space.prevent="openAiConfigDialog"
          >
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
            <AppSwitch
              :model-value="appSettings.ai.shareTerminalContext"
              ariaLabel="发送最近终端输出"
              @update:model-value="emit('updateAiSetting', 'shareTerminalContext', $event)"
            />
          </div>

          <div class="settings-field ai-preset-prompt-field">
            <div>
              <h3>预提示词</h3>
              <p>保存后仅对新建对话生效，已有对话继续使用创建时的内容。</p>
            </div>
            <textarea
              v-model="aiPresetPromptDraft"
              class="settings-text-input ai-preset-prompt-input"
              :maxlength="AI_PRESET_PROMPT_MAX_CHARS"
              placeholder="例如：回答前先说明判断依据，命令优先兼容 Debian。"
              aria-label="AI 预提示词"
            />
            <div class="ai-preset-prompt-actions">
              <span>{{ aiPresetPromptDraft.length }} / {{ AI_PRESET_PROMPT_MAX_CHARS }}</span>
              <button
                type="button"
                class="btn btn-primary"
                :disabled="!isAiPresetPromptDirty"
                @click="saveAiPresetPrompt"
              >
                保存
              </button>
            </div>
          </div>

          <div class="settings-field">
            <div>
              <h3>默认模式</h3>
              <p>{{ aiModeDescriptions[appSettings.ai.defaultMode] }}</p>
            </div>
            <SegmentedControl
              class="ai-mode-setting"
              :model-value="appSettings.ai.defaultMode"
              :options="aiModeSegmentedOptions"
              ariaLabel="默认模式"
              @update:model-value="emit('updateAiSetting', 'defaultMode', $event)"
            />
          </div>
        </section>

        <section v-else-if="activeSettingsSection === 'shortcuts'" class="settings-content">
          <header class="settings-content-heading">
            <h1>快捷键</h1>
          </header>
          <div v-for="section in shortcutSections" :key="section.id" class="shortcut-section">
            <header class="shortcut-section-header">
              <h3>{{ section.title }}</h3>
            </header>

            <div
              v-for="shortcut in section.shortcuts"
              :key="shortcut.id"
              class="settings-field shortcut-field"
            >
              <div>
                <h4>{{ shortcut.title }}</h4>
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
    </section>
  </Teleport>

  <McpInstallDialog :open="isMcpInstallDialogOpen" @close="isMcpInstallDialogOpen = false" />

  <AiModelConfigDialog
    :open="isAiConfigDialogOpen"
    :ai-settings="appSettings.ai"
    @close="isAiConfigDialogOpen = false"
    @update-ai-settings="emit('updateAiSettings', $event)"
  />
</template>
