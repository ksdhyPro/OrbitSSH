<script setup lang="ts">
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  openSearchPanel,
  replaceAll,
  replaceNext,
  setSearchQuery,
  SearchQuery,
} from "@codemirror/search";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { formatFileSize, formatModifyTime } from "./utils/format";
import {
  getStatusText,
  getDownloadProgressPercent,
  getDownloadTaskStatusText,
} from "./utils/status-text";
import { getRootName, getRemoteParentPath, parseOsc7Path } from "./utils/path";
import { flattenRemoteTree, updateNodeChildren } from "./utils/file-tree";
import { copyTextByFallback } from "./utils/clipboard";
import { isKnownEditableTextFile, isPreviewImageFile } from "./utils/file-kind";
import { createFileEditorTheme } from "./utils/codemirror/theme";
import { createFileEditorState } from "./utils/codemirror/state";
import type { TerminalTab, TerminalSearchMatch } from "./types/terminal";
import type {
  VisibleRemoteFileNode,
  SftpTreeState,
  FileContextMenuState,
  FileTextProbeState,
  ImagePreviewState,
} from "./types/sftp";
import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Terminal, type IDisposable } from "@xterm/xterm";
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

import arrowDownIcon from "./assets/icons/arrow-down.svg";
import arrowUpIcon from "./assets/icons/arrow-up.svg";
import caseSensitiveIcon from "./assets/icons/case-sensitive.svg";
import chevronRightIcon from "./assets/icons/chevron-right.svg";
import closeIcon from "./assets/icons/close.svg";
import copyIcon from "./assets/icons/copy.svg";
import editIcon from "./assets/icons/edit.svg";
import fileIcon from "./assets/icons/file.svg";
import folderIcon from "./assets/icons/folder.svg";
import maximizeIcon from "./assets/icons/maximize.svg";
import minimizeIcon from "./assets/icons/minimize.svg";
import plusIcon from "./assets/icons/plus.svg";
import refreshIcon from "./assets/icons/refresh.svg";
import restoreIcon from "./assets/icons/restore.svg";
import settingsIcon from "./assets/icons/settings.svg";
import taskIcon from "./assets/icons/task.svg";
import pauseIcon from "./assets/icons/pause.svg";
import continueIcon from "./assets/icons/continue.svg";
import syncPathIcon from "./assets/icons/sync-path.svg";
import trashIcon from "./assets/icons/trash.svg";

import AppDialog from "./components/AppDialog.vue";
import type { ServerConfig, ServerInput } from "../shared/server";
import { defaultAppSettings, type AppSettings } from "../shared/settings";
import type {
  RemoteFileNode,
  SftpPreviewImageResult,
} from "../shared/sftp";
import type { TerminalStatusEvent } from "../shared/terminal";
import { storeToRefs } from "pinia";
import { useCoreStore } from "./stores/useCoreStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useWindowStore } from "./stores/useWindowStore";
import { useSidebarStore } from "./stores/useSidebarStore";
import { useDownloadsStore } from "./stores/useDownloadsStore";

const coreStore = useCoreStore();
const settingsStore = useSettingsStore();
const windowStore = useWindowStore();
const sidebarStore = useSidebarStore();
const downloadsStore = useDownloadsStore();

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

const servers = ref<ServerConfig[]>([]);

const tabs = ref<TerminalTab[]>([]);
const activeTabId = ref("");

const isConnectionDialogOpen = ref(false);
const isFileEditorOpen = ref(false);
const isFileEditorCloseConfirmOpen = ref(false);
const isImagePreviewOpen = ref(false);
const isSftpPathPromptOpen = ref(false);
const fileEditorContainer = ref<HTMLElement | null>(null);
const fileEditorSearchInput = ref<HTMLInputElement | null>(null);
const fileEditorReplaceInput = ref<HTMLInputElement | null>(null);
const isTerminalSearchOpen = ref(false);
const isTerminalSearchCaseSensitive = ref(false);
const isFileEditorSearchOpen = ref(false);
const isFileEditorSearchCaseSensitive = ref(false);
const terminalSearchKeyword = ref("");
const terminalSearchInput = ref<HTMLInputElement | null>(null);
const terminalSearchResult = reactive({
  index: 0,
  total: 0,
});
const formError = ref("");
const listError = ref("");
const editingServerId = ref<string | null>(null);
const isServerListLoading = ref(false);
const isSubmittingServer = ref(false);
const runtimeError = ref("");
const fileEditorError = ref("");
const fileEditorSearchKeyword = ref("");
const fileEditorReplaceText = ref("");
const filePathInput = ref("");
const sftpPathPromptTitle = ref("路径无法访问");
const sftpPathPromptMessage = ref("");
const sftpTrees = ref<Record<string, SftpTreeState>>({});
const fileTreeElement = ref<HTMLElement | null>(null);
const fileContextMenu = reactive<FileContextMenuState>({
  open: false,
  x: 0,
  y: 0,
  node: null,
});
const fileTextProbeStates = reactive<Record<string, FileTextProbeState>>({});
const fileEditor = reactive({
  tabId: "",
  path: "",
  name: "",
  content: "",
  savedContent: "",
  loading: false,
  saving: false,
  searchIndex: 0,
  searchTotal: 0,
});
const imagePreview = reactive<ImagePreviewState>({
  tabId: "",
  path: "",
  name: "",
  dataUrl: "",
  mimeType: "",
  loading: false,
  error: "",
});
const terminalHosts = new Map<string, HTMLElement>();
const terminalInstances = new Map<
  string,
  {
    terminal: Terminal;
    fitAddon: FitAddon;
    searchAddon: SearchAddon;
    searchResultsDisposable: IDisposable;
    canvasAddon?: CanvasAddon;
  }
>();
let removeTerminalDataListener: (() => void) | undefined;
let removeTerminalStatusListener: (() => void) | undefined;
let fitScheduleTimer: number | undefined;
let lastTerminalSearchKeyword = "";
let fileEditorView: EditorView | undefined;
const fileEditorThemeCompartment = new Compartment();

const connectionForm = reactive({
  name: "",
  host: "",
  port: 22,
  username: "",
  password: "",
});

const hasServers = computed(() => servers.value.length > 0);

const activeTab = computed(() =>
  tabs.value.find(tab => tab.id === activeTabId.value),
);

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

const isFileEditorDirty = computed(
  () => fileEditor.content !== fileEditor.savedContent,
);

const fileEditorTitle = computed(() => {
  if (!fileEditor.name) {
    return "编辑文件";
  }

  return `${isFileEditorDirty.value ? "* " : ""}${fileEditor.name}`;
});

const fileEditorLineNumbers = computed(() => {
  const lineCount = Math.max(fileEditor.content.split("\n").length, 1);

  return Array.from({ length: lineCount }, (_item, index) => index + 1).join(
    "\n",
  );
});

function applyTerminalSettings(): void {
  terminalInstances.forEach(({ terminal, fitAddon }) => {
    terminal.options.fontSize = appSettings.terminal.fontSize;
    terminal.options.lineHeight = appSettings.terminal.lineHeight;
    terminal.options.theme = {
      ...terminal.options.theme,
      selectionBackground: appSettings.terminal.selectionBackground,
    };
    fitAddon.fit();
  });
  scheduleTerminalFit();
}

// 打开终端搜索框后主动聚焦，便于 Ctrl+F 后直接输入关键词。
async function openTerminalSearch(): Promise<void> {
  if (!activeTabId.value) {
    return;
  }

  isTerminalSearchOpen.value = true;
  await nextTick();
  terminalSearchInput.value?.focus();
  terminalSearchInput.value?.select();
}

// 关闭搜索框时清空搜索词，并把焦点交还给当前终端。
async function closeTerminalSearch(): Promise<void> {
  isTerminalSearchOpen.value = false;
  terminalSearchKeyword.value = "";
  resetTerminalSearchResult();
  await nextTick();
  terminalInstances.get(activeTabId.value)?.terminal.focus();
}

function resetTerminalSearchResult(): void {
  terminalSearchResult.index = 0;
  terminalSearchResult.total = 0;
}

function getBufferLineTextAndColumns(
  terminal: Terminal,
  row: number,
): { text: string; columns: number[] } {
  const line = terminal.buffer.active.getLine(row);

  if (!line) {
    return { text: "", columns: [] };
  }

  let text = "";
  const columns: number[] = [];

  for (let col = 0; col < line.length; col += 1) {
    const cell = line.getCell(col);

    if (!cell || cell.getWidth() === 0) {
      continue;
    }

    const chars = cell.getChars() || " ";
    columns.push(col);
    text += chars;
  }

  return { text: text.trimEnd(), columns };
}

function getTerminalSearchMatches(
  terminal: Terminal,
  keyword: string,
): TerminalSearchMatch[] {
  const matches: TerminalSearchMatch[] = [];
  const searchNeedle = isTerminalSearchCaseSensitive.value
    ? keyword
    : keyword.toLowerCase();

  for (let row = 0; row < terminal.buffer.active.length; row += 1) {
    const { text, columns } = getBufferLineTextAndColumns(terminal, row);
    const searchLine = isTerminalSearchCaseSensitive.value
      ? text
      : text.toLowerCase();
    let index = searchLine.indexOf(searchNeedle);

    while (index >= 0) {
      const nextColumnIndex = columns.findIndex(column => column >= index);
      const col =
        nextColumnIndex >= 0
          ? columns[nextColumnIndex]
          : Math.min(index, terminal.cols - 1);
      const endIndex = index + keyword.length;
      const nextEndColumnIndex = columns.findIndex(
        column => column >= endIndex,
      );
      const endCol =
        nextEndColumnIndex >= 0
          ? columns[nextEndColumnIndex]
          : Math.min(col + keyword.length, terminal.cols);

      matches.push({
        row,
        col,
        size: Math.max(endCol - col, 1),
      });
      index = searchLine.indexOf(
        searchNeedle,
        index + Math.max(keyword.length, 1),
      );
    }
  }

  return matches;
}

function selectTerminalSearchMatch(
  terminal: Terminal,
  match: TerminalSearchMatch,
): void {
  terminal.select(match.col, match.row, match.size);

  if (
    match.row < terminal.buffer.active.viewportY ||
    match.row >= terminal.buffer.active.viewportY + terminal.rows
  ) {
    terminal.scrollLines(
      match.row -
        terminal.buffer.active.viewportY -
        Math.floor(terminal.rows / 2),
    );
  }
}

function getTerminalSearchOptions(incremental = false): ISearchOptions {
  return {
    caseSensitive: isTerminalSearchCaseSensitive.value,
    incremental,
    decorations: {
      matchBackground: "#324152",
      matchBorder: "#52637A",
      matchOverviewRuler: "#52637A",
      activeMatchBackground: "#A87922",
      activeMatchBorder: "#F0B44C",
      activeMatchColorOverviewRuler: "#F0B44C",
    },
  };
}

// 使用 xterm SearchAddon 在当前激活终端中搜索关键词。
function searchActiveTerminal(
  direction: "current" | "next" | "previous" = "current",
): void {
  const keyword = terminalSearchKeyword.value;
  const terminalEntry = terminalInstances.get(activeTabId.value);

  if (!keyword || !terminalEntry) {
    resetTerminalSearchResult();
    terminalEntry?.searchAddon.clearDecorations();
    return;
  }

  const matches = getTerminalSearchMatches(terminalEntry.terminal, keyword);

  if (matches.length === 0) {
    resetTerminalSearchResult();
    terminalEntry.searchAddon.clearDecorations();
    terminalEntry.terminal.clearSelection();
    lastTerminalSearchKeyword = keyword;
    return;
  }

  const keywordChanged = keyword !== lastTerminalSearchKeyword;
  let nextIndex = keywordChanged
    ? 0
    : Math.max(terminalSearchResult.index - 1, 0);

  if (direction === "next" && !keywordChanged) {
    nextIndex = (nextIndex + 1) % matches.length;
  } else if (direction === "previous" && !keywordChanged) {
    nextIndex = (nextIndex - 1 + matches.length) % matches.length;
  }

  try {
    const options = getTerminalSearchOptions(direction === "current");

    if (direction === "previous") {
      terminalEntry.searchAddon.findPrevious(keyword, options);
    } else {
      terminalEntry.searchAddon.findNext(keyword, options);
    }
  } catch (error) {
    writeRendererLog(
      "xterm 搜索装饰失败，已回退到 buffer 搜索",
      {
        tabId: activeTabId.value,
        keyword,
        error: error instanceof Error ? error.message : String(error),
      },
      "warn",
    );
  }

  selectTerminalSearchMatch(terminalEntry.terminal, matches[nextIndex]);
  terminalSearchResult.index = nextIndex + 1;
  terminalSearchResult.total = matches.length;
  lastTerminalSearchKeyword = keyword;
}

// 切换大小写敏感后立即按当前关键词重新搜索，反馈更直接。
function toggleTerminalSearchCaseSensitive(): void {
  isTerminalSearchCaseSensitive.value = !isTerminalSearchCaseSensitive.value;
  searchActiveTerminal();
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

// xterm 聚焦时会优先处理键盘输入，这里拦截应用级快捷键，避免发送到远端 shell。
function handleTerminalKeyEvent(event: KeyboardEvent): boolean {
  const isSearchShortcut =
    event.type === "keydown" &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "f";

  if (isSearchShortcut) {
    event.preventDefault();
    void openTerminalSearch();
    return false;
  }

  if (
    event.type === "keydown" &&
    event.key === "Escape" &&
    isTerminalSearchOpen.value
  ) {
    event.preventDefault();
    void closeTerminalSearch();
    return false;
  }

  return true;
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


function destroyFileEditorView(): void {
  fileEditorView?.destroy();
  fileEditorView = undefined;
}

async function mountFileEditorView(): Promise<void> {
  await nextTick();

  if (!fileEditorContainer.value) {
    return;
  }

  destroyFileEditorView();
  fileEditorView = new EditorView({
    parent: fileEditorContainer.value,
    state: createFileEditorState({
      content: fileEditor.content,
      fileName: fileEditor.name,
      themeExtension: fileEditorThemeCompartment.of(
        createFileEditorTheme(appSettings.terminal.selectionBackground),
      ),
      onSearchShortcut: () => {
        void openFileEditorSearch();
      },
      shouldCloseOnEscape: () => isFileEditorSearchOpen.value,
      onCloseSearch: () => {
        void closeFileEditorSearch();
      },
      onDocChanged: view => {
        fileEditor.content = view.state.doc.toString();
        if (fileEditorSearchKeyword.value) {
          updateFileEditorSearchResultFromView(view);
        }
      },
    }),
  });
  fileEditorView.focus();
}

function canDownloadRemoteFile(node: RemoteFileNode | null): boolean {
  return Boolean(node && node.type === "file" && activeTabId.value);
}

function getFileTextProbeState(
  node: RemoteFileNode | null,
): FileTextProbeState | undefined {
  if (!node) {
    return undefined;
  }

  return fileTextProbeStates[node.path];
}

function isEditableTextFile(node: RemoteFileNode | null): boolean {
  if (isKnownEditableTextFile(node)) {
    return true;
  }

  return getFileTextProbeState(node)?.status === "text";
}

function getFileEditMenuLabel(node: RemoteFileNode | null): string {
  const probeState = getFileTextProbeState(node);

  if (probeState?.status === "checking") {
    return "检测中...";
  }

  return "编辑";
}

function canDeleteRemoteNode(node: RemoteFileNode | null): boolean {
  const tree = activeSftpTree.value;

  return Boolean(node && tree && node.path !== tree.root.path);
}

async function probeFileTextSupport(node: RemoteFileNode): Promise<void> {
  if (
    node.type !== "file" ||
    isKnownEditableTextFile(node) ||
    !activeTabId.value ||
    fileTextProbeStates[node.path]
  ) {
    return;
  }

  fileTextProbeStates[node.path] = { status: "checking" };

  try {
    const result = await orbitSSHApi.value?.sftp.probeText({
      tabId: activeTabId.value,
      path: node.path,
      size: node.size,
    });

    if (!result) {
      fileTextProbeStates[node.path] = {
        status: "error",
        reason: "read-error",
      };
      return;
    }

    fileTextProbeStates[node.path] = {
      status: result.isText ? "text" : "unsupported",
      reason: result.reason,
    };
  } catch (error) {
    fileTextProbeStates[node.path] = {
      status: "error",
      reason: "read-error",
    };
    writeRendererLog(
      "远程文件文本探测失败",
      {
        tabId: activeTabId.value,
        path: node.path,
        error: error instanceof Error ? error.message : String(error),
      },
      "warn",
    );
  }
}

async function ensureEditableTextFile(node: RemoteFileNode): Promise<boolean> {
  if (isEditableTextFile(node)) {
    return true;
  }

  if (node.type !== "file" || !activeTabId.value) {
    return false;
  }

  await probeFileTextSupport(node);
  return isEditableTextFile(node);
}

function closeFileContextMenu(): void {
  fileContextMenu.open = false;
  fileContextMenu.node = null;
}

function openFileContextMenu(event: MouseEvent, node: RemoteFileNode): void {
  event.preventDefault();
  event.stopPropagation();
  fileContextMenu.open = true;
  fileContextMenu.x = event.clientX;
  fileContextMenu.y = event.clientY;
  fileContextMenu.node = node;

  if (!isPreviewImageFile(node)) {
    void probeFileTextSupport(node);
  }
}

async function editContextFile(): Promise<void> {
  const node = fileContextMenu.node;

  if (!node || !isEditableTextFile(node) || !activeTabId.value) {
    return;
  }

  closeFileContextMenu();
  await openRemoteFileEditor(node);
}

function applyImagePreviewResult(
  result: SftpPreviewImageResult,
  tabId: string,
): void {
  imagePreview.tabId = tabId;
  imagePreview.path = result.path;
  imagePreview.name = result.name;
  imagePreview.dataUrl = result.dataUrl;
  imagePreview.mimeType = result.mimeType;
  imagePreview.loading = false;
  imagePreview.error = "";
}

async function openRemoteImagePreview(node: RemoteFileNode): Promise<void> {
  const tabId = activeTabId.value;

  if (!tabId || !orbitSSHApi.value || !isPreviewImageFile(node)) {
    return;
  }

  imagePreview.tabId = tabId;
  imagePreview.path = node.path;
  imagePreview.name = node.name;
  imagePreview.dataUrl = "";
  imagePreview.mimeType = "";
  imagePreview.loading = true;
  imagePreview.error = "";
  isImagePreviewOpen.value = true;

  try {
    const result = await orbitSSHApi.value.sftp.previewImage({
      tabId,
      path: node.path,
      name: node.name,
      size: node.size,
    });

    applyImagePreviewResult(result, tabId);
  } catch (error) {
    imagePreview.loading = false;
    imagePreview.error =
      error instanceof Error ? error.message : "图片预览失败";
  }
}

function closeImagePreview(): void {
  isImagePreviewOpen.value = false;
  imagePreview.tabId = "";
  imagePreview.path = "";
  imagePreview.name = "";
  imagePreview.dataUrl = "";
  imagePreview.mimeType = "";
  imagePreview.loading = false;
  imagePreview.error = "";
}

async function previewContextFile(): Promise<void> {
  const node = fileContextMenu.node;

  if (!node || !isPreviewImageFile(node)) {
    return;
  }

  closeFileContextMenu();
  await openRemoteImagePreview(node);
}

async function openRemoteFileEditor(node: RemoteFileNode): Promise<void> {
  if (!activeTabId.value || !orbitSSHApi.value) {
    return;
  }

  fileEditor.loading = true;
  fileEditorError.value = "";
  isFileEditorOpen.value = true;
  fileEditor.tabId = activeTabId.value;
  fileEditor.path = node.path;
  fileEditor.name = node.name;
  fileEditor.content = "";
  fileEditor.savedContent = "";
  fileEditorSearchKeyword.value = "";
  fileEditorReplaceText.value = "";
  isFileEditorSearchOpen.value = false;
  fileEditor.searchIndex = 0;
  fileEditor.searchTotal = 0;

  try {
    const result = await orbitSSHApi.value.sftp.readText({
      tabId: activeTabId.value,
      path: node.path,
    });

    fileEditor.path = result.path;
    fileEditor.content = result.content;
    fileEditor.savedContent = result.content;
    fileEditor.loading = false;
    await mountFileEditorView();
  } catch (error) {
    fileEditorError.value =
      error instanceof Error ? error.message : "读取远程文件失败";
    fileEditor.loading = false;
  }
}

async function openRemoteFileEditorByDoubleClick(
  node: RemoteFileNode,
): Promise<void> {
  if (node.type !== "file") {
    return;
  }

  if (isPreviewImageFile(node)) {
    await openRemoteImagePreview(node);
    return;
  }

  const editable = await ensureEditableTextFile(node);

  if (editable) {
    await openRemoteFileEditor(node);
  }
}

async function downloadRemoteFileNode(node: RemoteFileNode): Promise<void> {
  const tabId = activeTabId.value;

  if (!tabId || !orbitSSHApi.value || !canDownloadRemoteFile(node)) {
    return;
  }

  try {
    await orbitSSHApi.value.sftp.download({
      tabId,
      path: node.path,
      name: node.name,
      size: node.size,
    });
  } catch (error) {
    showSftpPathPrompt(
      error instanceof Error ? error.message : "文件下载失败",
      "下载失败",
    );
  }
}

async function downloadContextFile(): Promise<void> {
  const node = fileContextMenu.node;

  if (!node || !canDownloadRemoteFile(node)) {
    return;
  }

  closeFileContextMenu();
  await downloadRemoteFileNode(node);
}

async function downloadImagePreviewFile(): Promise<void> {
  if (
    !imagePreview.tabId ||
    !imagePreview.path ||
    !imagePreview.name ||
    !orbitSSHApi.value
  ) {
    return;
  }

  try {
    await orbitSSHApi.value.sftp.download({
      tabId: imagePreview.tabId,
      path: imagePreview.path,
      name: imagePreview.name,
    });
  } catch (error) {
    imagePreview.error =
      error instanceof Error ? error.message : "文件下载失败";
  }
}

async function deleteContextFile(): Promise<void> {
  const node = fileContextMenu.node;
  const tabId = activeTabId.value;
  const typeLabel = node?.type === "directory" ? "文件夹" : "文件";

  if (!node || !tabId || !orbitSSHApi.value || !canDeleteRemoteNode(node)) {
    return;
  }

  const confirmMessage =
    node.type === "directory"
      ? `确认删除文件夹“${node.name}”？\n\n该操作会递归删除其中的所有文件和子文件夹。`
      : `确认删除文件“${node.name}”？`;

  if (!window.confirm(confirmMessage)) {
    closeFileContextMenu();
    return;
  }

  closeFileContextMenu();

  try {
    await orbitSSHApi.value.sftp.delete({
      tabId,
      path: node.path,
      type: node.type,
    });

    // 删除后清理本地探测状态，避免同路径新文件复用旧结论。
    delete fileTextProbeStates[node.path];

    if (fileEditor.path === node.path) {
      closeFileEditor();
    }

    const parentPath = getRemoteParentPath(node.path);
    const children = await orbitSSHApi.value.sftp.list({
      tabId,
      path: parentPath,
    });
    const latestTree = sftpTrees.value[tabId];

    if (!latestTree) {
      return;
    }

    const nextExpandedPaths = new Set(latestTree.expandedPaths);
    nextExpandedPaths.delete(node.path);

    setSftpTree(tabId, {
      ...latestTree,
      root: updateNodeChildren(latestTree.root, parentPath, children),
      expandedPaths: nextExpandedPaths,
      error: "",
    });
  } catch (error) {
    const latestTree = sftpTrees.value[tabId];

    if (latestTree) {
      setSftpTree(tabId, {
        ...latestTree,
        error: error instanceof Error ? error.message : `删除${typeLabel}失败`,
      });
    }

    writeRendererLog(
      "远程文件节点删除失败",
      {
        tabId,
        path: node.path,
        type: node.type,
        error: error instanceof Error ? error.message : String(error),
      },
      "error",
    );
  }
}

function requestCloseFileEditor(): void {
  if (isFileEditorDirty.value) {
    isFileEditorCloseConfirmOpen.value = true;
    return;
  }

  closeFileEditor();
}

function closeFileEditor(): void {
  isFileEditorOpen.value = false;
  isFileEditorCloseConfirmOpen.value = false;
  fileEditorError.value = "";
  fileEditorSearchKeyword.value = "";
  fileEditorReplaceText.value = "";
  isFileEditorSearchOpen.value = false;
  fileEditor.tabId = "";
  fileEditor.path = "";
  fileEditor.name = "";
  fileEditor.content = "";
  fileEditor.savedContent = "";
  fileEditor.searchIndex = 0;
  fileEditor.searchTotal = 0;
  destroyFileEditorView();
}

async function saveFileEditor(): Promise<boolean> {
  if (!fileEditor.tabId || !fileEditor.path || fileEditor.saving) {
    return false;
  }

  fileEditor.saving = true;
  fileEditorError.value = "";

  try {
    fileEditor.content =
      fileEditorView?.state.doc.toString() ?? fileEditor.content;
    await orbitSSHApi.value.sftp.writeText({
      tabId: fileEditor.tabId,
      path: fileEditor.path,
      content: fileEditor.content,
    });
    fileEditor.savedContent = fileEditor.content;
    return true;
  } catch (error) {
    fileEditorError.value =
      error instanceof Error ? error.message : "保存远程文件失败";
    return false;
  } finally {
    fileEditor.saving = false;
  }
}

async function saveAndCloseFileEditor(): Promise<void> {
  const saved = await saveFileEditor();

  if (saved) {
    closeFileEditor();
  }
}

function discardFileEditorChanges(): void {
  closeFileEditor();
}

function syncFileEditorScroll(event: Event): void {
  const target = event.target as HTMLTextAreaElement;
  const lineNumbers = target
    .closest(".file-editor-body")
    ?.querySelector<HTMLElement>(".file-editor-line-numbers");

  if (lineNumbers) {
    lineNumbers.scrollTop = target.scrollTop;
  }
}

function updateFileEditorSearchResult(index: number, total: number): void {
  fileEditor.searchIndex = index;
  fileEditor.searchTotal = total;
}

function getFileEditorSearchMatches(
  view: EditorView,
  keyword: string,
): number[] {
  if (!keyword) {
    return [];
  }

  const content = isFileEditorSearchCaseSensitive.value
    ? view.state.doc.toString()
    : view.state.doc.toString().toLowerCase();
  const needle = isFileEditorSearchCaseSensitive.value
    ? keyword
    : keyword.toLowerCase();
  const matches: number[] = [];
  let index = content.indexOf(needle);

  while (index >= 0) {
    matches.push(index);
    index = content.indexOf(needle, index + Math.max(needle.length, 1));
  }

  return matches;
}

function updateFileEditorSearchResultFromView(view = fileEditorView): void {
  if (!view || !fileEditorSearchKeyword.value) {
    updateFileEditorSearchResult(0, 0);
    return;
  }

  const matches = getFileEditorSearchMatches(
    view,
    fileEditorSearchKeyword.value,
  );

  if (matches.length === 0) {
    updateFileEditorSearchResult(0, 0);
    return;
  }

  const selectionFrom = view.state.selection.main.from;
  const activeIndex = matches.findIndex(
    match =>
      match <= selectionFrom &&
      selectionFrom <= match + fileEditorSearchKeyword.value.length,
  );

  updateFileEditorSearchResult(
    activeIndex >= 0 ? activeIndex + 1 : 1,
    matches.length,
  );
}

function applyFileEditorSearchQuery(): void {
  const view = fileEditorView;

  if (!view) {
    return;
  }

  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: fileEditorSearchKeyword.value,
        replace: fileEditorReplaceText.value,
        caseSensitive: isFileEditorSearchCaseSensitive.value,
      }),
    ),
  });
  updateFileEditorSearchResultFromView(view);
}

async function openFileEditorSearch(): Promise<void> {
  isFileEditorSearchOpen.value = true;
  if (fileEditorView) {
    openSearchPanel(fileEditorView);
  }
  await nextTick();
  window.requestAnimationFrame(() => {
    fileEditorSearchInput.value?.focus();
    fileEditorSearchInput.value?.select();
  });
}

async function closeFileEditorSearch(): Promise<void> {
  isFileEditorSearchOpen.value = false;
  fileEditorSearchKeyword.value = "";
  fileEditorReplaceText.value = "";
  if (fileEditorView) {
    closeSearchPanel(fileEditorView);
  }
  updateFileEditorSearchResult(0, 0);
  await nextTick();
  fileEditorView?.focus();
}

function toggleFileEditorSearchCaseSensitive(): void {
  isFileEditorSearchCaseSensitive.value =
    !isFileEditorSearchCaseSensitive.value;
  applyFileEditorSearchQuery();
  searchFileEditor();
}

function searchFileEditor(direction: "next" | "previous" = "next"): void {
  const view = fileEditorView;
  const keyword = fileEditorSearchKeyword.value;

  if (!view || !keyword) {
    updateFileEditorSearchResult(0, 0);
    return;
  }

  applyFileEditorSearchQuery();
  (direction === "previous" ? findPrevious : findNext)(view);
  updateFileEditorSearchResultFromView(view);
}

function replaceCurrentFileEditorMatch(): void {
  const view = fileEditorView;

  if (!view || !fileEditorSearchKeyword.value) {
    updateFileEditorSearchResult(0, 0);
    return;
  }

  applyFileEditorSearchQuery();
  replaceNext(view);
  fileEditor.content = view.state.doc.toString();
  updateFileEditorSearchResultFromView(view);
}

function replaceAllFileEditorMatches(): void {
  const view = fileEditorView;

  if (!view || !fileEditorSearchKeyword.value) {
    updateFileEditorSearchResult(0, 0);
    return;
  }

  applyFileEditorSearchQuery();
  replaceAll(view);
  fileEditor.content = view.state.doc.toString();
  updateFileEditorSearchResultFromView(view);
}

async function handleFileEditorKeydown(event: KeyboardEvent): Promise<void> {
  const isSearchShortcut =
    (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";

  if (isSearchShortcut) {
    event.preventDefault();
    await openFileEditorSearch();
    return;
  }

  if (event.key === "Escape" && isFileEditorSearchOpen.value) {
    event.preventDefault();
    await closeFileEditorSearch();
  }
}

// 重置新增连接表单，避免再次打开弹窗时残留上一次输入。
function resetConnectionForm(): void {
  connectionForm.name = "";
  connectionForm.host = "";
  connectionForm.port = 22;
  connectionForm.username = "";
  connectionForm.password = "";
  formError.value = "";
  editingServerId.value = null;
}

// 打开新增连接弹窗，只处理当前静态页面的展示状态。
function openConnectionDialog(): void {
  resetConnectionForm();
  isConnectionDialogOpen.value = true;
}

// 关闭新增连接弹窗，当前阶段不做持久化和 SSH 连接。
function closeConnectionDialog(): void {
  isConnectionDialogOpen.value = false;
  formError.value = "";
  editingServerId.value = null;
}

// 提交连接表单时做基础校验，当前阶段只更新页面内预览数据。
async function submitConnectionForm(): Promise<void> {
  if (
    !connectionForm.name.trim() ||
    !connectionForm.host.trim() ||
    !connectionForm.username.trim()
  ) {
    formError.value = "请填写名称、Host 和 Username";
    return;
  }

  if (!editingServerId.value && !connectionForm.password) {
    formError.value = "请填写 Password";
    return;
  }

  if (
    !Number.isInteger(connectionForm.port) ||
    connectionForm.port < 1 ||
    connectionForm.port > 65535
  ) {
    formError.value = "Port 需要在 1 到 65535 之间";
    return;
  }

  const nextServer: ServerInput = {
    name: connectionForm.name.trim(),
    host: connectionForm.host.trim(),
    port: connectionForm.port,
    username: connectionForm.username.trim(),
    password: connectionForm.password,
  };

  isSubmittingServer.value = true;
  formError.value = "";

  try {
    if (!orbitSSHApi.value) {
      throw new Error("请通过 Electron 窗口启动应用");
    }

    if (editingServerId.value) {
      const updatedServer = await orbitSSHApi.value.servers.update({
        id: editingServerId.value,
        ...nextServer,
      });
      servers.value = servers.value.map(server =>
        server.id === updatedServer.id ? updatedServer : server,
      );
    } else {
      const createdServer = await orbitSSHApi.value.servers.create(nextServer);
      servers.value = [createdServer, ...servers.value];
    }

    closeConnectionDialog();
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "保存服务器失败";
  } finally {
    isSubmittingServer.value = false;
  }
}

// 打开编辑弹窗并填充当前服务器信息，密码不从列表回填。
function editServer(server: ServerConfig): void {
  editingServerId.value = server.id;
  connectionForm.name = server.name;
  connectionForm.host = server.host;
  connectionForm.port = server.port;
  connectionForm.username = server.username;
  connectionForm.password = "";
  formError.value = "";
  isConnectionDialogOpen.value = true;
}

// 删除本地服务器配置，同时移除对应的加密密码缓存。
async function deleteServer(serverId: string): Promise<void> {
  const shouldDelete = window.confirm("确认删除该服务器配置？");

  if (!shouldDelete) {
    return;
  }

  try {
    if (!orbitSSHApi.value) {
      throw new Error("请通过 Electron 窗口启动应用");
    }

    await orbitSSHApi.value.servers.delete(serverId);
    servers.value = servers.value.filter(server => server.id !== serverId);
  } catch (error) {
    listError.value = error instanceof Error ? error.message : "删除服务器失败";
  }
}

function setTerminalHost(tabId: string, element: unknown): void {
  if (element instanceof HTMLElement) {
    terminalHosts.set(tabId, element);
    return;
  }

  terminalHosts.delete(tabId);
}

function fitTerminal(tabId: string): void {
  const terminalEntry = terminalInstances.get(tabId);

  if (!terminalEntry) {
    return;
  }

  terminalEntry.fitAddon.fit();

  const { cols, rows } = terminalEntry.terminal;
  if (cols > 0 && rows > 0) {
    void orbitSSHApi.value?.terminals.resize({
      tabId,
      cols,
      rows,
    });
  }
}

function fitActiveTerminal(): void {
  if (activeTabId.value) {
    fitTerminal(activeTabId.value);
  }
}

function scheduleTerminalFit(): void {
  window.clearTimeout(fitScheduleTimer);
  window.requestAnimationFrame(() => {
    fitActiveTerminal();
  });
  fitScheduleTimer = window.setTimeout(() => {
    fitActiveTerminal();
    window.requestAnimationFrame(fitActiveTerminal);
  }, 120);
}

// 为每个 Tab 创建独立 xterm 实例，并把输入通过 IPC 写入 SSH shell。
function createTerminalInstance(tab: TerminalTab): void {
  const host = terminalHosts.get(tab.id);

  if (!host || terminalInstances.has(tab.id)) {
    return;
  }

  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: appSettings.terminal.fontSize,
    lineHeight: appSettings.terminal.lineHeight,
    theme: {
      background: "#0b0f14",
      foreground: "#d8e2f0",
      cursor: "#ffffff",
      selectionBackground: appSettings.terminal.selectionBackground,
      // Canvas 渲染器不会回退到 xterm 内置默认色板，必须显式给出 ANSI 16 色，
      // 否则 ls 的目录/可执行/软链等 ANSI 颜色码会被当成普通前景色渲染（全白）。
      black: "#0b0f14",
      red: "#ff6b6b",
      green: "#89dcae",
      yellow: "#f0b44c",
      blue: "#6fb6ff",
      magenta: "#c891d8",
      cyan: "#5fcabe",
      white: "#d8e2f0",
      brightBlack: "#59677b",
      brightRed: "#ff9a9a",
      brightGreen: "#aeebc4",
      brightYellow: "#f5cb7d",
      brightBlue: "#9bc9ff",
      brightMagenta: "#dab0e4",
      brightCyan: "#8eecd9",
      brightWhite: "#ffffff",
    },
  });
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  let canvasAddon: CanvasAddon | undefined;

  try {
    canvasAddon = new CanvasAddon();
    terminal.loadAddon(canvasAddon);
    writeRendererLog("xterm Canvas 渲染器已启用", { tabId: tab.id });
  } catch (error) {
    writeRendererLog(
      "xterm Canvas 渲染器启用失败，回退默认渲染",
      {
        tabId: tab.id,
        error: error instanceof Error ? error.message : String(error),
      },
      "warn",
    );
  }

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.attachCustomKeyEventHandler(handleTerminalKeyEvent);
  const searchResultsDisposable = searchAddon.onDidChangeResults(event => {
    terminalSearchResult.index =
      event.resultIndex >= 0 ? event.resultIndex + 1 : 0;
    terminalSearchResult.total = event.resultCount;
  });
  terminal.open(host);
  fitAddon.fit();
  terminal.writeln(`正在连接 ${tab.title} ...`);

  terminal.parser.registerOscHandler(7, data => {
    const terminalPath = parseOsc7Path(data);

    if (!terminalPath) {
      return false;
    }

    tabs.value = tabs.value.map(item =>
      item.id === tab.id ? { ...item, currentPath: terminalPath } : item,
    );
    writeRendererLog("终端当前路径已更新", {
      tabId: tab.id,
      path: terminalPath,
    });

    return true;
  });

  terminal.onData(data => {
    void orbitSSHApi.value?.terminals.write(tab.id, data);
  });

  terminal.onResize(({ cols, rows }) => {
    void orbitSSHApi.value?.terminals.resize({
      tabId: tab.id,
      cols,
      rows,
    });
  });

  terminalInstances.set(tab.id, {
    terminal,
    fitAddon,
    searchAddon,
    searchResultsDisposable,
    canvasAddon,
  });
}

async function openServerTerminal(server: ServerConfig): Promise<void> {
  try {
    if (!orbitSSHApi.value) {
      throw new Error("请通过 Electron 窗口启动应用");
    }

    const result = await orbitSSHApi.value.terminals.open(server.id);
    writeRendererLog("终端打开请求成功", {
      tabId: result.tabId,
      serverId: server.id,
      serverName: server.name,
    });
    const tab: TerminalTab = {
      id: result.tabId,
      serverId: server.id,
      title: server.name,
      status: "connecting",
    };

    tabs.value = [...tabs.value, tab];
    activeTabId.value = tab.id;

    await nextTick();
    createTerminalInstance(tab);
    void loadSftpHome(tab);
  } catch (error) {
    listError.value = error instanceof Error ? error.message : "打开终端失败";
  }
}

async function activateTerminalTab(tabId: string): Promise<void> {
  activeTabId.value = tabId;
  await nextTick();
  scheduleTerminalFit();
}

async function closeTerminalTab(tabId: string): Promise<void> {
  await orbitSSHApi.value?.sftp.close(tabId);
  await orbitSSHApi.value?.terminals.close(tabId);
  const terminalEntry = terminalInstances.get(tabId);
  terminalEntry?.searchResultsDisposable.dispose();
  terminalEntry?.terminal.dispose();
  terminalInstances.delete(tabId);
  removeSftpTree(tabId);
  tabs.value = tabs.value.filter(tab => tab.id !== tabId);

  if (activeTabId.value === tabId) {
    activeTabId.value = tabs.value.at(-1)?.id ?? "";
    await nextTick();

    if (activeTabId.value) {
      fitTerminal(activeTabId.value);
    }
  }
}

function handleTerminalData(event: { tabId: string; data: string }): void {
  terminalInstances.get(event.tabId)?.terminal.write(event.data);
}

function handleTerminalStatus(event: TerminalStatusEvent): void {
  writeRendererLog("收到终端状态", {
    tabId: event.tabId,
    status: event.status,
    message: event.message,
  });
  tabs.value = tabs.value.map(tab =>
    tab.id === event.tabId
      ? { ...tab, status: event.status, message: event.message }
      : tab,
  );

  if (event.message) {
    terminalInstances
      .get(event.tabId)
      ?.terminal.writeln(`\r\n${event.message}`);
  }
}

function setSftpTree(tabId: string, tree: SftpTreeState): void {
  sftpTrees.value = {
    ...sftpTrees.value,
    [tabId]: tree,
  };
}

function removeSftpTree(tabId: string): void {
  const nextTrees = { ...sftpTrees.value };
  delete nextTrees[tabId];
  sftpTrees.value = nextTrees;
}

async function loadSftpHome(tab: TerminalTab): Promise<void> {
  writeRendererLog("开始加载 SFTP home", {
    tabId: tab.id,
    serverId: tab.serverId,
  });

  if (!orbitSSHApi.value) {
    writeRendererLog(
      "加载 SFTP home 失败：Preload API 不存在",
      { tabId: tab.id },
      "error",
    );
    return;
  }

  const pendingRoot: RemoteFileNode = {
    path: "/",
    name: "home",
    type: "directory",
    loaded: false,
    children: [],
  };

  setSftpTree(tab.id, {
    homePath: "加载中...",
    root: pendingRoot,
    expandedPaths: new Set<string>(),
    loadingPaths: new Set<string>([pendingRoot.path]),
    error: "",
  });

  try {
    const result = await orbitSSHApi.value.sftp.open(tab.id, tab.serverId);
    writeRendererLog("SFTP home 返回成功", {
      tabId: tab.id,
      homePath: result.homePath,
      nodeCount: result.nodes.length,
    });
    const root: RemoteFileNode = {
      path: result.homePath,
      name: getRootName(result.homePath),
      type: "directory",
      loaded: true,
      children: result.nodes,
    };

    setSftpTree(tab.id, {
      homePath: result.homePath,
      root,
      expandedPaths: new Set<string>([root.path]),
      loadingPaths: new Set<string>(),
      error: "",
    });
  } catch (error) {
    writeRendererLog(
      "SFTP home 加载失败",
      {
        tabId: tab.id,
        error: error instanceof Error ? error.message : String(error),
      },
      "error",
    );
    setSftpTree(tab.id, {
      homePath: "",
      root: pendingRoot,
      expandedPaths: new Set<string>(),
      loadingPaths: new Set<string>(),
      error: error instanceof Error ? error.message : "SFTP 文件树加载失败",
    });
  }
}

async function toggleRemoteDirectory(node: RemoteFileNode): Promise<void> {
  writeRendererLog("点击远程文件节点", {
    tabId: activeTabId.value,
    path: node.path,
    type: node.type,
    loaded: node.loaded,
  });

  if (
    node.type !== "directory" ||
    !activeTabId.value ||
    !activeSftpTree.value
  ) {
    return;
  }

  const tabId = activeTabId.value;
  const tree = activeSftpTree.value;
  const nextExpandedPaths = new Set(tree.expandedPaths);

  if (nextExpandedPaths.has(node.path)) {
    nextExpandedPaths.delete(node.path);
    setSftpTree(tabId, {
      ...tree,
      expandedPaths: nextExpandedPaths,
    });
    return;
  }

  nextExpandedPaths.add(node.path);

  if (node.loaded) {
    setSftpTree(tabId, {
      ...tree,
      expandedPaths: nextExpandedPaths,
    });
    return;
  }

  const nextLoadingPaths = new Set(tree.loadingPaths);
  nextLoadingPaths.add(node.path);
  setSftpTree(tabId, {
    ...tree,
    expandedPaths: nextExpandedPaths,
    loadingPaths: nextLoadingPaths,
    error: "",
  });

  try {
    const children = await orbitSSHApi.value?.sftp.list({
      tabId,
      path: node.path,
    });

    if (!children) {
      writeRendererLog(
        "目录读取返回空结果",
        { tabId, path: node.path },
        "warn",
      );
      return;
    }

    writeRendererLog("目录懒加载完成", {
      tabId,
      path: node.path,
      nodeCount: children.length,
    });

    const latestTree = sftpTrees.value[tabId];
    const latestLoadingPaths = new Set(latestTree.loadingPaths);
    latestLoadingPaths.delete(node.path);

    setSftpTree(tabId, {
      ...latestTree,
      root: updateNodeChildren(latestTree.root, node.path, children),
      loadingPaths: latestLoadingPaths,
    });
  } catch (error) {
    writeRendererLog(
      "目录懒加载失败",
      {
        tabId,
        path: node.path,
        error: error instanceof Error ? error.message : String(error),
      },
      "error",
    );
    const latestTree = sftpTrees.value[tabId];
    const latestLoadingPaths = new Set(latestTree.loadingPaths);
    latestLoadingPaths.delete(node.path);

    setSftpTree(tabId, {
      ...latestTree,
      loadingPaths: latestLoadingPaths,
      error: error instanceof Error ? error.message : "目录读取失败",
    });
  }
}

async function refreshActiveDirectory(): Promise<void> {
  const tab = activeTab.value;

  if (!tab) {
    writeRendererLog("刷新文件树跳过：没有活动 Tab", undefined, "warn");
    return;
  }

  writeRendererLog("刷新活动文件树", { tabId: tab.id, serverId: tab.serverId });
  await loadSftpHome(tab);
}

function showSftpPathPrompt(message: string, title = "路径无法访问"): void {
  sftpPathPromptTitle.value = title;
  sftpPathPromptMessage.value = message;
  isSftpPathPromptOpen.value = true;
}

function closeSftpPathPrompt(): void {
  isSftpPathPromptOpen.value = false;
  sftpPathPromptTitle.value = "路径无法访问";
  sftpPathPromptMessage.value = "";
  filePathInput.value = activeSftpTree.value?.homePath ?? "";
}

async function openSftpDirectoryPath(
  tab: TerminalTab,
  path: string,
  fallbackError: string,
): Promise<boolean> {
  const targetPath = path.trim();

  if (!targetPath) {
    const tree = sftpTrees.value[tab.id];

    if (tree) {
      setSftpTree(tab.id, {
        ...tree,
        error: "请输入远程路径",
      });
    }

    return false;
  }

  try {
    const nodes = await orbitSSHApi.value?.sftp.list({
      tabId: tab.id,
      path: targetPath,
    });

    if (!nodes) {
      throw new Error(fallbackError);
    }

    const root: RemoteFileNode = {
      path: targetPath,
      name: getRootName(targetPath),
      type: "directory",
      loaded: true,
      children: nodes,
    };

    setSftpTree(tab.id, {
      homePath: targetPath,
      root,
      expandedPaths: new Set<string>([targetPath]),
      loadingPaths: new Set<string>(),
      error: "",
    });
    return true;
  } catch (error) {
    const tree = sftpTrees.value[tab.id];

    if (tree) {
      setSftpTree(tab.id, {
        ...tree,
        error: "",
      });
    }

    showSftpPathPrompt(fallbackError);
    writeRendererLog(
      "SFTP 路径跳转失败",
      {
        tabId: tab.id,
        path: targetPath,
        error: error instanceof Error ? error.message : String(error),
      },
      "warn",
    );
    return false;
  }
}

async function submitFilePathInput(): Promise<void> {
  const tab = activeTab.value;

  if (!tab || !orbitSSHApi.value) {
    return;
  }

  await openSftpDirectoryPath(tab, filePathInput.value, "路径不存在或无法访问");
}

async function copyActiveSftpPath(): Promise<void> {
  const tree = activeSftpTree.value;

  if (!tree?.homePath) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(tree.homePath);
    } else if (!copyTextByFallback(tree.homePath)) {
      throw new Error("复制失败");
    }

    setSftpTree(activeTabId.value, {
      ...tree,
      error: "",
    });
  } catch (error) {
    setSftpTree(activeTabId.value, {
      ...tree,
      error: error instanceof Error ? error.message : "复制路径失败",
    });
  }
}

async function syncFileTreeToTerminalPath(): Promise<void> {
  const tab = activeTab.value;
  const terminalPath = tab?.currentPath;

  if (!tab || !terminalPath) {
    writeRendererLog(
      "同步终端路径跳过：终端路径为空",
      { tabId: tab?.id },
      "warn",
    );
    return;
  }

  if (!orbitSSHApi.value) {
    return;
  }

  writeRendererLog("开始同步文件树到终端路径", {
    tabId: tab.id,
    path: terminalPath,
  });

  await openSftpDirectoryPath(tab, terminalPath, "同步终端路径失败");
}

// 窗口尺寸变化（含最大化/还原）后重新 fit 终端。
function handleWindowResize(): void {
  scheduleTerminalFit();
}

// 启动时从主进程读取服务器配置，Renderer 不直接接触本地文件。
async function loadServers(): Promise<void> {
  isServerListLoading.value = true;
  listError.value = "";
  writeRendererLog("开始加载服务器列表");

  try {
    if (!orbitSSHApi.value) {
      runtimeError.value =
        "未检测到 Electron Preload API，请通过 Electron 窗口启动应用";
      servers.value = [];
      return;
    }

    servers.value = await orbitSSHApi.value.servers.list();
    writeRendererLog("服务器列表加载完成", {
      serverCount: servers.value.length,
    });
  } catch (error) {
    listError.value =
      error instanceof Error ? error.message : "加载服务器列表失败";
  } finally {
    isServerListLoading.value = false;
  }
}

// 设置变更（含初始加载）后应用到终端；选区色变化时同步刷新 CodeMirror 主题。
// 原 updateTerminalSetting/loadAppSettings 内联的副作用改由这里统一协调。
watch(
  () => ({ ...appSettings.terminal }),
  (cur, prev) => {
    applyTerminalSettings();

    if (cur.selectionBackground !== prev?.selectionBackground && fileEditorView) {
      fileEditorView.dispatch({
        effects: fileEditorThemeCompartment.reconfigure(
          createFileEditorTheme(cur.selectionBackground),
        ),
      });
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

  if (orbitSSHApi.value) {
    removeTerminalDataListener =
      orbitSSHApi.value.terminals.onData(handleTerminalData);
    removeTerminalStatusListener =
      orbitSSHApi.value.terminals.onStatus(handleTerminalStatus);
  }

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
  removeTerminalDataListener?.();
  removeTerminalStatusListener?.();
  downloadsStore.stopListeners();
  window.removeEventListener("resize", handleWindowResize);
  window.removeEventListener("keydown", handleGlobalKeydown);
  window.removeEventListener("click", closeFileContextMenu);
  window.removeEventListener("click", closeTaskList);
  window.removeEventListener("contextmenu", closeFileContextMenu);
  window.clearTimeout(fitScheduleTimer);
  sidebarStore.stopSidebarResize();
  terminalInstances.forEach(({ terminal, searchResultsDisposable }) => {
    searchResultsDisposable.dispose();
    terminal.dispose();
  });
  terminalInstances.clear();
});
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <section class="header-brand">
        <div class="brand-mark">OSSH</div>
        <div>
          <h1>OrbitSSH</h1>
          <p>SSH Terminal Client</p>
        </div>
      </section>
      <nav class="tabs" aria-label="终端标签">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          :class="['tab', { active: tab.id === activeTabId }]"
          role="button"
          tabindex="0"
          @click="activateTerminalTab(tab.id)">
          <span>{{ tab.title }}</span>
          <small>{{ getStatusText(tab.status) }}</small>
          <button
            type="button"
            class="tab-close"
            aria-label="关闭终端"
            @click.stop="closeTerminalTab(tab.id)">
            <img :src="closeIcon" alt="" />
          </button>
        </div>
      </nav>
      <div class="titlebar-drag-zone" aria-hidden="true"></div>
      <div class="window-actions">
        <div class="tasklist" @click.stop>
          <button
            type="button"
            class="tasklist-trigger"
            aria-label="下载任务"
            title="下载任务"
            @click="isTaskListOpen = !isTaskListOpen">
            <img :src="taskIcon" alt="" />
            <strong v-if="activeDownloadCount > 0">{{
              activeDownloadCount
            }}</strong>
          </button>
          <section v-if="isTaskListOpen" class="tasklist-panel">
            <header>
              <span>下载任务</span>
              <small>{{ visibleDownloadTasks.length }} 项</small>
            </header>
            <div
              v-if="visibleDownloadTasks.length === 0"
              class="tasklist-empty">
              暂无下载任务
            </div>
            <template v-else>
              <article
                v-for="task in visibleDownloadTasks"
                :key="task.taskId"
                class="tasklist-item">
                <div class="tasklist-item-head">
                  <strong>{{ task.name }}</strong>
                  <small>{{ getDownloadTaskStatusText(task) }}</small>
                </div>
                <div class="tasklist-progress">
                  <span
                    :style="{
                      width: `${getDownloadProgressPercent(task)}%`,
                    }"></span>
                </div>

                <div class="tasklist-info">
                  <p v-if="task.status === 'error'">{{ task.error }}</p>
                  <p v-else>
                    {{ formatFileSize(task.transferredBytes) }}
                    <template v-if="task.totalBytes > 0">
                      / {{ formatFileSize(task.totalBytes) }}
                    </template>
                  </p>
                  <div class="tasklist-actions">
                    <template
                      v-if="
                        ['started', 'progress', 'paused'].includes(task.status)
                      ">
                      <button
                        title="继续"
                        v-if="task.status === 'paused'"
                        type="button"
                        :disabled="isDownloadTaskOperating(task.taskId)"
                        @click="controlDownloadTask(task, 'resume')">
                        <img :src="continueIcon" alt="继续" />
                      </button>
                      <button
                        v-else
                        title="暂停"
                        type="button"
                        :disabled="isDownloadTaskOperating(task.taskId)"
                        @click="controlDownloadTask(task, 'pause')">
                        <img :src="pauseIcon" alt="暂停" />
                      </button>
                      <button
                        title="删除"
                        type="button"
                        class="danger"
                        :disabled="isDownloadTaskOperating(task.taskId)"
                        @click="controlDownloadTask(task, 'cancel')">
                        <img :src="trashIcon" alt="删除" />
                      </button>
                    </template>
                  </div>
                </div>
              </article>
            </template>
          </section>
        </div>
        <button type="button" aria-label="设置" @click="openSettingsDialog">
          <img :src="settingsIcon" alt="" />
        </button>
        <span class="window-action-divider"></span>
        <button type="button" aria-label="最小化窗口" @click="minimizeWindow">
          <img :src="minimizeIcon" alt="" />
        </button>
        <button
          type="button"
          :aria-label="isWindowMaximized ? '还原窗口' : '最大化窗口'"
          @click="toggleMaximizeWindow">
          <img :src="isWindowMaximized ? restoreIcon : maximizeIcon" alt="" />
        </button>
        <button
          type="button"
          class="window-close"
          aria-label="关闭窗口"
          @click="closeWindow">
          <img :src="closeIcon" alt="" />
        </button>
      </div>
    </header>

    <div
      class="content-shell"
      :style="{ '--sidebar-width': `${sidebarWidth}px` }">
      <aside class="sidebar">
        <section class="panel server-panel">
          <div class="panel-header">
            <h2>服务器</h2>
            <button
              type="button"
              class="icon-button"
              aria-label="新增连接"
              @click="openConnectionDialog">
              <img :src="plusIcon" alt="" />
            </button>
          </div>

          <div class="server-list">
            <div v-if="runtimeError" class="server-empty error">
              {{ runtimeError }}
            </div>
            <div v-else-if="isServerListLoading" class="server-empty">
              正在加载服务器...
            </div>
            <div v-else-if="listError" class="server-empty error">
              {{ listError }}
            </div>
            <div v-else-if="!hasServers" class="server-empty">
              暂无服务器，点击右上角新增连接
            </div>

            <article
              v-for="server in servers"
              :key="server.id"
              class="server-item"
              @click="openServerTerminal(server)">
              <div class="server-meta">
                <strong>{{ server.name }}</strong>
                <span
                  >{{ server.username }}@{{ server.host }}:{{
                    server.port
                  }}</span
                >
              </div>
              <div class="server-side">
                <div class="server-actions" aria-label="服务器操作">
                  <button
                    type="button"
                    class="server-action"
                    aria-label="编辑服务器"
                    title="编辑"
                    @click.stop="editServer(server)">
                    <img :src="editIcon" alt="" />
                  </button>
                  <button
                    type="button"
                    class="server-action danger"
                    aria-label="删除服务器"
                    title="删除"
                    @click.stop="deleteServer(server.id)">
                    <img :src="trashIcon" alt="" />
                  </button>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section class="panel file-panel">
          <div class="panel-header">
            <h2>远程文件</h2>
            <button
              type="button"
              class="icon-button"
              aria-label="刷新目录"
              :disabled="!activeTab"
              @click="refreshActiveDirectory">
              <img :src="refreshIcon" alt="" />
            </button>
          </div>

          <div class="file-path-row">
            <input
              v-model="filePathInput"
              class="file-path-input"
              type="text"
              spellcheck="false"
              :disabled="!activeTab || !activeSftpTree"
              :placeholder="getFilePanelHint()"
              aria-label="远程路径"
              @keydown.enter.prevent="submitFilePathInput" />
            <button
              type="button"
              class="path-action-button"
              :disabled="!activeSftpTree?.homePath"
              title="复制当前路径"
              aria-label="复制当前路径"
              @click="copyActiveSftpPath">
              <img :src="copyIcon" alt="" />
            </button>
            <button
              type="button"
              class="path-action-button"
              :disabled="!activeTab?.currentPath"
              title="同步到当前终端路径"
              aria-label="同步到当前终端路径"
              @click="syncFileTreeToTerminalPath">
              <img :src="syncPathIcon" alt="" />
            </button>
          </div>

          <ul
            ref="fileTreeElement"
            class="file-tree"
            aria-label="远程文件树预览">
            <li
              v-for="node in visibleFileTree"
              :key="node.path"
              :class="[
                'file-node',
                {
                  'is-folder': node.type === 'directory',
                  'is-loading': activeSftpTree?.loadingPaths.has(node.path),
                },
              ]"
              :style="{ paddingLeft: `${12 + node.level * 18}px` }"
              @contextmenu="openFileContextMenu($event, node)"
              @click="toggleRemoteDirectory(node)"
              @dblclick="openRemoteFileEditorByDoubleClick(node)">
              <img
                v-if="node.type === 'directory'"
                :class="[
                  'chevron-icon',
                  { open: activeSftpTree?.expandedPaths.has(node.path) },
                ]"
                :src="chevronRightIcon"
                alt="" />
              <span v-else class="chevron-placeholder"></span>
              <img
                class="file-icon"
                :src="node.type === 'directory' ? folderIcon : fileIcon"
                alt="" />
              <span class="file-name">{{ node.name }}</span>
              <span class="file-meta">
                {{
                  node.type === "directory" ? "目录" : formatFileSize(node.size)
                }}
                {{ formatModifyTime(node.modifyTime) }}
              </span>
            </li>
          </ul>

          <div
            v-if="fileContextMenu.open"
            class="file-context-menu"
            :style="{
              left: `${fileContextMenu.x}px`,
              top: `${fileContextMenu.y}px`,
            }"
            role="menu"
            @click.stop
            @contextmenu.prevent.stop>
            <button
              v-if="isPreviewImageFile(fileContextMenu.node)"
              type="button"
              role="menuitem"
              @click="previewContextFile">
              <img :src="fileIcon" alt="" />
              <span>预览</span>
            </button>
            <button
              v-else
              type="button"
              role="menuitem"
              :disabled="!isEditableTextFile(fileContextMenu.node)"
              :class="{ disabled: !isEditableTextFile(fileContextMenu.node) }"
              @click="editContextFile">
              <img :src="editIcon" alt="" />
              <span>{{ getFileEditMenuLabel(fileContextMenu.node) }}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              :disabled="!canDownloadRemoteFile(fileContextMenu.node)"
              :class="{
                disabled: !canDownloadRemoteFile(fileContextMenu.node),
              }"
              @click="downloadContextFile">
              <img :src="arrowDownIcon" alt="" />
              <span>下载</span>
            </button>
            <button
              type="button"
              role="menuitem"
              :disabled="!canDeleteRemoteNode(fileContextMenu.node)"
              :class="{ disabled: !canDeleteRemoteNode(fileContextMenu.node) }"
              @click="deleteContextFile">
              <img :src="trashIcon" alt="" />
              <span>删除</span>
            </button>
          </div>
        </section>
      </aside>

      <div
        :class="['sidebar-resizer', { active: isResizingSidebar }]"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        @mousedown="startSidebarResize"></div>

      <section class="workspace">
        <section class="terminal-area">
          <div v-if="isTerminalSearchOpen" class="terminal-search">
            <input
              ref="terminalSearchInput"
              v-model="terminalSearchKeyword"
              type="search"
              placeholder="搜索终端内容"
              @input="searchActiveTerminal()"
              @keydown.enter.prevent="
                searchActiveTerminal($event.shiftKey ? 'previous' : 'next')
              "
              @keydown.esc.prevent="closeTerminalSearch" />
            <span class="terminal-search-count">
              {{ terminalSearchResult.index }}/{{ terminalSearchResult.total }}
            </span>
            <button
              type="button"
              :class="[
                'terminal-search-tool',
                { active: isTerminalSearchCaseSensitive },
              ]"
              aria-label="区分大小写"
              title="区分大小写"
              @click="toggleTerminalSearchCaseSensitive">
              <img :src="caseSensitiveIcon" alt="" />
            </button>
            <button
              type="button"
              class="terminal-search-tool"
              aria-label="上一个"
              title="上一个"
              @click="searchActiveTerminal('previous')">
              <img :src="arrowUpIcon" alt="" />
            </button>
            <button
              type="button"
              class="terminal-search-tool"
              aria-label="下一个"
              title="下一个"
              @click="searchActiveTerminal('next')">
              <img :src="arrowDownIcon" alt="" />
            </button>
            <button
              type="button"
              class="terminal-search-tool"
              aria-label="关闭搜索"
              title="关闭搜索"
              @click="closeTerminalSearch">
              <img :src="closeIcon" alt="" />
            </button>
          </div>

          <div v-if="tabs.length === 0" class="terminal-empty">
            <p class="eyebrow">READY</p>
            <h2>选择服务器开始 SSH 会话</h2>
            <p>
              点击左侧服务器会创建终端 Tab，并通过 Main Process 建立 SSH shell。
            </p>
            <button type="button" @click="openConnectionDialog">
              新增连接
            </button>
          </div>
          <div v-else class="terminal-hosts">
            <div
              v-for="tab in tabs"
              :key="tab.id"
              :ref="element => setTerminalHost(tab.id, element)"
              class="terminal-host"
              v-show="tab.id === activeTabId"></div>
          </div>
        </section>
      </section>
    </div>

    <AppDialog
      v-if="isConnectionDialogOpen"
      :title="editingServerId ? '编辑连接' : '新增连接'"
      description="填写 SSH 连接信息，当前仅保存到页面预览。"
      width="medium"
      @close="closeConnectionDialog">
      <form class="connection-form" @submit.prevent="submitConnectionForm">
        <label>
          <span>名称</span>
          <input
            v-model="connectionForm.name"
            type="text"
            placeholder="Production Gateway" />
        </label>
        <label>
          <span>Host</span>
          <input
            v-model="connectionForm.host"
            type="text"
            placeholder="192.168.1.10" />
        </label>
        <div class="form-row">
          <label>
            <span>Port</span>
            <input
              v-model.number="connectionForm.port"
              type="number"
              min="1"
              max="65535" />
          </label>
          <label>
            <span>Username</span>
            <input
              v-model="connectionForm.username"
              type="text"
              placeholder="root" />
          </label>
        </div>
        <label>
          <span>Password</span>
          <input
            v-model="connectionForm.password"
            type="password"
            :placeholder="
              editingServerId
                ? '留空表示不修改密码'
                : '密码会通过 safeStorage 加密保存'
            " />
        </label>

        <p v-if="formError" class="form-error">{{ formError }}</p>

        <footer class="dialog-actions">
          <button
            type="button"
            class="ghost-button"
            @click="closeConnectionDialog">
            取消
          </button>
          <button
            type="submit"
            class="primary-button"
            :disabled="isSubmittingServer">
            {{
              isSubmittingServer
                ? "保存中..."
                : editingServerId
                  ? "保存修改"
                  : "添加到列表"
            }}
          </button>
        </footer>
      </form>
    </AppDialog>

    <AppDialog
      v-if="isImagePreviewOpen"
      :title="imagePreview.name || '图片预览'"
      :description="imagePreview.path"
      width="large"
      @close="closeImagePreview">
      <section class="image-preview-shell">
        <div v-if="imagePreview.loading" class="image-preview-state">
          正在加载图片...
        </div>
        <div v-else-if="imagePreview.error" class="image-preview-state error">
          {{ imagePreview.error }}
        </div>
        <div v-else class="image-preview-body">
          <img :src="imagePreview.dataUrl" :alt="imagePreview.name" />
        </div>

        <footer class="file-editor-footer">
          <span>{{ imagePreview.mimeType || "图片文件" }}</span>
          <div class="dialog-actions">
            <button
              type="button"
              class="ghost-button"
              @click="closeImagePreview">
              关闭
            </button>
            <button
              type="button"
              class="primary-button"
              :disabled="imagePreview.loading || !imagePreview.path"
              @click="downloadImagePreviewFile">
              下载
            </button>
          </div>
        </footer>
      </section>
    </AppDialog>

    <AppDialog
      v-if="isFileEditorOpen"
      :title="fileEditorTitle"
      :description="fileEditor.path"
      width="editor"
      @close="requestCloseFileEditor">
      <section class="file-editor-shell">
        <div v-if="isFileEditorSearchOpen" class="file-editor-toolbar">
          <div class="file-editor-search">
            <input
              ref="fileEditorSearchInput"
              v-model="fileEditorSearchKeyword"
              type="search"
              placeholder="搜索内容"
              @input="searchFileEditor()"
              @keydown.enter.prevent="
                searchFileEditor($event.shiftKey ? 'previous' : 'next')
              "
              @keydown.esc.prevent="closeFileEditorSearch" />
            <input
              ref="fileEditorReplaceInput"
              v-model="fileEditorReplaceText"
              type="text"
              placeholder="替换为"
              @input="applyFileEditorSearchQuery"
              @keydown.enter.prevent="replaceCurrentFileEditorMatch"
              @keydown.esc.prevent="closeFileEditorSearch" />
            <span
              >{{ fileEditor.searchIndex }}/{{ fileEditor.searchTotal }}</span
            >
            <button
              type="button"
              :class="[
                'file-editor-search-tool',
                { active: isFileEditorSearchCaseSensitive },
              ]"
              aria-label="区分大小写"
              title="区分大小写"
              @click="toggleFileEditorSearchCaseSensitive">
              <img :src="caseSensitiveIcon" alt="" />
            </button>
            <button
              type="button"
              class="file-editor-search-tool"
              aria-label="上一个"
              title="上一个"
              @click="searchFileEditor('previous')">
              <img :src="arrowUpIcon" alt="" />
            </button>
            <button
              type="button"
              class="file-editor-search-tool"
              aria-label="下一个"
              title="下一个"
              @click="searchFileEditor('next')">
              <img :src="arrowDownIcon" alt="" />
            </button>
            <button
              type="button"
              class="file-editor-replace-button"
              :disabled="
                !fileEditorSearchKeyword || fileEditor.searchTotal === 0
              "
              @click="replaceCurrentFileEditorMatch">
              替换
            </button>
            <button
              type="button"
              class="file-editor-replace-button"
              :disabled="
                !fileEditorSearchKeyword || fileEditor.searchTotal === 0
              "
              @click="replaceAllFileEditorMatches">
              全部
            </button>
            <button
              type="button"
              class="file-editor-search-tool"
              aria-label="关闭搜索"
              title="关闭搜索"
              @click="closeFileEditorSearch">
              <img :src="closeIcon" alt="" />
            </button>
          </div>
        </div>

        <div v-if="fileEditor.loading" class="file-editor-loading">
          正在读取文件...
        </div>
        <div v-else ref="fileEditorContainer" class="file-editor-body"></div>

        <p v-if="fileEditorError" class="form-error">{{ fileEditorError }}</p>

        <footer class="file-editor-footer">
          <span>{{ isFileEditorDirty ? "有未保存修改" : "已保存" }}</span>
          <div class="dialog-actions">
            <button
              type="button"
              class="ghost-button"
              @click="requestCloseFileEditor">
              关闭
            </button>
            <button
              type="button"
              class="primary-button"
              :disabled="
                fileEditor.loading || fileEditor.saving || !isFileEditorDirty
              "
              @click="saveFileEditor">
              {{ fileEditor.saving ? "保存中..." : "保存" }}
            </button>
          </div>
        </footer>
      </section>
    </AppDialog>

    <AppDialog
      v-if="isFileEditorCloseConfirmOpen"
      title="保存修改？"
      description="当前文件有未保存修改，关闭前请选择如何处理。"
      width="medium"
      @close="isFileEditorCloseConfirmOpen = false">
      <section class="confirm-dialog-content">
        <footer class="dialog-actions">
          <button
            type="button"
            class="ghost-button"
            @click="discardFileEditorChanges">
            不保存
          </button>
          <button
            type="button"
            class="ghost-button"
            @click="isFileEditorCloseConfirmOpen = false">
            取消
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="fileEditor.saving"
            @click="saveAndCloseFileEditor">
            {{ fileEditor.saving ? "保存中..." : "保存并关闭" }}
          </button>
        </footer>
      </section>
    </AppDialog>

    <AppDialog
      v-if="isSftpPathPromptOpen"
      :title="sftpPathPromptTitle"
      :description="sftpPathPromptMessage"
      width="medium"
      @close="closeSftpPathPrompt">
      <section class="confirm-dialog-content">
        <footer class="dialog-actions">
          <button
            type="button"
            class="primary-button"
            @click="closeSftpPathPrompt">
            知道了
          </button>
        </footer>
      </section>
    </AppDialog>

    <AppDialog
      v-if="isSettingsDialogOpen"
      title="设置"
      description="调整应用常规选项。"
      width="large"
      @close="closeSettingsDialog">
      <div class="settings-layout">
        <aside class="settings-nav" aria-label="设置分类">
          <button
            type="button"
            :class="[
              'settings-nav-item',
              { active: activeSettingsSection === 'general' },
            ]"
            @click="activeSettingsSection = 'general'">
            常规设置
          </button>
          <button
            type="button"
            :class="[
              'settings-nav-item',
              { active: activeSettingsSection === 'shortcuts' },
            ]"
            @click="activeSettingsSection = 'shortcuts'">
            快捷键
          </button>
        </aside>

        <section
          v-if="activeSettingsSection === 'general'"
          class="settings-content">
          <div class="settings-field">
            <div>
              <h3>终端文字字号</h3>
              <p>控制当前和后续终端的字体大小。</p>
            </div>
            <div class="stepper-control">
              <button
                type="button"
                @click="stepTerminalNumberSetting('fontSize', -1)">
                -
              </button>
              <output>{{ appSettings.terminal.fontSize }}</output>
              <button
                type="button"
                @click="stepTerminalNumberSetting('fontSize', 1)">
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
                @click="stepTerminalNumberSetting('lineHeight', -0.1)">
                -
              </button>
              <output>{{ appSettings.terminal.lineHeight.toFixed(1) }}</output>
              <button
                type="button"
                @click="stepTerminalNumberSetting('lineHeight', 0.1)">
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
                  isSelectionBackgroundDropdownOpen =
                    !isSelectionBackgroundDropdownOpen
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
                  @click="selectSelectionBackground(color)">
                  <span
                    class="color-swatch"
                    :style="{ background: color }"></span>
                  <span>{{ color }}</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-else class="settings-content">
          <div class="settings-field">
            <div>
              <h3>终端搜索</h3>
              <p>在当前终端右上角打开搜索框，Esc 或关闭按钮可退出。</p>
            </div>
            <kbd class="shortcut-key">Ctrl + F</kbd>
          </div>
        </section>
      </div>
    </AppDialog>
  </main>
</template>
