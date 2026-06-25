<script setup lang="ts">
import { flattenRemoteTree } from "./utils/file-tree";
import { isPreviewImageFile } from "./utils/file-kind";
import type { VisibleRemoteFileNode } from "./types/sftp";
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  watch,
} from "vue";
import "@xterm/xterm/css/xterm.css";

import ConnectionDialog from "./components/ConnectionDialog.vue";
import ImagePreviewDialog from "./components/ImagePreviewDialog.vue";
import RemoteFileEditorDialog from "./components/RemoteFileEditorDialog.vue";
import ServerSidebar from "./components/ServerSidebar.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import SftpPanel from "./components/SftpPanel.vue";
import SftpPathPromptDialog from "./components/SftpPathPromptDialog.vue";
import TerminalPanel from "./components/TerminalPanel.vue";
import TitleBarTabs from "./components/TitleBarTabs.vue";
import type { ServerConfig } from "../shared/server";
import type { RemoteFileNode } from "../shared/sftp";
import { storeToRefs } from "pinia";
import { useCoreStore } from "./stores/useCoreStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useWindowStore } from "./stores/useWindowStore";
import { useSidebarStore } from "./stores/useSidebarStore";
import { useDownloadsStore } from "./stores/useDownloadsStore";
import { useTerminalsStore } from "./stores/useTerminalsStore";
import { useSftpStore } from "./stores/useSftpStore";
import { useFileEditorStore } from "./stores/useFileEditorStore";
import { useServersStore } from "./stores/useServersStore";

const coreStore = useCoreStore();
const settingsStore = useSettingsStore();
const windowStore = useWindowStore();
const sidebarStore = useSidebarStore();
const downloadsStore = useDownloadsStore();
const terminalsStore = useTerminalsStore();
const sftpStore = useSftpStore();
const fileEditorStore = useFileEditorStore();
const serversStore = useServersStore();

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
  selectSelectionBackground,
} = settingsStore;

// window
const { isWindowMaximized } = storeToRefs(windowStore);
const { minimizeWindow, toggleMaximizeWindow, closeWindow } = windowStore;

// sidebar
const { sidebarWidth, isResizingSidebar } = storeToRefs(sidebarStore);
const { startSidebarResize } = sidebarStore;

// downloads
const {
  isTaskListOpen,
  activeDownloadCount,
  visibleDownloadTasks,
} = storeToRefs(downloadsStore);
const {
  controlDownloadTask,
  isDownloadTaskOperating,
  closeTaskList,
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
  fileTreeElement,
  fileContextMenu,
  imagePreview,
} = storeToRefs(sftpStore);

const {
  loadSftpHome,
  removeSftpTree,
  closeSftpSession,
  refreshActiveDirectory: refreshSftpDirectory,
  closeSftpPathPrompt: closeSftpPathPromptFromStore,
  submitFilePathInput: submitFilePathInputFromStore,
  copyActiveSftpPath: copyActiveSftpPathFromStore,
  syncFileTreeToTerminalPath: syncFileTreeToTerminalPathFromStore,
  closeFileContextMenu,
  openRemoteImagePreview: openRemoteImagePreviewFromStore,
  downloadContextFile: downloadContextFileFromStore,
  downloadImagePreviewFile,
  deleteContextFile: deleteContextFileFromStore,
  closeImagePreview,
} = sftpStore;

const {
  isFileEditorOpen,
  isFileEditorCloseConfirmOpen,
  isFileEditorSearchOpen,
  isFileEditorSearchCaseSensitive,
  fileEditorContainer,
  fileEditorSearchInput,
  fileEditorReplaceInput,
  fileEditorError,
  fileEditorSearchKeyword,
  fileEditorReplaceText,
  fileEditor,
  isFileEditorDirty,
  fileEditorTitle,
} = storeToRefs(fileEditorStore);

const {
  openRemoteFileEditor: openRemoteFileEditorFromStore,
  requestCloseFileEditor,
  closeFileEditor,
  saveFileEditor,
  saveAndCloseFileEditor,
  discardFileEditorChanges,
  applyFileEditorSearchQuery,
  openFileEditorSearch,
  closeFileEditorSearch,
  toggleFileEditorSearchCaseSensitive,
  searchFileEditor,
  replaceCurrentFileEditorMatch,
  replaceAllFileEditorMatches,
  applyFileEditorTheme,
} = fileEditorStore;

const activeSftpTree = computed(() => {
  if (!activeTabId.value) {
    return undefined;
  }

  return sftpTrees.value[activeTabId.value];
});

const visibleFileTree = computed<VisibleRemoteFileNode[]>(() => {
  const tree = activeSftpTree.value;

  if (!tree) {
    return [];
  }

  return flattenRemoteTree(tree.root, tree.expandedPaths);
});

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

function getFilePanelHint(): string {
  if (!activeTab.value) {
    return "打开 SSH 会话后显示远程目录";
  }

  const tree = activeSftpTree.value;

  if (!tree) {
    return "正在建立 SFTP 文件会话...";
  }

  if (tree.error) {
    return tree.error;
  }

  return tree.homePath;
}

function canDownloadRemoteFile(node: RemoteFileNode | null): boolean {
  return sftpStore.canDownloadRemoteFile(activeTabId.value, node);
}

function getFileEditMenuLabel(node: RemoteFileNode | null): string {
  return sftpStore.getFileEditMenuLabel(node);
}

function isEditableTextFile(node: RemoteFileNode | null): boolean {
  return sftpStore.isEditableTextFile(node);
}

function canDeleteRemoteNode(node: RemoteFileNode | null): boolean {
  return sftpStore.canDeleteRemoteNode(activeSftpTree.value, node);
}

function openFileContextMenu(event: MouseEvent, node: RemoteFileNode): void {
  sftpStore.openFileContextMenu(activeTabId.value, event, node);
}

async function downloadContextFile(): Promise<void> {
  await downloadContextFileFromStore(activeTabId.value);
}

async function refreshActiveDirectory(): Promise<void> {
  await refreshSftpDirectory(activeTab.value);
}

function closeSftpPathPrompt(): void {
  closeSftpPathPromptFromStore(activeSftpTree.value?.homePath ?? "");
}

async function submitFilePathInput(): Promise<void> {
  await submitFilePathInputFromStore(activeTab.value);
}

async function copyActiveSftpPath(): Promise<void> {
  await copyActiveSftpPathFromStore(activeTabId.value, activeSftpTree.value);
}

async function syncFileTreeToTerminalPath(): Promise<void> {
  await syncFileTreeToTerminalPathFromStore(activeTab.value);
}

function setFileTreeElement(element: unknown): void {
  fileTreeElement.value = element instanceof HTMLElement ? element : null;
}

function setFileEditorContainer(element: unknown): void {
  fileEditorContainer.value = element instanceof HTMLElement ? element : null;
}

function setFileEditorSearchInput(element: unknown): void {
  fileEditorSearchInput.value =
    element instanceof HTMLInputElement ? element : null;
}

function setFileEditorReplaceInput(element: unknown): void {
  fileEditorReplaceInput.value =
    element instanceof HTMLInputElement ? element : null;
}


async function editContextFile(): Promise<void> {
  const node = fileContextMenu.value.node;

  if (!node || !sftpStore.isEditableTextFile(node) || !activeTabId.value) {
    return;
  }

  closeFileContextMenu();
  await openRemoteFileEditorFromStore(activeTabId.value, node);
}

async function previewContextFile(): Promise<void> {
  const node = fileContextMenu.value.node;

  if (!node || !isPreviewImageFile(node)) {
    return;
  }

  closeFileContextMenu();
  await openRemoteImagePreviewFromStore(activeTabId.value, node);
}

async function openRemoteFileEditorByDoubleClick(
  node: RemoteFileNode,
): Promise<void> {
  if (node.type !== "file") {
    return;
  }

  if (isPreviewImageFile(node)) {
    await openRemoteImagePreviewFromStore(activeTabId.value, node);
    return;
  }

  const editable = await sftpStore.ensureEditableTextFile(
    activeTabId.value,
    node,
  );

  if (editable) {
    await openRemoteFileEditorFromStore(activeTabId.value, node);
  }
}

async function deleteContextFile(): Promise<void> {
  await deleteContextFileFromStore(activeTabId.value, activeSftpTree.value, {
    shouldDelete: message => window.confirm(message),
    onDeleted: node => {
      if (fileEditor.value.path === node.path) {
        closeFileEditor();
      }
    },
  });
}

async function deleteServer(serverId: string): Promise<void> {
  await serversStore.deleteServer(serverId, () =>
    window.confirm("确认删除该服务器配置？"),
  );
}

async function openServerTerminal(server: ServerConfig): Promise<void> {
  try {
    await openTerminalFromStore(server, {
      afterOpen: tab => {
        void loadSftpHome(tab);
      },
    });
  } catch (error) {
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
    },
  });
}

async function toggleRemoteDirectory(node: RemoteFileNode): Promise<void> {
  if (!activeTabId.value) {
    return;
  }

  await sftpStore.toggleRemoteDirectory(activeTabId.value, node);
}

// 窗口尺寸变化（含最大化/还原）后重新 fit 终端。
function handleWindowResize(): void {
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

// 侧边栏拖动改变终端区宽度，需重新 fit（store 内不反向依赖终端域）。
watch(sidebarWidth, () => {
  scheduleTerminalFit();
});

onMounted(() => {
  writeRendererLog("Renderer mounted", {
    hasOrbitSSHApi: Boolean(orbitSSHApi.value),
  });
  void loadServers();
  void settingsStore.loadAppSettings();
  void windowStore.initMaximized();
  downloadsStore.startListeners();
  terminalsStore.startListeners();

  window.addEventListener("resize", handleWindowResize);
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("click", closeFileContextMenu);
  window.addEventListener("click", closeTaskList);
  window.addEventListener("contextmenu", closeFileContextMenu);
});

watch(
  () => activeSftpTree.value?.homePath,
  homePath => {
    filePathInput.value = homePath ?? "";
  },
  { immediate: true },
);

watch(
  visibleFileTree,
  async nodes => {
    await nextTick();
    const rect = fileTreeElement.value?.getBoundingClientRect();

    writeRendererLog("文件树可见节点变化", {
      tabId: activeTabId.value,
      nodeCount: nodes.length,
      paths: nodes.slice(0, 10).map(node => node.path),
      panelWidth: rect?.width,
      panelHeight: rect?.height,
      scrollHeight: fileTreeElement.value?.scrollHeight,
      clientHeight: fileTreeElement.value?.clientHeight,
    });
  },
  { immediate: false },
);

onUnmounted(() => {
  terminalsStore.cleanup();
  downloadsStore.stopListeners();
  window.removeEventListener("resize", handleWindowResize);
  window.removeEventListener("keydown", handleGlobalKeydown);
  window.removeEventListener("click", closeFileContextMenu);
  window.removeEventListener("click", closeTaskList);
  window.removeEventListener("contextmenu", closeFileContextMenu);
  sidebarStore.stopSidebarResize();
});
</script>

<template>
  <main class="app-shell">
    <TitleBarTabs
      :tabs="tabs"
      :active-tab-id="activeTabId"
      :is-window-maximized="isWindowMaximized"
      :is-task-list-open="isTaskListOpen"
      :active-download-count="activeDownloadCount"
      :visible-download-tasks="visibleDownloadTasks"
      :is-download-task-operating="isDownloadTaskOperating"
      @activate-tab="activateTerminalTab"
      @close-tab="closeTerminalTab"
      @update-task-list-open="isTaskListOpen = $event"
      @control-download-task="controlDownloadTask"
      @open-settings="openSettingsDialog"
      @minimize-window="minimizeWindow"
      @toggle-maximize-window="toggleMaximizeWindow"
      @close-window="closeWindow" />

    <div
      class="content-shell"
      :style="{ '--sidebar-width': `${sidebarWidth}px` }">
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
          @delete-server="deleteServer" />

        <SftpPanel
          :active-tab="activeTab"
          :active-sftp-tree="activeSftpTree"
          :visible-file-tree="visibleFileTree"
          :file-context-menu="fileContextMenu"
          :file-path-input="filePathInput"
          :file-panel-hint="getFilePanelHint()"
          :file-tree-element-ref="setFileTreeElement"
          :is-editable-text-file="isEditableTextFile"
          :get-file-edit-menu-label="getFileEditMenuLabel"
          :can-download-remote-file="canDownloadRemoteFile"
          :can-delete-remote-node="canDeleteRemoteNode"
          @update:file-path-input="filePathInput = $event"
          @refresh="refreshActiveDirectory"
          @submit-path="submitFilePathInput"
          @copy-path="copyActiveSftpPath"
          @sync-path="syncFileTreeToTerminalPath"
          @open-context-menu="openFileContextMenu"
          @toggle-directory="toggleRemoteDirectory"
          @open-file-by-double-click="openRemoteFileEditorByDoubleClick"
          @preview-context-file="previewContextFile"
          @edit-context-file="editContextFile"
          @download-context-file="downloadContextFile"
          @delete-context-file="deleteContextFile" />
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
        @update:terminal-search-keyword="terminalSearchKeyword = $event"
        @search="searchActiveTerminal"
        @toggle-case-sensitive="toggleTerminalSearchCaseSensitive"
        @close-search="closeTerminalSearch"
        @open-connection-dialog="openConnectionDialog" />
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

    <ImagePreviewDialog
      :open="isImagePreviewOpen"
      :image-preview="imagePreview"
      @close="closeImagePreview"
      @download="downloadImagePreviewFile" />

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

    <SettingsDialog
      :open="isSettingsDialogOpen"
      :app-settings="appSettings"
      :active-settings-section="activeSettingsSection"
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
      @select-selection-background="selectSelectionBackground" />
  </main>
</template>
