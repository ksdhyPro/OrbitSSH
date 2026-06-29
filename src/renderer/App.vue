<script setup lang="ts">
import { isPreviewImageFile } from "./utils/file-kind";
import type { VisibleRemoteFileNode } from "./types/sftp";
import {
  computed,
  nextTick,
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
import type { RemoteFileNode } from "../shared/sftp";
import { getRemoteParentPath } from "./utils/path";
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
import { useUpdateStore } from "./stores/useUpdateStore";
import { useAiStore } from "./stores/useAiStore";

const coreStore = useCoreStore();
const settingsStore = useSettingsStore();
const windowStore = useWindowStore();
const sidebarStore = useSidebarStore();
const downloadsStore = useDownloadsStore();
const terminalsStore = useTerminalsStore();
const sftpStore = useSftpStore();
const fileEditorStore = useFileEditorStore();
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
  updateAiSetting,
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
  messages: aiMessages,
  commandCards: aiCommandCards,
} = storeToRefs(aiStore);

const {
  togglePanel: toggleAiPanel,
  setMode: setAiMode,
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
  blankContextMenu,
  renaming,
  fileDragTargetPath,
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
  closeBlankContextMenu,
  openBlankContextMenu: openBlankContextMenuFromStore,
  startRename,
  commitRename: commitRenameFromStore,
  cancelRename: cancelRenameFromStore,
  createRemoteNode,
  clearFileSelection,
  selectFileNode,
  selectAllInFileTree,
  selectFileNodesByPaths,
  startRemoteNodeDrag,
  clearRemoteNodeDrag,
  clearRemoteNodeDragTarget,
  updateRemoteNodeDragTarget,
  moveDraggedRemoteNodesToDirectory,
  openRemoteImagePreview: openRemoteImagePreviewFromStore,
  downloadContextFile: downloadContextFileFromStore,
  downloadImagePreviewFile,
  uploadToContextDirectory,
  uploadToCurrentDirectory,
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
} = fileEditorStore;

const activeSftpTree = computed(() => {
  if (!activeTabId.value) {
    return undefined;
  }

  return sftpTrees.value[activeTabId.value];
});

const aiContext = computed(() => ({
  tabId: activeTabId.value,
  serverName: activeTab.value?.title,
  currentPath: activeTab.value?.currentPath,
  status: activeTab.value?.status,
  sftpPath: activeSftpTree.value?.homePath,
}));

function applyAppThemeMode(): void {
  document.documentElement.dataset.theme = appSettings.appearance.themeMode;
}

const visibleFileTree = computed<VisibleRemoteFileNode[]>(() => {
  const tree = activeSftpTree.value;

  if (!tree) {
    return [];
  }

  const parentNode = createParentDirectoryNode(tree.root.path);
  const currentLevelNodes = (tree.root.children ?? []).map(node => ({
    ...node,
    level: 0,
  }));

  return parentNode ? [parentNode, ...currentLevelNodes] : currentLevelNodes;
});

const isWindows = computed(() => appPlatform.value === "win32");
const isMac = computed(() => appPlatform.value === "darwin");

function createParentDirectoryNode(
  currentPath: string,
): VisibleRemoteFileNode | null {
  const normalizedPath = currentPath.replace(/\/+/g, "/").replace(/\/$/, "");

  if (!normalizedPath || normalizedPath === "/") {
    return null;
  }

  return {
    path: getRemoteParentPath(currentPath),
    name: "..",
    type: "directory",
    loaded: true,
    children: [],
    level: 0,
    isVirtualParent: true,
  };
}

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

function canDownloadRemoteFile(node: RemoteFileNode | null): boolean {
  return sftpStore.canDownloadRemoteFile(activeTabId.value, node);
}

function canUploadRemoteNode(node: RemoteFileNode | null): boolean {
  return sftpStore.canUploadRemoteNode(node);
}

function getFileEditMenuLabel(node: RemoteFileNode | null): string {
  return sftpStore.getFileEditMenuLabel(node);
}

function isEditableTextFile(node: RemoteFileNode | null): boolean {
  return sftpStore.isEditableTextFile(node);
}

function canDeleteRemoteNode(
  node: (RemoteFileNode & { isVirtualParent?: boolean }) | null,
): boolean {
  if (node?.isVirtualParent) {
    return false;
  }

  return sftpStore.canDeleteRemoteNode(activeSftpTree.value, node);
}

function isRemoteNodeDeleting(node: RemoteFileNode | null): boolean {
  return Boolean(node && activeSftpTree.value?.deletingPaths.has(node.path));
}

function openFileContextMenu(
  event: MouseEvent,
  node: RemoteFileNode & { isVirtualParent?: boolean },
): void {
  if (node.isVirtualParent || isRemoteNodeDeleting(node)) {
    return;
  }

  sftpStore.openFileContextMenu(activeTabId.value, event, node);
}

function handleFileSelectNode(
  event: MouseEvent,
  node: RemoteFileNode,
): void {
  if (isRemoteNodeDeleting(node)) {
    return;
  }

  selectFileNode(activeTabId.value, node, visibleFileTree.value, event);
}

function handleFileSelectAll(): void {
  selectAllInFileTree(activeTabId.value, visibleFileTree.value);
}

function handleFileClearSelection(): void {
  clearFileSelection(activeTabId.value);
}

function handleFileMarqueeSelect(paths: string[]): void {
  selectFileNodesByPaths(activeTabId.value, visibleFileTree.value, paths);
}

function handleFileDragStart(
  event: DragEvent,
  node: RemoteFileNode & { isVirtualParent?: boolean },
): void {
  if (node.isVirtualParent || isRemoteNodeDeleting(node)) {
    event.preventDefault();
    return;
  }

  startRemoteNodeDrag(activeSftpTree.value, node);
  event.dataTransfer?.setData("text/plain", node.path);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
  }
}

function handleFileDragOver(
  event: DragEvent,
  node: RemoteFileNode & { isVirtualParent?: boolean },
): void {
  if (node.type !== "directory") {
    clearRemoteNodeDragTarget();
    return;
  }

  if (!updateRemoteNodeDragTarget(activeSftpTree.value, node)) {
    event.dataTransfer && (event.dataTransfer.dropEffect = "none");
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

function handleFileDragLeave(
  event: DragEvent,
  node: RemoteFileNode,
): void {
  const nextTarget = event.relatedTarget;
  const currentTarget = event.currentTarget;

  if (
    currentTarget instanceof HTMLElement &&
    nextTarget instanceof Node &&
    currentTarget.contains(nextTarget)
  ) {
    return;
  }

  if (fileDragTargetPath.value === node.path) {
    clearRemoteNodeDragTarget();
  }
}

async function handleFileDrop(
  event: DragEvent,
  node: RemoteFileNode & { isVirtualParent?: boolean },
): Promise<void> {
  event.preventDefault();

  if (node.type !== "directory") {
    clearRemoteNodeDrag();
    return;
  }

  await moveDraggedRemoteNodesToDirectory(
    activeTabId.value,
    activeSftpTree.value,
    node,
    {
      shouldMove: (message) =>
        requestConfirm({
          title: "确认移动",
          message,
          confirmLabel: "移动",
          danger: false,
        }),
    },
  );
}

async function downloadContextFile(): Promise<void> {
  await downloadContextFileFromStore(activeTabId.value);
}

async function uploadContextFile(
  sourceType: "file" | "directory",
): Promise<void> {
  await uploadToContextDirectory(activeTabId.value, sourceType);
}

async function uploadToActiveSftpDirectory(
  sourceType: "file" | "directory",
): Promise<void> {
  await uploadToCurrentDirectory(activeTabId.value, sourceType);
}

async function refreshActiveDirectory(): Promise<void> {
  const tab = activeTab.value;
  const tree = activeSftpTree.value;

  if (!tab || !tree?.homePath) {
    await refreshSftpDirectory(tab);
    return;
  }

  await sftpStore.openSftpDirectoryPath(tab, tree.homePath, "刷新目录失败");
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

async function openRemoteNodeByDoubleClick(node: RemoteFileNode): Promise<void> {
  const tab = activeTab.value;

  if (isRemoteNodeDeleting(node)) {
    return;
  }

  if ("isVirtualParent" in node && node.isVirtualParent && tab) {
    await sftpStore.openSftpDirectoryPath(tab, node.path, "路径不存在或无法访问");
    return;
  }

  if (node.type === "directory" && tab) {
    // 当前层模式复用路径跳转逻辑，进入目录后仅展示该目录直属内容。
    await sftpStore.openSftpDirectoryPath(tab, node.path, "路径不存在或无法访问");
    return;
  }

  await openRemoteFileEditorByDoubleClick(node);
}

async function deleteContextFile(): Promise<void> {
  await deleteContextFileFromStore(activeTabId.value, activeSftpTree.value, {
    shouldDelete: requestDeleteConfirm,
    onDeleted: node => {
      if (fileEditor.value.path === node.path) {
        closeFileEditor();
      }
    },
  });
}

function handleOpenBlankContextMenu(event: MouseEvent): void {
  if (!activeTab.value) {
    return;
  }
  openBlankContextMenuFromStore(activeTabId.value, event);
}

// 右键节点选「重命名」：单选目标进入编辑态。
function renameContextFile(): void {
  const node = fileContextMenu.value.node;
  if (!node || !activeTabId.value) {
    return;
  }
  closeFileContextMenu();
  startRename(activeTabId.value, node);
}

async function handleCommitRename(): Promise<void> {
  const oldPath = renaming.value?.path;
  await commitRenameFromStore();
  // 重命名后，若旧文件正打开在编辑器中，关闭它避免保存到失效路径。
  if (oldPath && fileEditor.value.path === oldPath) {
    closeFileEditor();
  }
}

function handleCancelRename(): void {
  cancelRenameFromStore();
}

async function handleCreateBlankNode(
  type: "file" | "directory",
): Promise<void> {
  const parentPath = activeSftpTree.value?.homePath;
  if (!parentPath) {
    return;
  }
  await createRemoteNode(activeTabId.value, parentPath, type);
}

function requestDeleteConfirm(message: string): Promise<boolean> {
  return requestConfirm({
    title: "确认删除",
    message,
    confirmLabel: "删除",
    danger: true,
  });
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
    },
  });
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
  stopAppMenuListener =
    orbitSSHApi.value?.appMenu.onAction(handleAppMenuAction) ?? null;
  initUpdate();

  window.addEventListener("resize", handleWindowResize);
  window.addEventListener("keydown", handleGlobalKeydown);
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

      <AiPanel
        :open="isAiPanelOpen"
        :enabled="appSettings.ai.enabled"
        :mode="aiMode"
        :input-text="aiInputText"
        :is-sending="isAiSending"
        :error="aiError"
        :messages="aiMessages"
        :command-cards="aiCommandCards"
        :context="aiContext"
        @toggle="toggleAiPanel"
        @set-mode="setAiMode"
        @update-input-text="aiInputText = $event"
        @send="sendAiMessage(aiContext)"
        @stop="cancelAiMessage(aiContext)"
        @run-approved="runAiApprovedCommand"
        @reject-approval="rejectAiApproval" />
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
      @update-ai-setting="updateAiSetting"
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
