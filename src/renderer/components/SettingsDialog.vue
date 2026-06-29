<script setup lang="ts">
import { computed } from "vue";
import type {
  AiSettings,
  AppSettings,
  AppThemeMode,
} from "../../shared/settings";
import { getShortcutSections } from "../config/shortcuts";
import AppDialog from "./AppDialog.vue";
import NumberStepper from "./NumberStepper.vue";
import AppSelect, { type AppSelectOption } from "./ui/AppSelect.vue";

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
  stepTerminalNumberSetting: [
    key: "fontSize" | "lineHeight",
    delta: number,
  ];
  updateKeepaliveIntervalSeconds: [value: number];
  updateIdleDisconnectMinutes: [value: number];
  updateAiSetting: [key: keyof AiSettings, value: AiSettings[keyof AiSettings]];
  updateThemeMode: [mode: AppThemeMode];
  selectSelectionBackground: [color: string];
}>();

const shortcutSections = computed(() => getShortcutSections(props.isMac));

const aiModeOptions: AiSettings["defaultMode"][] = [
  "ask",
  "auto",
  "full",
];

const aiModeLabels: Record<AiSettings["defaultMode"], string> = {
  ask: "每次询问",
  auto: "自动审批",
  full: "完全访问",
};

const aiProviderOptions: AppSelectOption[] = [
  { value: "deepseek", label: "DeepSeek" },
];
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
        class="settings-content">
        <div class="settings-field">
          <div>
            <h3>启用 AI</h3>
            <p>在 AI 助手面板中启用在线模型回答能力。</p>
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
            <span>{{ appSettings.ai.enabled ? "开启" : "关闭" }}</span>
          </label>
        </div>

        <div class="settings-field">
          <div>
            <h3>API 服务商</h3>
            <p>当前内置支持 DeepSeek，后续可扩展更多服务商。</p>
          </div>
          <AppSelect
            :model-value="appSettings.ai.provider"
            :options="aiProviderOptions"
            ariaLabel="API 服务商"
            @update:model-value="
              emit('updateAiSetting', 'provider', $event)
            " />
        </div>

        <div class="settings-field">
          <div>
            <h3>API 密钥</h3>
            <p>填写所选服务商的 API 密钥，仅保存在本地，不会写入日志。</p>
          </div>
          <input
            class="settings-text-input"
            type="password"
            autocomplete="off"
            :value="appSettings.ai.apiKey"
            placeholder="sk-..."
            @change="
              emit(
                'updateAiSetting',
                'apiKey',
                ($event.target as HTMLInputElement).value,
              )
            " />
        </div>

        <div class="settings-field">
          <div>
            <h3>模型</h3>
            <p>DeepSeek 默认可使用 deepseek-chat。</p>
          </div>
          <input
            class="settings-text-input"
            type="text"
            :value="appSettings.ai.model"
            placeholder="deepseek-chat"
            @change="
              emit(
                'updateAiSetting',
                'model',
                ($event.target as HTMLInputElement).value,
              )
            " />
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

      </section>

      <section
        v-else-if="activeSettingsSection === 'shortcuts'"
        class="settings-content shortcuts-settings-content">
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
  </AppDialog>
</template>
