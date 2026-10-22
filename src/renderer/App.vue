<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import "@xterm/xterm/css/xterm.css";

import ConnectionDialog from "./components/ConnectionDialog.vue";
import DataTransferDialog from "./components/DataTransferDialog.vue";
import DeleteConfirmDialog from "./components/DeleteConfirmDialog.vue";
import HostKeyPromptDialog from "./components/HostKeyPromptDialog.vue";
import ImagePreviewDialog from "./components/ImagePreviewDialog.vue";
import RemoteFileEditorDialog from "./components/RemoteFileEditorDialog.vue";
import ServerSidebar from "./components/ServerSidebar.vue";
import PortForwardDialog from "./components/PortForwardDialog.vue";
import AutomationSidebar from "./components/AutomationSidebar.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import UpdateDialog from "./components/UpdateDialog.vue";
import AiPanel from "./components/AiPanel.vue";
import SftpPanel from "./components/SftpPanel.vue";
import SftpPathPromptDialog from "./components/SftpPathPromptDialog.vue";
import TerminalPanel from "./components/TerminalPanel.vue";
import TitleBarTabs from "./components/TitleBarTabs.vue";
import TransferTaskDialog from "./components/TransferTaskDialog.vue";
import type { ServerConfig } from "../shared/server";
import type { AppMenuAction } from "../shared/app-menu";
import { storeToRefs } from "pinia";
import { useRemoteFileWorkspace } from "./composables/useRemoteFileWorkspace";
import { useSidebarPanels } from "./composables/useSidebarPanels";
import { useCoreStore } from "./stores/useCoreStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useWindowStore } from "./stores/useWindowStore";
import { useSidebarStore } from "./stores/useSidebarStore";
import { useDownloadsStore } from "./stores/useDownloadsStore";
import { useTerminalsStore } from "./stores/useTerminalsStore";
import { useServersStore } from "./stores/useServersStore";
import { useUpdateStore } from "./stores/useUpdateStore";
import { useAiStore } from "./stores/useAiStore";

const coreStore = useCoreStore();
const settingsStore = useSettingsStore();
const windowStore = useWindowStore();
const sidebarStore = useSidebarStore();
const downloadsStore = useDownloadsStore();
const terminalsStore = useTerminalsStore();
const serversStore = useServersStore();
const updateStore = useUpdateStore();
const aiStore = useAiStore();

const SERVER_OPEN_DEBOUNCE_MS = 3000;
const serverOpenAllowedAt = new Map<string, number>();
const deleteConfirmDialog = reactive({
  open: false,
  title: "确认删除",
  message: "",
  confirmLabel: "删除",
  danger: true,
});
const deleteConfirmResolver = ref<((confirmed: boolean) => void) | null>(null);
const appPlatform = ref("");
const isDataTransferDialogOpen = ref(false);
const isPortForwardDialogOpen = ref(false);
const isUpdateDialogOpen = ref(false);
let stopAppMenuListener: (() => void) | null = null;

// core：API 代理（响应式）+ 日志（普通函数）
const { orbitSSHApi } = storeToRefs(coreStore);
const writeRendererLog = coreStore.writeRendererLog;

// settings：appSettings 是 reactive 对象，直接取引用即保留响应性
const appSettings = settingsStore.appSettings;

// AI 模式（即开启 AI）以对话为主视图，左侧仅保留服务器列表。
const isAiWorkspace = computed(() => appSettings.ai.enabled);
const {
  sidebarPanelsElement,
  displayedSidebarPanels,
  draggedSidebarPanel,
  isLastSidebarPanel,
  getSidebarPanelStyle,
  refreshSidebarPanelsHeight,
  toggleSidebarPanel,
  isResizingSidebarPanel,
  startSidebarPanelResize,
  startSidebarPanelDrag,
  finishSidebarPanelDrag,
  clearSidebarPanelDrag,
} = useSidebarPanels({
  appSettings,
  isAiWorkspace,
  persist: () => void settingsStore.saveAppSettings(),
});
const selectionBackgroundOptions = settingsStore.selectionBackgroundOptions;
const { isSettingsDialogOpen, isSelectionBackgroundDropdownOpen, activeSettingsSection } =
  storeToRefs(settingsStore);
const {
  openSettingsDialog,
  closeSettingsDialog,
  stepTerminalNumberSetting,
  updateKeepaliveIntervalSeconds,
  updateIdleDisconnectMinutes,
  updateSftpMaxConcurrentTransfers,
  updateAiSetting,
  updateAiSettings,
  updateThemeMode,
  selectSelectionBackground,
} = settingsStore;

// update
const {
  status: updateStatus,
  currentVersion: updateCurrentVersion,
  newVersion: updateNewVersion,
  releaseDate: updateReleaseDate,
  releaseNotes: updateReleaseNotes,
  downloadProgress: updateDownloadProgress,
  error: updateError,
} = storeToRefs(updateStore);
const {
  init: initUpdate,
  destroy: destroyUpdate,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
} = updateStore;

// window
const { isWindowMaximized, isWindowFullScreen } = storeToRefs(windowStore);
const { minimizeWindow, toggleMaximizeWindow, closeWindow } = windowStore;

// sidebar
const { sidebarWidth, isResizingSidebar } = storeToRefs(sidebarStore);
const { startSidebarResize } = sidebarStore;

// downloads
const { isTaskListOpen, transferBatches, transferNodes, hasTransferTasks } =
  storeToRefs(downloadsStore);
const { controlManagedTask, isManagedTaskOperating } = downloadsStore;

const {
  servers,
  groups,
  isConnectionDialogOpen,
  formError,
  listError,
  editingServerId,
  isServerListLoading,
  isSubmittingServer,
  runtimeError,
  connectionForm,
  hasServers,
} = storeToRefs(serversStore);

const {
  openConnectionDialog,
  closeConnectionDialog,
  submitConnectionForm,
  selectPrivateKeyFile,
  editServer,
  createGroup,
  updateGroup,
  deleteGroup,
  moveServerToGroup,
  setServerColor,
  loadServers,
  setListError,
} = serversStore;

const {
  tabs,
  activeTabId,
  activeTab,
  isTerminalSearchOpen,
  isTerminalDialogOpen,
  isTerminalSearchCaseSensitive,
  terminalSearchKeyword,
  terminalSearchResult,
} = storeToRefs(terminalsStore);

const {
  mode: aiMode,
  inputText: aiInputText,
  isSending: isAiSending,
  error: aiError,
  messages: aiMessages,
  commandCards: aiCommandCards,
  contextUsage: aiContextUsage,
  shouldSuggestNewConversation,
  conversations: aiConversations,
  activeConversationId: aiActiveConversationId,
} = storeToRefs(aiStore);

const {
  setMode: setAiMode,
  setActiveTabId: setAiActiveTabId,
  startNewConversation: startNewAiConversation,
  switchConversation: switchAiConversation,
  deleteConversation: deleteAiConversation,
  removeTabSession: removeAiTabSession,
  sendMessage: sendAiMessage,
  runApprovedCommand: runAiApprovedCommand,
  rejectApproval: rejectAiApproval,
  cancelMessage: cancelAiMessage,
} = aiStore;

const {
  applyTerminalSettings,
  openTerminalSearch,
  closeTerminalSearch,
  searchActiveTerminal,
  toggleTerminalSearchCaseSensitive,
  hasActiveTerminalSelection,
  hasClipboardText,
  copyActiveTerminalSelection,
  pasteClipboardTextToActiveTerminal,
  setTerminalHost,
  scheduleTerminalFit,
  openServerTerminal: openTerminalFromStore,
  openLocalTerminal,
  activateTerminalTab,
  openTerminalDialog,
  closeTerminalTab: closeTerminalTabFromStore,
} = terminalsStore;

const {
  isImagePreviewOpen,
  isSftpPathPromptOpen,
  filePathInput,
  sftpPathPromptTitle,
  sftpPathPromptMessage,
  sftpTrees,
  fileContextMenu,
  blankContextMenu,
  renaming,
  fileDragTargetPath,
  imagePreview,
  loadSftpHome,
  removeSftpTree,
  closeSftpSession,
  markSftpDisconnected,
  closeFileContextMenu,
  closeBlankContextMenu,
  clearRemoteNodeDrag,
  downloadImagePreviewFile,
  closeImagePreview,
  isFileEditorOpen,
  isFileEditorCloseConfirmOpen,
  isFileEditorSearchOpen,
  isFileEditorSearchCaseSensitive,
  fileEditorError,
  fileEditorSearchKeyword,
  fileEditorReplaceText,
  fileEditor,
  isFileEditorDirty,
  fileEditorTitle,
  requestCloseFileEditor,
  saveFileEditor,
  saveAndCloseFileEditor,
  discardFileEditorChanges,
  undoFileEditor,
  redoFileEditor,
  applyFileEditorSearchQuery,
  openFileEditorSearch,
  closeFileEditorSearch,
  toggleFileEditorSearchCaseSensitive,
  searchFileEditor,
  replaceCurrentFileEditorMatch,
  replaceAllFileEditorMatches,
  applyFileEditorTheme,
  activeSftpTree,
  visibleFileTree,
  modifyTimeSortDirection,
  toggleModifyTimeSort,
  getFilePanelHint,
  canDownloadRemoteFile,
  getFileEditMenuLabel,
  isEditableTextFile,
  canDeleteRemoteNode,
  openFileContextMenu,
  handleFileSelectNode,
  handleFileSelectAll,
  handleFileClearSelection,
  handleFileMarqueeSelect,
  handleFileDragStart,
  handleFileDragOver,
  handleFileDragLeave,
  handleFileDrop,
  downloadContextFile,
  refreshActiveDirectory,
  closeSftpPathPrompt,
  submitFilePathInput,
  copyActiveSftpPath,
  syncFileTreeToTerminalPath,
  setFileTreeElement,
  setFileEditorContainer,
  setFileEditorSearchInput,
  setFileEditorReplaceInput,
  editContextFile,
  previewContextFile,
  openRemoteNodeByDoubleClick,
  deleteContextFile,
  handleOpenBlankContextMenu,
  renameContextFile,
  handleCommitRename,
  handleCancelRename,
  handleCreateBlankNode,
} = useRemoteFileWorkspace(requestConfirm);

const aiContext = computed(() => ({
  tabId: activeTabId.value,
  serverId: activeTab.value?.serverId ?? "",
  serverName: activeTab.value?.title,
  currentPath: activeTab.value?.currentPath,
  status: activeTab.value?.status,
  sftpPath: activeSftpTree.value?.homePath,
}));

function applyAppThemeMode(): void {
  document.documentElement.dataset.theme = appSettings.appearance.themeMode;
}

const isWindows = computed(() => appPlatform.value === "win32");
const isMac = computed(() => appPlatform.value === "darwin");

function handleGlobalKeydown(event: KeyboardEvent): void {
  const isSearchShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";

  if (isSearchShortcut) {
    event.preventDefault();
    event.stopPropagation();

    if (isFileEditorOpen.value) {
      void openFileEditorSearch();
      return;
    }

    // AI 模式下终端隐藏在后台，仅在 SSH 弹窗打开时响应终端搜索。
    if (isAiWorkspace.value && !isTerminalDialogOpen.value) {
      return;
    }

    void openTerminalSearch();
    return;
  }

  if (event.key === "Escape" && isTerminalSearchOpen.value) {
    event.preventDefault();
    void closeTerminalSearch();
  }
}

async function loadAppInfo(): Promise<void> {
  try {
    const info = await orbitSSHApi.value?.getAppInfo();
    appPlatform.value = info?.platform ?? "";
  } catch (error) {
    writeRendererLog("读取应用平台信息失败", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function requestConfirm(input: {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
}): Promise<boolean> {
  deleteConfirmDialog.title = input.title;
  deleteConfirmDialog.message = input.message;
  deleteConfirmDialog.confirmLabel = input.confirmLabel;
  deleteConfirmDialog.danger = input.danger;
  deleteConfirmDialog.open = true;

  return new Promise(resolve => {
    deleteConfirmResolver.value = resolve;
  });
}

function resolveDeleteConfirm(confirmed: boolean): void {
  deleteConfirmDialog.open = false;
  deleteConfirmDialog.title = "确认删除";
  deleteConfirmDialog.message = "";
  deleteConfirmDialog.confirmLabel = "删除";
  deleteConfirmDialog.danger = true;
  deleteConfirmResolver.value?.(confirmed);
  deleteConfirmResolver.value = null;
}

function openDataTransferDialog(): void {
  const tab = activeTab.value;

  if (tab && !activeSftpTree.value) {
    void loadSftpHome(tab);
  }

  isDataTransferDialogOpen.value = true;
}

function closeDataTransferDialog(): void {
  isDataTransferDialogOpen.value = false;
}

function openPortForwardDialog(): void {
  isPortForwardDialogOpen.value = true;
}

async function showAboutDialog(): Promise<void> {
  try {
    await orbitSSHApi.value?.about.show();
  } catch (error) {
    writeRendererLog("打开关于弹窗失败", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function openHelpFeedback(): Promise<void> {
  try {
    await orbitSSHApi.value?.help.openFeedback();
  } catch (error) {
    writeRendererLog("打开反馈页面失败", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function openHelpChangelog(): Promise<void> {
  try {
    await orbitSSHApi.value?.help.openChangelog();
  } catch (error) {
    writeRendererLog("打开更新日志失败", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function handleAppMenuAction(action: AppMenuAction): void {
  if (action === "undo") {
    if (!undoFileEditor()) {
      document.execCommand("undo");
    }
    return;
  }

  if (action === "redo") {
    if (!redoFileEditor()) {
      document.execCommand("redo");
    }
    return;
  }

  if (action === "open-settings") {
    openSettingsDialog();
    return;
  }

  if (action === "open-about") {
    void showAboutDialog();
    return;
  }

  if (action === "open-data-transfer") {
    openDataTransferDialog();
    return;
  }

  if (action === "open-port-forwards") {
    openPortForwardDialog();
    return;
  }

  if (action === "open-update") {
    isUpdateDialogOpen.value = true;
  }
}

async function deleteServer(serverId: string): Promise<void> {
  await serversStore.deleteServer(serverId, () =>
    requestConfirm({
      title: "删除服务器",
      message: "确认删除该服务器配置？",
      confirmLabel: "删除",
      danger: true,
    }),
  );
}

// 左侧服务器列表的置顶操作由 store 统一处理并持久化。
async function setServerPinned(server: ServerConfig): Promise<void> {
  await serversStore.setServerPinned(server);
}

async function openServerTerminal(server: ServerConfig): Promise<void> {
  const now = Date.now();
  const allowedAt = serverOpenAllowedAt.get(server.id) ?? 0;

  // 同一服务器 3 秒内重复点击只响应第一次，避免并发创建重复会话。
  if (allowedAt > now) {
    return;
  }

  serverOpenAllowedAt.set(server.id, now + SERVER_OPEN_DEBOUNCE_MS);

  try {
    await openTerminalFromStore(server, {
      afterOpen: tab => {
        void loadSftpHome(tab);
      },
    });
  } catch (error) {
    serverOpenAllowedAt.delete(server.id);
    setListError(error instanceof Error ? error.message : "打开终端失败");
  }
}

async function closeTerminalTab(tabId: string): Promise<void> {
  await closeTerminalTabFromStore(tabId, {
    beforeClose: async closedTabId => {
      await closeSftpSession(closedTabId);
    },
    afterClose: closedTabId => {
      removeSftpTree(closedTabId);
      removeAiTabSession(closedTabId);
    },
  });
}

// 批量操作按标签顺序逐个关闭，避免多个会话同时清理时相互覆盖激活状态。
async function closeTerminalTabs(tabIds: string[]): Promise<void> {
  for (const tabId of tabIds) {
    try {
      await closeTerminalTab(tabId);
    } catch (error) {
      coreStore.writeRendererLog(
        "批量关闭终端失败",
        { tabId, error: error instanceof Error ? error.message : String(error) },
        "warn",
      );
    }
  }
}

// 窗口尺寸变化（含最大化/还原）后重新 fit 终端。
function handleWindowResize(): void {
  refreshSidebarPanelsHeight();
  scheduleTerminalFit();
}

// 设置变更（含初始加载）后应用到终端；选区色变化时同步刷新 CodeMirror 主题。
// 原 updateTerminalSetting/loadAppSettings 内联的副作用改由这里统一协调。
watch(
  () => ({ ...appSettings.terminal }),
  (cur, prev) => {
    applyTerminalSettings();

    if (cur.selectionBackground !== prev?.selectionBackground) {
      applyFileEditorTheme();
    }
  },
);

watch(
  () => appSettings.appearance.themeMode,
  () => {
    applyAppThemeMode();
    applyTerminalSettings();
    applyFileEditorTheme();
  },
  { immediate: true },
);

// 侧边栏拖动改变终端区宽度，需重新 fit（store 内不反向依赖终端域）。
watch(sidebarWidth, () => {
  scheduleTerminalFit();
});

// 切换普通/AI 模式会改变左侧面板与终端所在区域，需要重新计算侧栏高度。
watch(isAiWorkspace, async () => {
  await nextTick();
  refreshSidebarPanelsHeight();
});

watch(
  tabs,
  currentTabs => {
    currentTabs.forEach(tab => {
      if (tab.status === "disconnected" || tab.status === "error") {
        markSftpDisconnected(tab.id);
        return;
      }

      // 终端重连成功后恢复主 SFTP 会话，避免左侧停留在断开空态。
      if (tab.status === "connected" && sftpTrees.value[tab.id]?.disconnected) {
        void loadSftpHome(tab);
      }
    });
  },
  { deep: true },
);

// AI 面板跟随当前终端标签页切换，确保不同服务器的对话历史互相隔离。
// 同时携带 serverId，用于按服务器加载持久化的 AI 历史对话。
watch(
  activeTab,
  tab => {
    setAiActiveTabId(tab?.id ?? "", tab?.serverId ?? "");
  },
  { immediate: true },
);

onMounted(() => {
  writeRendererLog("Renderer mounted", {
    hasOrbitSSHApi: Boolean(orbitSSHApi.value),
  });
  void loadServers();
  void settingsStore.loadAppSettings();
  void loadAppInfo();
  void windowStore.initMaximized();
  void windowStore.initFullScreen();
  windowStore.startFullScreenListener();
  downloadsStore.startListeners();
  terminalsStore.startListeners();
  void openLocalTerminal().catch(error => {
    writeRendererLog(
      "默认本地终端打开失败",
      { error: error instanceof Error ? error.message : String(error) },
      "error",
    );
  });
  stopAppMenuListener = orbitSSHApi.value?.appMenu.onAction(handleAppMenuAction) ?? null;
  initUpdate();

  window.addEventListener("resize", handleWindowResize);
  window.addEventListener("keydown", handleGlobalKeydown);
});

onUnmounted(() => {
  terminalsStore.cleanup();
  downloadsStore.stopListeners();
  windowStore.stopFullScreenListenerWatch();
  stopAppMenuListener?.();
  stopAppMenuListener = null;
  destroyUpdate();
  window.removeEventListener("resize", handleWindowResize);
  window.removeEventListener("keydown", handleGlobalKeydown);
  sidebarStore.stopSidebarResize();
});
</script>

<template>
  <main class="app-shell">
    <TitleBarTabs
      :is-window-maximized="isWindowMaximized"
      :is-window-full-screen="isWindowFullScreen"
      :is-windows="isWindows"
      :is-mac="isMac"
      :has-transfer-tasks="hasTransferTasks"
      @open-transfer-tasks="isTaskListOpen = true"
      @open-data-transfer="openDataTransferDialog"
      @open-port-forwards="openPortForwardDialog"
      @open-settings="openSettingsDialog"
      @open-update="isUpdateDialogOpen = true"
      @open-about="showAboutDialog"
      @open-feedback="openHelpFeedback"
      @open-changelog="openHelpChangelog"
      @minimize-window="minimizeWindow"
      @toggle-maximize-window="toggleMaximizeWindow"
      @close-window="closeWindow"
    />

    <TransferTaskDialog
      :open="isTaskListOpen"
      :batches="transferBatches"
      :nodes="transferNodes"
      :is-operating="isManagedTaskOperating"
      @close="isTaskListOpen = false"
      @control="controlManagedTask"
    />

    <PortForwardDialog
      :open="isPortForwardDialogOpen"
      :servers="servers"
      @close="isPortForwardDialogOpen = false"
    />

    <div class="content-shell" :style="{ '--sidebar-width': `${sidebarWidth}px` }">
      <aside ref="sidebarPanelsElement" class="sidebar">
        <template v-for="panel in displayedSidebarPanels" :key="panel">
          <div
            :draggable="!isAiWorkspace"
            :class="[
              'sidebar-panel-slot',
              `sidebar-panel-slot-${panel}`,
              {
                collapsed: !isAiWorkspace && appSettings.sidebar[panel].collapsed,
                'is-last': isAiWorkspace || isLastSidebarPanel(panel),
                dragging: draggedSidebarPanel === panel,
              },
            ]"
            :style="isAiWorkspace ? undefined : getSidebarPanelStyle(panel)"
            @dragstart="startSidebarPanelDrag($event, panel)"
            @dragover.prevent
            @drop="finishSidebarPanelDrag($event, panel)"
            @dragend="clearSidebarPanelDrag"
          >
            <ServerSidebar
              v-if="panel === 'servers'"
              :servers="servers"
              :groups="groups"
              :runtime-error="runtimeError"
              :is-server-list-loading="isServerListLoading"
              :list-error="listError"
              :has-servers="hasServers"
              :active-server-id="activeTab?.serverId ?? ''"
              :collapsed="!isAiWorkspace && appSettings.sidebar.servers.collapsed"
              @open-connection-dialog="openConnectionDialog"
              @open-server-terminal="openServerTerminal"
              @edit-server="editServer"
              @create-group="createGroup"
              @update-group="updateGroup"
              @delete-group="deleteGroup"
              @move-server-to-group="moveServerToGroup"
              @set-server-color="setServerColor"
              @set-server-pinned="setServerPinned"
              @delete-server="deleteServer"
              @toggle-collapsed="!isAiWorkspace && toggleSidebarPanel('servers')"
            />

            <AutomationSidebar
              v-else-if="panel === 'automation'"
              :active-tab="activeTab"
              :collapsed="appSettings.sidebar.automation.collapsed"
              @toggle-collapsed="toggleSidebarPanel('automation')"
            />

            <SftpPanel
              v-else
              :active-tab="activeTab"
              :active-sftp-tree="activeSftpTree"
              :visible-file-tree="visibleFileTree"
              :modify-time-sort-direction="modifyTimeSortDirection"
              :file-context-menu="fileContextMenu"
              :blank-context-menu="blankContextMenu"
              :renaming="renaming"
              :file-drag-target-path="fileDragTargetPath"
              :file-path-input="filePathInput"
              :file-panel-hint="getFilePanelHint()"
              :file-tree-element-ref="setFileTreeElement"
              :is-editable-text-file="isEditableTextFile"
              :get-file-edit-menu-label="getFileEditMenuLabel"
              :can-download-remote-file="canDownloadRemoteFile"
              :can-delete-remote-node="canDeleteRemoteNode"
              :collapsed="appSettings.sidebar.remoteFiles.collapsed"
              @update:file-path-input="filePathInput = $event"
              @refresh="refreshActiveDirectory"
              @submit-path="submitFilePathInput"
              @copy-path="copyActiveSftpPath"
              @sync-path="syncFileTreeToTerminalPath"
              @toggle-modify-time-sort="toggleModifyTimeSort"
              @open-context-menu="openFileContextMenu"
              @open-blank-context-menu="handleOpenBlankContextMenu"
              @close-file-context-menu="closeFileContextMenu"
              @close-blank-context-menu="closeBlankContextMenu"
              @select-node="handleFileSelectNode"
              @select-all="handleFileSelectAll"
              @clear-selection="handleFileClearSelection"
              @marquee-select="handleFileMarqueeSelect"
              @drag-start-node="handleFileDragStart"
              @drag-over-node="handleFileDragOver"
              @drag-leave-node="handleFileDragLeave"
              @drop-node="handleFileDrop"
              @drag-end-node="clearRemoteNodeDrag"
              @open-file-by-double-click="openRemoteNodeByDoubleClick"
              @preview-context-file="previewContextFile"
              @edit-context-file="editContextFile"
              @download-context-file="downloadContextFile"
              @rename-context-file="renameContextFile"
              @delete-context-file="deleteContextFile"
              @commit-rename="handleCommitRename"
              @cancel-rename="handleCancelRename"
              @create-blank-node="handleCreateBlankNode"
              @toggle-collapsed="toggleSidebarPanel('remoteFiles')"
            />
          </div>

          <div
            v-if="!isAiWorkspace && !isLastSidebarPanel(panel)"
            :class="[
              'sidebar-panel-resizer',
              {
                active: isResizingSidebarPanel(panel),
              },
            ]"
            role="separator"
            aria-orientation="horizontal"
            :aria-label="`调整${panel === 'servers' ? '服务器' : panel === 'automation' ? '自定义指令' : '远程文件'}面板高度`"
            @pointerdown="startSidebarPanelResize($event, panel)"
          ></div>
        </template>
      </aside>

      <div
        :class="['sidebar-resizer', { active: isResizingSidebar }]"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        @mousedown="startSidebarResize"
      ></div>

      <TerminalPanel
        :ai-workspace="isAiWorkspace"
        :tabs="tabs"
        :active-tab-id="activeTabId"
        :is-terminal-search-open="isTerminalSearchOpen"
        :is-terminal-search-case-sensitive="isTerminalSearchCaseSensitive"
        :terminal-search-keyword="terminalSearchKeyword"
        :terminal-search-result="terminalSearchResult"
        :set-terminal-host="setTerminalHost"
        :has-active-terminal-selection="hasActiveTerminalSelection"
        :has-clipboard-text="hasClipboardText"
        :copy-active-terminal-selection="copyActiveTerminalSelection"
        :paste-clipboard-text-to-active-terminal="pasteClipboardTextToActiveTerminal"
        @activate-tab="activateTerminalTab"
        @close-tab="closeTerminalTab"
        @close-tabs="closeTerminalTabs"
        @update:terminal-search-keyword="terminalSearchKeyword = $event"
        @search="searchActiveTerminal"
        @toggle-case-sensitive="toggleTerminalSearchCaseSensitive"
        @close-search="closeTerminalSearch"
        @open-connection-dialog="openConnectionDialog"
      >
        <AiPanel
          layout="workspace"
          :open="true"
          :enabled="appSettings.ai.enabled"
          :mode="aiMode"
          :input-text="aiInputText"
          :is-sending="isAiSending"
          :error="aiError"
          :messages="aiMessages"
          :command-cards="aiCommandCards"
          :context-usage="aiContextUsage"
          :should-suggest-new-conversation="shouldSuggestNewConversation"
          :conversations="aiConversations"
          :active-conversation-id="aiActiveConversationId"
          :context="aiContext"
          :configs="appSettings.ai.configs"
          :active-config-id="appSettings.ai.activeConfigId"
          @set-mode="setAiMode"
          @update-input-text="aiInputText = $event"
          @send="sendAiMessage(aiContext)"
          @stop="cancelAiMessage(aiContext)"
          @start-new-conversation="startNewAiConversation(activeTabId)"
          @switch-conversation="switchAiConversation($event)"
          @delete-conversation="deleteAiConversation($event)"
          @run-approved="runAiApprovedCommand"
          @reject-approval="rejectAiApproval"
          @select-model="updateAiSetting('activeConfigId', $event)"
          @open-ssh="openTerminalDialog(activeTabId)"
        />
      </TerminalPanel>
    </div>

    <ConnectionDialog
      :open="isConnectionDialogOpen"
      :editing-server-id="editingServerId"
      :connection-form="connectionForm"
      :form-error="formError"
      :is-submitting-server="isSubmittingServer"
      @close="closeConnectionDialog"
      @submit="submitConnectionForm"
      @select-private-key="selectPrivateKeyFile"
    />

    <DataTransferDialog
      v-if="isDataTransferDialogOpen"
      :servers="servers"
      :is-mac="isMac"
      :active-source="
        activeTab
          ? {
              serverId: activeTab.serverId,
              currentPath: activeSftpTree?.homePath ?? activeTab.currentPath,
            }
          : undefined
      "
      @close="closeDataTransferDialog"
    />

    <ImagePreviewDialog
      :open="isImagePreviewOpen"
      :image-preview="imagePreview"
      @close="closeImagePreview"
      @download="downloadImagePreviewFile"
    />

    <RemoteFileEditorDialog
      :is-open="isFileEditorOpen"
      :is-close-confirm-open="isFileEditorCloseConfirmOpen"
      :title="fileEditorTitle"
      :is-search-open="isFileEditorSearchOpen"
      :is-search-case-sensitive="isFileEditorSearchCaseSensitive"
      :search-keyword="fileEditorSearchKeyword"
      :replace-text="fileEditorReplaceText"
      :editor="fileEditor"
      :error="fileEditorError"
      :is-dirty="isFileEditorDirty"
      :set-editor-container="setFileEditorContainer"
      :set-search-input="setFileEditorSearchInput"
      :set-replace-input="setFileEditorReplaceInput"
      @request-close="requestCloseFileEditor"
      @update-close-confirm-open="isFileEditorCloseConfirmOpen = $event"
      @update-search-keyword="fileEditorSearchKeyword = $event"
      @update-replace-text="fileEditorReplaceText = $event"
      @search="searchFileEditor"
      @apply-search-query="applyFileEditorSearchQuery"
      @replace-current="replaceCurrentFileEditorMatch"
      @replace-all="replaceAllFileEditorMatches"
      @toggle-case-sensitive="toggleFileEditorSearchCaseSensitive"
      @close-search="closeFileEditorSearch"
      @save="saveFileEditor"
      @discard="discardFileEditorChanges"
      @save-and-close="saveAndCloseFileEditor"
    />

    <SftpPathPromptDialog
      :open="isSftpPathPromptOpen"
      :title="sftpPathPromptTitle"
      :message="sftpPathPromptMessage"
      @close="closeSftpPathPrompt"
    />

    <DeleteConfirmDialog
      :open="deleteConfirmDialog.open"
      :title="deleteConfirmDialog.title"
      :message="deleteConfirmDialog.message"
      :confirm-label="deleteConfirmDialog.confirmLabel"
      :danger="deleteConfirmDialog.danger"
      @cancel="resolveDeleteConfirm(false)"
      @confirm="resolveDeleteConfirm(true)"
    />

    <SettingsDialog
      :open="isSettingsDialogOpen"
      :app-settings="appSettings"
      :active-settings-section="activeSettingsSection"
      :is-mac="isMac"
      :is-selection-background-dropdown-open="isSelectionBackgroundDropdownOpen"
      :selection-background-options="selectionBackgroundOptions"
      @close="closeSettingsDialog"
      @update-active-section="activeSettingsSection = $event"
      @update-selection-dropdown-open="isSelectionBackgroundDropdownOpen = $event"
      @step-terminal-number-setting="stepTerminalNumberSetting"
      @update-keepalive-interval-seconds="updateKeepaliveIntervalSeconds"
      @update-idle-disconnect-minutes="updateIdleDisconnectMinutes"
      @update-sftp-max-concurrent-transfers="updateSftpMaxConcurrentTransfers"
      @update-ai-setting="updateAiSetting"
      @update-ai-settings="updateAiSettings"
      @update-theme-mode="updateThemeMode"
      @select-selection-background="selectSelectionBackground"
    />

    <UpdateDialog
      :open="isUpdateDialogOpen"
      :status="updateStatus"
      :current-version="updateCurrentVersion"
      :new-version="updateNewVersion"
      :release-date="updateReleaseDate"
      :release-notes="updateReleaseNotes"
      :download-progress="updateDownloadProgress"
      :error="updateError"
      @close="isUpdateDialogOpen = false"
      @check="checkForUpdates"
      @download="downloadUpdate"
      @install="installUpdate"
    />

    <HostKeyPromptDialog />
  </main>
</template>
