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

import ConnectionDialog from "./components/ConnectionDialog.vue";
import DataTransferDialog from "./components/DataTransferDialog.vue";
import DeleteConfirmDialog from "./components/DeleteConfirmDialog.vue";
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
import type { ServerConfig } from "../shared/server";
import type { AppMenuAction } from "../shared/app-menu";
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
const isPortForwardDialogOpen = ref(false);
const isUpdateDialogOpen = ref(false);
const contentShellElement = ref<HTMLElement | null>(null);
const sidebarPanelsElement = ref<HTMLElement | null>(null);
const sidebarPanelsHeight = ref(0);
const isResizingSidebarPanels = ref(false);
type SidebarPanel = "servers" | "automation" | "remoteFiles";
let sidebarPanelResizeStartY = 0;
let resizingSidebarPanel: SidebarPanel | null = null;
let resizingPanelStartHeight = 0;
let resizingAdjacentSidebarPanel: SidebarPanel | null = null;
let resizingAdjacentPanelStartHeight = 0;
let sidebarPanelResizePointerId: number | null = null;
let sidebarPanelResizeElement: HTMLElement | null = null;
let sidebarPanelsResizeObserver: ResizeObserver | null = null;
let stopAppMenuListener: (() => void) | null = null;

const SIDEBAR_PANEL_HEADER_HEIGHT = 34;
const SIDEBAR_PANEL_COLLAPSED_HEADER_HEIGHT = 28;
const SIDEBAR_PANEL_MIN_HEIGHT = 160;
const SIDEBAR_PANEL_RESIZER_HEIGHT = 10;

/** 返回 AI 分隔条拖拽时应使用的内容区右边界。 */
function getContentShellRightBoundary(): number {
  return contentShellElement.value?.getBoundingClientRect().right ?? window.innerWidth;
}

const sidebarPanelOrder = computed(() => appSettings.sidebar.panelOrder);
const draggedSidebarPanel = ref<SidebarPanel | null>(null);

function isLastSidebarPanel(panel: SidebarPanel): boolean {
  return sidebarPanelOrder.value.at(-1) === panel;
}

function getSidebarPanelHeight(panel: SidebarPanel): number {
  return appSettings.sidebar[panel].collapsed
    ? SIDEBAR_PANEL_COLLAPSED_HEADER_HEIGHT
    : appSettings.sidebar[panel].height;
}

function getSidebarPanelMinimumHeight(panel: SidebarPanel): number {
  return appSettings.sidebar[panel].collapsed
    ? SIDEBAR_PANEL_COLLAPSED_HEADER_HEIGHT
    : SIDEBAR_PANEL_MIN_HEIGHT;
}

/** 返回分隔线下方紧邻的面板，用于将拖拽高度在相邻面板间转移。 */
function getNextSidebarPanel(panel: SidebarPanel): SidebarPanel | null {
  const panelIndex = sidebarPanelOrder.value.indexOf(panel);
  return panelIndex >= 0 ? sidebarPanelOrder.value[panelIndex + 1] ?? null : null;
}

/** 将侧栏实际可用高度同步为响应式数据，供窗口缩放后的布局重新计算使用。 */
function refreshSidebarPanelsHeight(): void {
  const sidebarElement = sidebarPanelsElement.value;
  if (!sidebarElement) {
    sidebarPanelsHeight.value = 0;
    return;
  }

  const sidebarStyle = window.getComputedStyle(sidebarElement);
  // clientHeight 包含上下内边距，需扣除后才是面板实际可分配的内容高度。
  sidebarPanelsHeight.value = sidebarElement.clientHeight
    - Number.parseFloat(sidebarStyle.paddingTop)
    - Number.parseFloat(sidebarStyle.paddingBottom);
}

function getSidebarPanelMaxHeight(panel: SidebarPanel): number {
  const containerHeight = sidebarPanelsHeight.value;
  const lastPanel = sidebarPanelOrder.value.at(-1) ?? "remoteFiles";
  const otherHeight = sidebarPanelOrder.value
    .filter(candidate => candidate !== panel && candidate !== lastPanel)
    .reduce((total, candidate) => total + getSidebarPanelHeight(candidate), 0);
  // 排在最下面的面板自动填充余下空间，因此调整其他面板时始终为其保留最小可用高度。
  const lastPanelMinimumHeight = getSidebarPanelMinimumHeight(lastPanel);
  // 非末尾面板的分隔条始终保留，折叠时同样占用布局高度。
  const resizerHeight = sidebarPanelOrder.value.slice(0, -1).length
    * SIDEBAR_PANEL_RESIZER_HEIGHT;

  return Math.max(
    SIDEBAR_PANEL_MIN_HEIGHT,
    containerHeight - otherHeight - lastPanelMinimumHeight - resizerHeight,
  );
}

function clampSidebarPanelHeight(height: number, panel: SidebarPanel): number {
  return Math.min(
    Math.max(Math.round(height), SIDEBAR_PANEL_MIN_HEIGHT),
    getSidebarPanelMaxHeight(panel),
  );
}

// 保留用户保存的高度；窗口变小时仅收紧当前显示高度，恢复窗口后可自动还原。
function getSidebarPanelDisplayHeight(
  height: number,
  panel: SidebarPanel,
): number {
  const containerHeight = sidebarPanelsHeight.value;
  if (!containerHeight) return height;

  const lastPanel = sidebarPanelOrder.value.at(-1) ?? "remoteFiles";
  const fixedPanels = sidebarPanelOrder.value.slice(0, -1);
  const lastPanelMinimumHeight = getSidebarPanelMinimumHeight(lastPanel);
  const fixedPanelsHeight = containerHeight
    - lastPanelMinimumHeight
    - fixedPanels.length * SIDEBAR_PANEL_RESIZER_HEIGHT;
  let allocatedHeight = 0;

  for (let index = 0; index < fixedPanels.length; index += 1) {
    const candidate = fixedPanels[index];
    const candidateMinimumHeight = getSidebarPanelMinimumHeight(candidate);
    const followingMinimumHeight = fixedPanels
      .slice(index + 1)
      .reduce(
        (total, followingPanel) => total + getSidebarPanelHeight(followingPanel),
        0,
      );
    // 优先展示保存高度；空间不足时从上到下收紧，同时为后续面板和末尾面板保留最小高度。
    const availableHeight = fixedPanelsHeight - allocatedHeight - followingMinimumHeight;
    const displayHeight = Math.max(
      candidateMinimumHeight,
      Math.min(getSidebarPanelHeight(candidate), availableHeight),
    );

    if (candidate === panel) return displayHeight;
    allocatedHeight += displayHeight;
  }

  return height;
}

function getSidebarPanelStyle(panel: SidebarPanel): { height: string | undefined } {
  if (appSettings.sidebar[panel].collapsed) {
    return { height: `${SIDEBAR_PANEL_COLLAPSED_HEADER_HEIGHT}px` };
  }

  return {
    height: isLastSidebarPanel(panel)
      ? undefined
      : `${getSidebarPanelDisplayHeight(appSettings.sidebar[panel].height, panel)}px`,
  };
}

function persistSidebarLayout(): void {
  void settingsStore.saveAppSettings();
}

function toggleSidebarPanel(panel: "servers" | "automation" | "remoteFiles"): void {
  const isOpening = appSettings.sidebar[panel].collapsed;
  appSettings.sidebar[panel].collapsed = !isOpening;

  if (isOpening) {
    // 展开目标面板前，先将其余展开面板收至最小高度，为目标面板腾出全部可用空间。
    sidebarPanelOrder.value.forEach(candidate => {
      if (candidate !== panel && !appSettings.sidebar[candidate].collapsed) {
        appSettings.sidebar[candidate].height = SIDEBAR_PANEL_MIN_HEIGHT;
      }
    });
    appSettings.sidebar[panel].height = getSidebarPanelMaxHeight(panel);
  }

  persistSidebarLayout();
}

/** 仅高亮当前正在拖动的面板分隔条，避免其他分隔条同时出现激活样式。 */
function isResizingSidebarPanel(panel: SidebarPanel): boolean {
  return isResizingSidebarPanels.value && resizingSidebarPanel === panel;
}

function handleSidebarPanelResizeMove(event: PointerEvent): void {
  if (!isResizingSidebarPanels.value) {
    return;
  }

  if (!resizingSidebarPanel) return;

  const requestedDelta = event.clientY - sidebarPanelResizeStartY;
  const sourcePanel = resizingSidebarPanel;
  const adjacentPanel = resizingAdjacentSidebarPanel;

  if (adjacentPanel && !isLastSidebarPanel(adjacentPanel)) {
    // 中间分隔线直接在两侧面板间转移高度，避免错误挤占最底部面板的剩余空间。
    const appliedDelta = Math.min(
      Math.max(
        Math.round(requestedDelta),
        getSidebarPanelMinimumHeight(sourcePanel) - resizingPanelStartHeight,
      ),
      resizingAdjacentPanelStartHeight - getSidebarPanelMinimumHeight(adjacentPanel),
    );
    appSettings.sidebar[sourcePanel].height = resizingPanelStartHeight + appliedDelta;
    appSettings.sidebar[adjacentPanel].height = resizingAdjacentPanelStartHeight - appliedDelta;
  } else {
    // 下方为自动填充的末尾面板时，由末尾面板吸收高度变化，但仍保留它的最小高度。
    appSettings.sidebar[sourcePanel].height = clampSidebarPanelHeight(
      resizingPanelStartHeight + requestedDelta,
      sourcePanel,
    );
  }
  document.body.style.cursor = "row-resize";
  document.body.style.userSelect = "none";
}

function stopSidebarPanelResize(): void {
  if (!isResizingSidebarPanels.value) {
    return;
  }

  isResizingSidebarPanels.value = false;
  resizingSidebarPanel = null;
  resizingAdjacentSidebarPanel = null;
  resizingAdjacentPanelStartHeight = 0;
  if (sidebarPanelResizeElement && sidebarPanelResizePointerId !== null) {
    sidebarPanelResizeElement.releasePointerCapture?.(sidebarPanelResizePointerId);
  }
  sidebarPanelResizeElement = null;
  sidebarPanelResizePointerId = null;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", handleSidebarPanelResizeMove, true);
  window.removeEventListener("pointerup", stopSidebarPanelResize, true);
  persistSidebarLayout();
}

function startSidebarPanelResize(event: PointerEvent, panel: SidebarPanel): void {
  event.preventDefault();
  const target = event.currentTarget;
  if (target instanceof HTMLElement) {
    // 指针捕获让分隔条在鼠标移入 SSH 终端画布后仍持续收到移动事件。
    target.setPointerCapture(event.pointerId);
    sidebarPanelResizeElement = target;
    sidebarPanelResizePointerId = event.pointerId;
  }
  sidebarPanelResizeStartY = event.clientY;
  resizingSidebarPanel = panel;
  resizingPanelStartHeight = getSidebarPanelDisplayHeight(
    appSettings.sidebar[panel].height,
    panel,
  );
  const adjacentPanel = getNextSidebarPanel(panel);
  resizingAdjacentSidebarPanel = adjacentPanel && !appSettings.sidebar[adjacentPanel].collapsed
    ? adjacentPanel
    : null;
  resizingAdjacentPanelStartHeight = resizingAdjacentSidebarPanel
    ? isLastSidebarPanel(resizingAdjacentSidebarPanel)
      ? appSettings.sidebar[resizingAdjacentSidebarPanel].height
      : getSidebarPanelDisplayHeight(
        appSettings.sidebar[resizingAdjacentSidebarPanel].height,
        resizingAdjacentSidebarPanel,
      )
    : 0;
  isResizingSidebarPanels.value = true;
  document.body.style.cursor = "row-resize";
  document.body.style.userSelect = "none";
  // 使用捕获阶段监听，避免 SSH 终端画布拦截指针事件后分隔条无法继续拖动。
  window.addEventListener("pointermove", handleSidebarPanelResizeMove, true);
  window.addEventListener("pointerup", stopSidebarPanelResize, true);
}

/** 记录被拖动的面板，拖放完成后统一写入持久化排序。 */
function startSidebarPanelDrag(event: DragEvent, panel: SidebarPanel): void {
  // 仅允许从面板标题发起排序拖拽，避免与远程文件的拖放操作冲突。
  if (!(event.target instanceof Element) || !event.target.closest(".panel-header")) {
    event.preventDefault();
    return;
  }

  if (!event.dataTransfer) return;

  draggedSidebarPanel.value = panel;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", panel);
}

function finishSidebarPanelDrag(event: DragEvent, targetPanel: SidebarPanel): void {
  const sourcePanel = draggedSidebarPanel.value;
  draggedSidebarPanel.value = null;
  if (!sourcePanel || sourcePanel === targetPanel) return;

  const nextOrder = [...sidebarPanelOrder.value];
  const sourceIndex = nextOrder.indexOf(sourcePanel);
  const targetIndex = nextOrder.indexOf(targetPanel);
  if (sourceIndex < 0 || targetIndex < 0) return;

  nextOrder.splice(sourceIndex, 1);
  const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const targetElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const targetMiddle = targetElement
    ? targetElement.getBoundingClientRect().top + targetElement.clientHeight / 2
    : Number.POSITIVE_INFINITY;
  // 按鼠标落点决定插入目标面板的上方或下方，确保可拖到列表首尾。
  const insertIndex = event.clientY > targetMiddle ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  nextOrder.splice(insertIndex, 0, sourcePanel);
  appSettings.sidebar.panelOrder = nextOrder;
  persistSidebarLayout();
}

function clearSidebarPanelDrag(): void {
  draggedSidebarPanel.value = null;
}

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
const {
  sidebarWidth,
  isResizingSidebar,
  aiPanelWidth,
  isResizingAiPanel,
} = storeToRefs(sidebarStore);
const { startSidebarResize, startAiPanelResize } = sidebarStore;

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
  shouldSuggestNewConversation,
} = storeToRefs(aiStore);

const {
  togglePanel: toggleAiPanel,
  setMode: setAiMode,
  setActiveTabId: setAiActiveTabId,
  startNewConversation: startNewAiConversation,
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
  await serversStore.deleteServer(serverId, () => requestConfirm({
    title: "删除服务器",
    message: "确认删除该服务器配置？",
    confirmLabel: "删除",
    danger: true,
  }));
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

// AI 面板宽度、折叠或启用状态变化都会改变终端可用宽度，需要重新 fit。
watch(
  [aiPanelWidth, isAiPanelOpen, () => appSettings.ai.enabled],
  ([, , aiEnabled]) => {
    // 禁用 AI 时终止可能仍在进行的拖拽，避免残留全局鼠标状态。
    if (!aiEnabled) {
      sidebarStore.stopAiPanelResize();
    }

    scheduleTerminalFit();
  },
);

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
watch(
  activeTabId,
  tabId => {
    setAiActiveTabId(tabId);
  },
  { immediate: true },
);

onMounted(() => {
  writeRendererLog("Renderer mounted", {
    hasOrbitSSHApi: Boolean(orbitSSHApi.value),
  });
  refreshSidebarPanelsHeight();
  sidebarPanelsResizeObserver = new ResizeObserver(refreshSidebarPanelsHeight);
  if (sidebarPanelsElement.value) {
    sidebarPanelsResizeObserver.observe(sidebarPanelsElement.value);
  }
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
  sidebarPanelsResizeObserver?.disconnect();
  sidebarPanelsResizeObserver = null;
  destroyUpdate();
  window.removeEventListener("resize", handleWindowResize);
  window.removeEventListener("keydown", handleGlobalKeydown);
  sidebarStore.stopSidebarResize();
  sidebarStore.stopAiPanelResize();
  stopSidebarPanelResize();
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
      @open-port-forwards="openPortForwardDialog"
      @open-settings="openSettingsDialog"
      @open-update="isUpdateDialogOpen = true"
      @open-about="showAboutDialog"
      @minimize-window="minimizeWindow"
      @toggle-maximize-window="toggleMaximizeWindow"
      @close-window="closeWindow" />

    <PortForwardDialog
      :open="isPortForwardDialogOpen"
      :servers="servers"
      @close="isPortForwardDialogOpen = false" />

    <div
      ref="contentShellElement"
      class="content-shell"
      :style="{
        '--sidebar-width': `${sidebarWidth}px`,
        '--ai-panel-width': `${aiPanelWidth}px`,
        '--ai-panel-track-width': !appSettings.ai.enabled
          ? '0px'
          : isAiPanelOpen
            ? `${aiPanelWidth}px`
            : '42px',
        '--ai-panel-resizer-width':
          appSettings.ai.enabled && isAiPanelOpen ? '6px' : '0px',
      }">
      <aside ref="sidebarPanelsElement" class="sidebar">
        <template v-for="panel in sidebarPanelOrder" :key="panel">
          <div
            draggable="true"
            :class="[
              'sidebar-panel-slot',
              `sidebar-panel-slot-${panel}`,
              {
                collapsed: appSettings.sidebar[panel].collapsed,
                'is-last': isLastSidebarPanel(panel),
                dragging: draggedSidebarPanel === panel,
              },
            ]"
            :style="getSidebarPanelStyle(panel)"
            @dragstart="startSidebarPanelDrag($event, panel)"
            @dragover.prevent
            @drop="finishSidebarPanelDrag($event, panel)"
            @dragend="clearSidebarPanelDrag">
            <ServerSidebar
              v-if="panel === 'servers'"
              :servers="servers"
              :groups="groups"
              :runtime-error="runtimeError"
              :is-server-list-loading="isServerListLoading"
              :list-error="listError"
              :has-servers="hasServers"
              :active-server-id="activeTab?.serverId ?? ''"
              :collapsed="appSettings.sidebar.servers.collapsed"
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
              @toggle-collapsed="toggleSidebarPanel('servers')" />

            <AutomationSidebar
              v-else-if="panel === 'automation'"
              :active-tab="activeTab"
              :collapsed="appSettings.sidebar.automation.collapsed"
              @toggle-collapsed="toggleSidebarPanel('automation')" />

            <SftpPanel
              v-else
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
              :collapsed="appSettings.sidebar.remoteFiles.collapsed"
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
              @create-blank-node="handleCreateBlankNode"
              @toggle-collapsed="toggleSidebarPanel('remoteFiles')" />
          </div>

          <div
            v-if="!isLastSidebarPanel(panel)"
            :class="[
              'sidebar-panel-resizer',
              {
                active: isResizingSidebarPanel(panel),
                disabled: appSettings.sidebar[panel].collapsed,
              },
            ]"
            role="separator"
            aria-orientation="horizontal"
            :aria-disabled="appSettings.sidebar[panel].collapsed"
            :aria-label="`调整${panel === 'servers' ? '服务器' : panel === 'automation' ? '自定义指令' : '远程文件'}面板高度`"
            @pointerdown="!appSettings.sidebar[panel].collapsed && startSidebarPanelResize($event, panel)"></div>
        </template>
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
        v-if="appSettings.ai.enabled"
        :class="[
          'ai-panel-resizer',
          { active: isResizingAiPanel, collapsed: !isAiPanelOpen },
        ]"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整 AI 面板宽度"
        :aria-hidden="!isAiPanelOpen"
        @mousedown="
          isAiPanelOpen &&
          startAiPanelResize(
            $event,
            getContentShellRightBoundary(),
          )
        "></div>

      <AiPanel
        v-if="appSettings.ai.enabled"
        :open="isAiPanelOpen"
        :enabled="appSettings.ai.enabled"
        :mode="aiMode"
        :input-text="aiInputText"
        :is-sending="isAiSending"
        :error="aiError"
        :messages="aiMessages"
        :command-cards="aiCommandCards"
        :should-suggest-new-conversation="shouldSuggestNewConversation"
        :context="aiContext"
        :configs="appSettings.ai.configs"
        :active-config-id="appSettings.ai.activeConfigId"
        @toggle="toggleAiPanel"
        @set-mode="setAiMode"
        @update-input-text="aiInputText = $event"
        @send="sendAiMessage(aiContext)"
        @stop="cancelAiMessage(aiContext)"
        @start-new-conversation="startNewAiConversation(activeTabId)"
        @run-approved="runAiApprovedCommand"
        @reject-approval="rejectAiApproval"
        @select-model="updateAiSetting('activeConfigId', $event)" />
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
      @update-ai-settings="updateAiSettings"
      @update-theme-mode="updateThemeMode"
      @select-selection-background="selectSelectionBackground" />

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
