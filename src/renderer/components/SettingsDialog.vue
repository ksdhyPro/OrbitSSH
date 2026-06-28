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
</script>

<template>
  <AppDialog
    v-if="open"
    title="Settings"
    description="Adjust application preferences."
    width="large"
    @close="emit('close')">
    <div class="settings-layout">
      <aside class="settings-nav" aria-label="Settings sections">
        <button
          type="button"
          :class="[
            'settings-nav-item',
            { active: activeSettingsSection === 'general' },
          ]"
          @click="emit('updateActiveSection', 'general')">
          General
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
          Shortcuts
        </button>
      </aside>

      <section
        v-if="activeSettingsSection === 'general'"
        class="settings-content">
        <div class="settings-field">
          <div>
            <h3>Theme</h3>
            <p>Switch between dark and light appearance.</p>
          </div>
          <div class="theme-mode-control" aria-label="Theme">
            <button
              type="button"
              :class="[
                'theme-mode-option',
                { active: appSettings.appearance.themeMode === 'dark' },
              ]"
              @click="emit('updateThemeMode', 'dark')">
              Dark
            </button>
            <button
              type="button"
              :class="[
                'theme-mode-option',
                { active: appSettings.appearance.themeMode === 'light' },
              ]"
              @click="emit('updateThemeMode', 'light')">
              Light
            </button>
          </div>
        </div>

        <div class="settings-field">
          <div>
            <h3>Terminal font size</h3>
            <p>Controls the font size for current and future terminals.</p>
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
            <h3>Terminal line height</h3>
            <p>Adjust vertical spacing between terminal rows.</p>
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
            <h3>Selection color</h3>
            <p>Choose the terminal selection background color.</p>
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
            <h3>SSH keepalive seconds</h3>
            <p>0 disables SSH and SFTP keepalive packets.</p>
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
            <h3>Idle disconnect minutes</h3>
            <p>0 disables idle disconnect.</p>
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
            <h3>AI enabled</h3>
            <p>Enable OpenAI-backed answers in the assistant panel.</p>
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
            <span>{{ appSettings.ai.enabled ? "On" : "Off" }}</span>
          </label>
        </div>

        <div class="settings-field">
          <div>
            <h3>OpenAI API key</h3>
            <p>Stored locally and never written to logs.</p>
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
            <h3>Model</h3>
            <p>Model name used with the Responses API.</p>
          </div>
          <input
            class="settings-text-input"
            type="text"
            :value="appSettings.ai.model"
            placeholder="gpt-5-mini"
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
            <h3>Default mode</h3>
            <p>Initial AI permission mode.</p>
          </div>
          <div class="theme-mode-control ai-mode-setting">
            <button
              v-for="item in ['suggest', 'readonly', 'approval']"
              :key="item"
              type="button"
              :class="[
                'theme-mode-option',
                { active: appSettings.ai.defaultMode === item },
              ]"
              @click="emit('updateAiSetting', 'defaultMode', item)">
              {{ item }}
            </button>
          </div>
        </div>

        <div class="settings-field">
          <div>
            <h3>Readonly auto-run</h3>
            <p>Auto-run allowlisted readonly commands in Readonly mode.</p>
          </div>
          <label class="settings-toggle">
            <input
              type="checkbox"
              :checked="appSettings.ai.allowReadonlyAutoRun"
              @change="
                emit(
                  'updateAiSetting',
                  'allowReadonlyAutoRun',
                  ($event.target as HTMLInputElement).checked,
                )
              " />
            <span>{{
              appSettings.ai.allowReadonlyAutoRun ? "On" : "Off"
            }}</span>
          </label>
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
