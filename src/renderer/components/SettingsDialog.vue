<script setup lang="ts">
import { computed } from "vue";
import type {
  AppSettings,
  AppThemeMode,
  SftpFileTreeViewMode,
} from "../../shared/settings";
import { getShortcutSections } from "../config/shortcuts";
import AppDialog from "./AppDialog.vue";

const props = defineProps<{
  open: boolean;
  appSettings: AppSettings;
  activeSettingsSection: "general" | "shortcuts";
  isMac: boolean;
  isSelectionBackgroundDropdownOpen: boolean;
  selectionBackgroundOptions: string[];
}>();

const emit = defineEmits<{
  close: [];
  updateActiveSection: [section: "general" | "shortcuts"];
  updateSelectionDropdownOpen: [open: boolean];
  stepTerminalNumberSetting: [
    key: "fontSize" | "lineHeight",
    delta: number,
  ];
  updateSftpFileTreeViewMode: [mode: SftpFileTreeViewMode];
  updateThemeMode: [mode: AppThemeMode];
  selectSelectionBackground: [color: string];
}>();

// 快捷键页只负责展示当前已生效的快捷键，后续可在同一数据源上扩展编辑能力。
const shortcutSections = computed(() => getShortcutSections(props.isMac));
</script>

<template>
  <AppDialog
    v-if="open"
    title="设置"
    :description="
      activeSettingsSection === 'shortcuts'
        ? '查看当前应用已启用的快捷键。'
        : '调整应用常规选项。'
    "
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
          常规设置
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
            <h3>主题外观</h3>
            <p>切换应用界面的深色或浅色配色。</p>
          </div>
          <div class="theme-mode-control" aria-label="主题外观">
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
            <h3>终端文字字号</h3>
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
            <p>调整终端每行文字的垂直间距。</p>
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
            <h3>终端选区背景</h3>
            <p>选择终端文本选中时的背景颜色。</p>
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
            <h3>SFTP 文件列表</h3>
            <p>切换远程文件区域的目录展示方式。</p>
          </div>
          <div class="file-view-mode-control" aria-label="SFTP 文件列表展示方式">
            <button
              type="button"
              :class="[
                'file-view-mode-option',
                {
                  active:
                    appSettings.sftp.fileTreeViewMode ===
                    'current-directory',
                },
              ]"
              @click="emit('updateSftpFileTreeViewMode', 'current-directory')">
              <span class="file-view-mode-title">当前层</span>
              <span class="file-view-mode-desc">双击进入目录</span>
            </button>
            <button
              type="button"
              :class="[
                'file-view-mode-option',
                { active: appSettings.sftp.fileTreeViewMode === 'tree' },
              ]"
              @click="emit('updateSftpFileTreeViewMode', 'tree')">
              <span class="file-view-mode-title">树形</span>
              <span class="file-view-mode-desc">展开多级目录</span>
            </button>
          </div>
        </div>
      </section>

      <section v-else class="settings-content shortcuts-settings-content">
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
