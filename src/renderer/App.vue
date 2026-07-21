<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import "@xterm/xterm/css/xterm.css";

import AboutDialog from "./components/AboutDialog.vue";
import ConnectionDialog from "./components/ConnectionDialog.vue";
import DataTransferDialog from "./components/DataTransferDialog.vue";
import DeleteConfirmDialog from "./components/DeleteConfirmDialog.vue";
import ImagePreviewDialog from "./components/ImagePreviewDialog.vue";
import FilePermissionDialog from "./components/FilePermissionDialog.vue";
import RemoteFileEditorDialog from "./components/RemoteFileEditorDialog.vue";
import ServerSidebar from "./components/ServerSidebar.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import UpdateDialog from "./components/UpdateDialog.vue";
import AiPanel from "./components/AiPanel.vue";
import SftpPanel from "./components/SftpPanel.vue";
import SftpPathPromptDialog from "./components/SftpPathPromptDialog.vue";
import TerminalPanel from "./components/TerminalPanel.vue";
import TitleBarTabs from "./components/TitleBarTabs.vue";
import type { ServerConfig } from "../shared/server";
import type { AppMenuAction } from "../shared/app-menu";
import type { AiSettings } from "../shared/settings";
import { storeToRefs } from "pinia";
import { useRemoteFileWorkspace } from "./composables/useRemoteFileWorkspace";
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
const isUpdateDialogOpen = ref(false);
const isAboutDialogOpen = ref(false);
let stopAppMenuListener: (() => void) | null = null;

// core：API 代理（响应式）+ 日志（普通函数）
const { orbitSSHApi } = storeToRefs(coreStore);
const writeRendererLog = coreStore.writeRendererLog;

// settings：appSettings 是 reactive 对象，直接取引用即保留响应性
const appSettings = settingsStore.appSettings;
const selectionBackgroundOptions = settingsStore.selectionBackgroundOptions;
const {
  isSettingsDialogOpen,
  isSelectionBackgroundDropdownOpen,
  activeSettingsSection,
} = storeToRefs(settingsStore);
const {
  openSettingsDialog,
  closeSettingsDialog,
  stepTerminalNumberSetting,
  updateKeepaliveIntervalSeconds,
  updateIdleDisconnectMinutes,
  updateOpenLocalTerminalOnStartup,
  updateAiSetting,
  updateAiSettings,
  updateAiModelReasoning,
  updateThemeMode,
  selectSelectionBackground,
} = settingsStore;

async function handleUpdateAiSettings(
  value: AiSettings,
  onComplete?: (saved: boolean) => void,
): Promise<void> {
  let saved = false;
  try {
    saved = await updateAiSettings(value);
  } catch (error) {
    writeRendererLog(
      "Failed to update AI settings",
      { error: error instanceof Error ? error.message : String(error) },
      "error",
    );
  } finally {
    onComplete?.(saved);
  }
}

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
const {
  sidebarWidth,
  isResizingSidebar,
  aiPanelWidth,
  isResizingAiPanel,
} = storeToRefs(sidebarStore);
const {
  startSidebarResize,
  startAiPanelResize,
  clampAiPanelWidth,
} = sidebarStore;

// downloads
const {
  isTaskListOpen,
  activeDownloadCount,
  visibleDownloadTasks,
} = storeToRefs(downloadsStore);
const {
  controlDownloadTask,
  isDownloadTaskOperating,
} = downloadsStore;

const {
  servers,
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
  loadServers,
  setListError,
} = serversStore;

const {
  tabs,
  activeTabId,
  activeTab,
  isTerminalSearchOpen,
  isTerminalSearchCaseSensitive,
  terminalSearchKeyword,
  terminalSearchResult,
} = storeToRefs(terminalsStore);

const {
  isPanelOpen: isAiPanelOpen,
  mode: aiMode,
  inputText: aiInputText,
  isSending: isAiSending,
  error: aiError,
  pendingAttachments: aiAttachments,
  attachmentModelName: aiAttachmentModelName,
  messages: aiMessages,
  commandCards: aiCommandCards,
  shouldSuggestNewConversation,
  conversations: aiConversations,
  activeConversationId: aiActiveConversationId,
  activeConversationServerName: aiConversationServerName,
  conversationContextReady: aiConversationContextReady,
} = storeToRefs(aiStore);

const {
  togglePanel: toggleAiPanel,
  setMode: setAiMode,
  setActiveTabId: setAiActiveTabId,
  getConversation: getAiConversation,
  activateConversation: activateAiConversation,
  renameConversation: renameAiConversation,
  deleteConversation: deleteAiConversationFromStore,
  startNewConversation: startNewAiConversation,
  removeTabSession: removeAiTabSession,
  sendMessage: sendAiMessage,
  runApprovedCommand: runAiApprovedCommand,
  rejectApproval: rejectAiApproval,
  cancelMessage: cancelAiMessage,
  addAttachments: addAiAttachments,
  removeAttachment: removeAiAttachment,
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
  filePermissionDialog,
  loadSftpHome,
  removeSftpTree,
  closeSftpSession,
  markSftpDisconnected,
  closeFileContextMenu,
  closeBlankContextMenu,
  clearRemoteNodeDrag,
  downloadImagePreviewFile,
  closeImagePreview,
  closeFilePermissionDialog,
  saveFilePermissions,
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
  getFilePanelHint,
  canDownloadRemoteFile,
  canUploadRemoteNode,
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
  uploadContextFile,
  uploadToActiveSftpDirectory,
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
  openContextFilePermissions,
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
  serverId: activeTab.value?.serverId,
  serverName: activeTab.value?.title,
  currentPath: activeTab.value?.currentPath,
  status: activeTab.value?.status,
  sftpPath: activeSftpTree.value?.homePath,
}));

async function selectAiConversation(conversationId: string): Promise<void> {
  const conversation = getAiConversation(conversationId);
  if (!conversation) return;

  // 优先回到历史会话原来绑定的 Tab；只有已解绑的历史会话才按服务器寻找可用 Tab。
  const existingTab = tabs.value.find(
    tab => tab.id === conversation.tabId,
  );
  const associatedTab = conversation.tabId ? existingTab : undefined;
  const fallbackTab = conversation.tabId
    ? undefined
    : tabs.value.find(tab => tab.serverId === conversation.serverId);
  const connectedTab = associatedTab?.status === "connected"
    ? associatedTab
    : fallbackTab?.status === "connected"
      ? fallbackTab
      : undefined;
  if (connectedTab) {
    await activateTerminalTab(connectedTab.id);
    activateAiConversation(conversationId);
    return;
  }

  const shouldConnect = await requestConfirm({
    title: "连接会话服务器",
    message: `会话“${conversation.title}”关联的服务器“${conversation.serverName || "未知服务器"}”当前未连接，是否打开终端并连接？`,
    confirmLabel: "打开并连接",
    danger: false,
  });
  if (!shouldConnect) return;

  const reconnectTab = associatedTab ?? fallbackTab;
  if (reconnectTab) {
    await activateTerminalTab(reconnectTab.id);
    if (["disconnected", "error"].includes(reconnectTab.status)) {
      await terminalsStore.reconnectTerminal(reconnectTab.id);
    }
    activateAiConversation(conversationId);
    return;
  }

  const server = servers.value.find(item => item.id === conversation.serverId);
  if (!server) {
    setListError("该会话关联的服务器配置已不存在");
    return;
  }

  try {
    await openTerminalFromStore(server, {
      afterOpen: tab => {
        void loadSftpHome(tab);
      },
    });
    activateAiConversation(conversationId);
  } catch (error) {
    setListError(error instanceof Error ? error.message : "打开会话服务器失败");
  }
}

function renameAiConversationById(
  conversationId: string,
  title: string,
): void {
  renameAiConversation(conversationId, title);
}

async function deleteAiConversation(conversationId: string): Promise<void> {
  const conversation = getAiConversation(conversationId);
  if (!conversation) return;

  const hasBlockingTask = conversation.commandCards.some(card =>
    ["pending", "running", "requires_approval"].includes(card.status),
  );
  if (
    hasBlockingTask ||
    (conversationId === aiActiveConversationId.value && isAiSending.value)
  ) {
    aiError.value = "该会话仍有正在执行或等待确认的任务，暂时无法删除。";
    return;
  }

  const confirmed = await requestConfirm({
    title: "删除会话",
    message: `确定删除会话“${conversation.title}”吗？删除后无法恢复。`,
    confirmLabel: "删除",
    danger: true,
  });
  if (!confirmed) return;

  deleteAiConversationFromStore(conversationId);
}

function applyAppThemeMode(): void {
  document.documentElement.dataset.theme = appSettings.appearance.themeMode;
}

const isWindows = computed(() => appPlatform.value === "win32");
const isMac = computed(() => appPlatform.value === "darwin");

function handleGlobalKeydown(event: KeyboardEvent): void {
  const isSearchShortcut =
    (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";

  if (isSearchShortcut) {
    event.preventDefault();
    event.stopPropagation();

    if (isFileEditorOpen.value) {
      void openFileEditorSearch();
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
    isAboutDialogOpen.value = true;
    return;
  }

  if (action === "open-data-transfer") {
    openDataTransferDialog();
    return;
  }

  if (action === "open-update") {
    isUpdateDialogOpen.value = true;
  }
}

async function deleteServer(serverId: string): Promise<void> {
  await serversStore.deleteServer(serverId, () =>
    window.confirm("确认删除该服务器配置？"),
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

// 窗口尺寸变化（含最大化/还原）后重新 fit 终端。
function handleWindowResize(): void {
  aiPanelWidth.value = clampAiPanelWidth(aiPanelWidth.value);
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
  aiPanelWidth.value = clampAiPanelWidth(aiPanelWidth.value);
  scheduleTerminalFit();
});

// AI 面板宽度或折叠状态变化都会改变终端可用宽度，需要重新 fit。
watch([aiPanelWidth, isAiPanelOpen], () => {
  scheduleTerminalFit();
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

// AI 面板跟随当前终端标签页切换，同时把当前连接信息同步给会话路由。
watch(
  () => [
    activeTabId.value,
    activeTab.value?.serverId ?? "",
    activeTab.value?.title ?? "",
    activeTab.value?.status ?? "disconnected",
  ] as const,
  ([tabId, serverId, serverName, status]) => {
    setAiActiveTabId(tabId, serverId, serverName, status);
  },
  { immediate: true },
);

async function initializeSettingsAndLocalTerminal(): Promise<void> {
  await settingsStore.loadAppSettings();
  if (
    !appSettings.terminal.openLocalTerminalOnStartup ||
    !orbitSSHApi.value
  ) {
    return;
  }

  try {
    await openLocalTerminal();
  } catch (error) {
    writeRendererLog(
      "默认本地终端打开失败",
      { error: error instanceof Error ? error.message : String(error) },
      "error",
    );
  }
}

onMounted(() => {
  writeRendererLog("Renderer mounted", {
    hasOrbitSSHApi: Boolean(orbitSSHApi.value),
  });
  void loadServers();
  void initializeSettingsAndLocalTerminal();
  void loadAppInfo();
  void windowStore.initMaximized();
  void windowStore.initFullScreen();
  windowStore.startFullScreenListener();
  downloadsStore.startListeners();
  terminalsStore.startListeners();
  stopAppMenuListener =
    orbitSSHApi.value?.appMenu.onAction(handleAppMenuAction) ?? null;
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
  sidebarStore.stopAiPanelResize();
});
</script>

<template>
  <main class="app-shell">
    <TitleBarTabs
      :is-window-maximized="isWindowMaximized"
      :is-window-full-screen="isWindowFullScreen"
      :is-windows="isWindows"
      :is-mac="isMac"
      :is-task-list-open="isTaskListOpen"
      :active-download-count="activeDownloadCount"
      :visible-download-tasks="visibleDownloadTasks"
      :is-download-task-operating="isDownloadTaskOperating"
      @update-task-list-open="isTaskListOpen = $event"
      @control-download-task="controlDownloadTask"
      @open-data-transfer="openDataTransferDialog"
      @open-settings="openSettingsDialog"
      @open-update="isUpdateDialogOpen = true"
      @open-about="isAboutDialogOpen = true"
      @minimize-window="minimizeWindow"
      @toggle-maximize-window="toggleMaximizeWindow"
      @close-window="closeWindow" />

    <div
      class="content-shell"
      :style="{
        '--sidebar-width': `${sidebarWidth}px`,
        '--ai-panel-width': `${aiPanelWidth}px`,
        '--ai-panel-resizer-width': isAiPanelOpen ? '6px' : '0px',
      }">
      <aside class="sidebar">
        <ServerSidebar
          :servers="servers"
          :runtime-error="runtimeError"
          :is-server-list-loading="isServerListLoading"
          :list-error="listError"
          :has-servers="hasServers"
          @open-connection-dialog="openConnectionDialog"
          @open-server-terminal="openServerTerminal"
          @edit-server="editServer"
          @set-server-pinned="setServerPinned"
          @delete-server="deleteServer" />

        <SftpPanel
          :active-tab="activeTab"
          :active-sftp-tree="activeSftpTree"
          :visible-file-tree="visibleFileTree"
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
          :can-upload-remote-node="canUploadRemoteNode"
          :can-delete-remote-node="canDeleteRemoteNode"
          @update:file-path-input="filePathInput = $event"
          @refresh="refreshActiveDirectory"
          @submit-path="submitFilePathInput"
          @copy-path="copyActiveSftpPath"
          @sync-path="syncFileTreeToTerminalPath"
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
          @upload-context-file="uploadContextFile"
          @upload-to-current-directory="uploadToActiveSftpDirectory"
          @rename-context-file="renameContextFile"
          @permissions-context-file="openContextFilePermissions"
          @delete-context-file="deleteContextFile"
          @commit-rename="handleCommitRename"
          @cancel-rename="handleCancelRename"
          @create-blank-node="handleCreateBlankNode" />
      </aside>

      <div
        :class="['sidebar-resizer', { active: isResizingSidebar }]"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        @mousedown="startSidebarResize"></div>

      <TerminalPanel
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
        @update:terminal-search-keyword="terminalSearchKeyword = $event"
        @search="searchActiveTerminal"
        @toggle-case-sensitive="toggleTerminalSearchCaseSensitive"
        @close-search="closeTerminalSearch"
        @open-connection-dialog="openConnectionDialog" />

      <div
        :class="[
          'ai-panel-resizer',
          { active: isResizingAiPanel, collapsed: !isAiPanelOpen },
        ]"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整 AI 面板宽度"
        :aria-hidden="!isAiPanelOpen"
        @mousedown="isAiPanelOpen && startAiPanelResize($event)"></div>

      <AiPanel
        :open="isAiPanelOpen"
        :enabled="appSettings.ai.enabled"
        :mode="aiMode"
        :input-text="aiInputText"
        :is-sending="isAiSending"
        :error="aiError"
        :attachments="aiAttachments"
        :attachment-model-name="aiAttachmentModelName"
        :messages="aiMessages"
        :command-cards="aiCommandCards"
        :conversations="aiConversations"
        :active-conversation-id="aiActiveConversationId"
        :conversation-server-name="aiConversationServerName"
        :conversation-context-ready="aiConversationContextReady"
        :should-suggest-new-conversation="shouldSuggestNewConversation"
        :context="aiContext"
        :configs="appSettings.ai.configs"
        :active-config-id="appSettings.ai.activeConfigId"
        @toggle="toggleAiPanel"
        @set-mode="setAiMode"
        @update-input-text="aiInputText = $event"
        @send="sendAiMessage(aiContext)"
        @stop="cancelAiMessage(aiContext)"
        @attach-files="addAiAttachments"
        @remove-attachment="removeAiAttachment"
        @start-new-conversation="startNewAiConversation(activeTabId)"
        @select-conversation="selectAiConversation"
        @rename-conversation="renameAiConversationById"
        @delete-conversation="deleteAiConversation"
        @run-approved="runAiApprovedCommand"
        @reject-approval="rejectAiApproval"
        @select-model="updateAiSetting('activeConfigId', $event)"
        @update-model-reasoning="updateAiModelReasoning" />
    </div>

    <ConnectionDialog
      :open="isConnectionDialogOpen"
      :editing-server-id="editingServerId"
      :connection-form="connectionForm"
      :form-error="formError"
      :is-submitting-server="isSubmittingServer"
      @close="closeConnectionDialog"
      @submit="submitConnectionForm"
      @select-private-key="selectPrivateKeyFile" />

    <DataTransferDialog
      v-if="isDataTransferDialogOpen"
      :servers="servers"
      :is-mac="isMac"
      :active-source="activeTab ? { serverId: activeTab.serverId, currentPath: activeSftpTree?.homePath ?? activeTab.currentPath } : undefined"
      @close="closeDataTransferDialog" />

    <ImagePreviewDialog
      :open="isImagePreviewOpen"
      :image-preview="imagePreview"
      @close="closeImagePreview"
      @download="downloadImagePreviewFile" />

    <FilePermissionDialog
      :state="filePermissionDialog"
      @close="closeFilePermissionDialog"
      @save="saveFilePermissions" />

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
      @save-and-close="saveAndCloseFileEditor" />

    <SftpPathPromptDialog
      :open="isSftpPathPromptOpen"
      :title="sftpPathPromptTitle"
      :message="sftpPathPromptMessage"
      @close="closeSftpPathPrompt" />

    <DeleteConfirmDialog
      :open="deleteConfirmDialog.open"
      :title="deleteConfirmDialog.title"
      :message="deleteConfirmDialog.message"
      :confirm-label="deleteConfirmDialog.confirmLabel"
      :danger="deleteConfirmDialog.danger"
      @cancel="resolveDeleteConfirm(false)"
      @confirm="resolveDeleteConfirm(true)" />

    <SettingsDialog
      :open="isSettingsDialogOpen"
      :app-settings="appSettings"
      :active-settings-section="activeSettingsSection"
      :is-mac="isMac"
      :is-selection-background-dropdown-open="
        isSelectionBackgroundDropdownOpen
      "
      :selection-background-options="selectionBackgroundOptions"
      @close="closeSettingsDialog"
      @update-active-section="activeSettingsSection = $event"
      @update-selection-dropdown-open="
        isSelectionBackgroundDropdownOpen = $event
      "
      @step-terminal-number-setting="stepTerminalNumberSetting"
      @update-keepalive-interval-seconds="updateKeepaliveIntervalSeconds"
      @update-idle-disconnect-minutes="updateIdleDisconnectMinutes"
      @update-open-local-terminal-on-startup="updateOpenLocalTerminalOnStartup"
      @update-ai-setting="updateAiSetting"
      @update-ai-settings="handleUpdateAiSettings"
      @update-theme-mode="updateThemeMode"
      @select-selection-background="selectSelectionBackground" />

    <AboutDialog
      :open="isAboutDialogOpen"
      :version="updateCurrentVersion"
      @close="isAboutDialogOpen = false" />

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
      @install="installUpdate" />
  </main>
</template>
