<script setup lang="ts">
import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
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
import editIcon from "./assets/icons/edit.svg";
import fileIcon from "./assets/icons/file.svg";
import folderIcon from "./assets/icons/folder.svg";
import maximizeIcon from "./assets/icons/maximize.svg";
import minimizeIcon from "./assets/icons/minimize.svg";
import plusIcon from "./assets/icons/plus.svg";
import refreshIcon from "./assets/icons/refresh.svg";
import restoreIcon from "./assets/icons/restore.svg";
import settingsIcon from "./assets/icons/settings.svg";
import splitViewIcon from "./assets/icons/split-view.svg";
import syncPathIcon from "./assets/icons/sync-path.svg";
import trashIcon from "./assets/icons/trash.svg";
import AppDialog from "./components/AppDialog.vue";
import type { ServerConfig, ServerInput } from "../shared/server";
import { defaultAppSettings, type AppSettings } from "../shared/settings";
import type { RemoteFileNode } from "../shared/sftp";
import type { TerminalStatusEvent } from "../shared/terminal";

interface TerminalTab {
  id: string;
  serverId: string;
  title: string;
  status: TerminalStatusEvent["status"];
  currentPath?: string;
  message?: string;
}

interface VisibleRemoteFileNode extends RemoteFileNode {
  level: number;
}

interface SftpTreeState {
  homePath: string;
  root: RemoteFileNode;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  error: string;
}

const servers = ref<ServerConfig[]>([]);

const tabs = ref<TerminalTab[]>([]);
const activeTabId = ref("");

const isConnectionDialogOpen = ref(false);
const isSettingsDialogOpen = ref(false);
const isSelectionBackgroundDropdownOpen = ref(false);
const activeSettingsSection = ref<"general" | "shortcuts">("general");
const isTerminalSearchOpen = ref(false);
const isTerminalSearchCaseSensitive = ref(false);
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
const isWindowMaximized = ref(false);
const runtimeError = ref("");
const sftpTrees = ref<Record<string, SftpTreeState>>({});
const fileTreeElement = ref<HTMLElement | null>(null);
const sidebarWidth = ref(320);
const isResizingSidebar = ref(false);
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

const connectionForm = reactive({
  name: "",
  host: "",
  port: 22,
  username: "",
  password: "",
});

const appSettings = reactive<AppSettings>(structuredClone(defaultAppSettings));
const selectionBackgroundOptions = [
  "#244763",
  "#365A46",
  "#5B4B2A",
  "#543A5F",
  "#5A2D35",
];

const hasServers = computed(() => servers.value.length > 0);

const activeTab = computed(() =>
  tabs.value.find(tab => tab.id === activeTabId.value),
);

const dockShellApi = computed(() => window.dockShell);

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

function getStatusText(status: TerminalStatusEvent["status"]): string {
  const statusTextMap: Record<TerminalStatusEvent["status"], string> = {
    connecting: "连接中",
    connected: "已连接",
    disconnected: "已断开",
    error: "错误",
  };

  return statusTextMap[status];
}

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

function toPlainAppSettings(): AppSettings {
  return {
    terminal: {
      fontSize: appSettings.terminal.fontSize,
      lineHeight: appSettings.terminal.lineHeight,
      selectionBackground: appSettings.terminal.selectionBackground,
    },
  };
}

async function saveAppSettings(): Promise<void> {
  try {
    const savedSettings = await dockShellApi.value?.settings.save(toPlainAppSettings());

    if (savedSettings) {
      Object.assign(appSettings.terminal, savedSettings.terminal);
    }
  } catch (error) {
    writeRendererLog(
      "保存设置失败",
      { error: error instanceof Error ? error.message : String(error) },
      "error",
    );
  }
}

async function updateTerminalSetting<K extends keyof AppSettings["terminal"]>(
  key: K,
  value: AppSettings["terminal"][K],
): Promise<void> {
  appSettings.terminal[key] = value;
  applyTerminalSettings();
  await saveAppSettings();
}

async function stepTerminalNumberSetting(
  key: "fontSize" | "lineHeight",
  delta: number,
): Promise<void> {
  const limits = {
    fontSize: { min: 10, max: 24, decimals: 0 },
    lineHeight: { min: 1, max: 2, decimals: 1 },
  }[key];
  const nextValue = Math.min(
    Math.max(Number(appSettings.terminal[key]) + delta, limits.min),
    limits.max,
  );
  const normalizedValue = Number(nextValue.toFixed(limits.decimals));

  await updateTerminalSetting(key, normalizedValue);
}

function openSettingsDialog(): void {
  isSettingsDialogOpen.value = true;
}

function closeSettingsDialog(): void {
  isSettingsDialogOpen.value = false;
  isSelectionBackgroundDropdownOpen.value = false;
}

async function selectSelectionBackground(color: string): Promise<void> {
  isSelectionBackgroundDropdownOpen.value = false;
  await updateTerminalSetting("selectionBackground", color);
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

function getTerminalSearchOptions() {
  return {
    caseSensitive: isTerminalSearchCaseSensitive.value,
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
function searchActiveTerminal(direction: "next" | "previous" = "next"): void {
  const keyword = terminalSearchKeyword.value.trim();
  const terminalEntry = terminalInstances.get(activeTabId.value);

  if (!keyword || !terminalEntry) {
    resetTerminalSearchResult();
    terminalEntry?.searchAddon.clearDecorations();
    return;
  }

  if (direction === "previous") {
    terminalEntry.searchAddon.findPrevious(keyword, getTerminalSearchOptions());
    return;
  }

  terminalEntry.searchAddon.findNext(keyword, getTerminalSearchOptions());
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

function writeRendererLog(
  message: string,
  data?: Record<string, unknown>,
  level: "debug" | "info" | "warn" | "error" = "info",
): void {
  const consoleMethod =
    level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[consoleMethod](`[DockShell renderer] ${message}`, data ?? {});
  void dockShellApi.value?.logger.write({
    scope: "renderer",
    level,
    message,
    data,
  });
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

function getRootName(homePath: string): string {
  const parts = homePath.split("/").filter(Boolean);

  return parts.at(-1) ?? homePath;
}

function parseOsc7Path(data: string): string {
  const match = data.match(/^file:\/\/[^/]*(\/.*)$/);

  if (!match?.[1]) {
    return "";
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function flattenRemoteTree(
  node: RemoteFileNode,
  expandedPaths: Set<string>,
  level = 0,
): VisibleRemoteFileNode[] {
  const currentNode = {
    ...node,
    level,
  };

  if (
    node.type !== "directory" ||
    !expandedPaths.has(node.path) ||
    !node.children
  ) {
    return [currentNode];
  }

  return [
    currentNode,
    ...node.children.flatMap(childNode =>
      flattenRemoteTree(childNode, expandedPaths, level + 1),
    ),
  ];
}

function updateNodeChildren(
  node: RemoteFileNode,
  targetPath: string,
  children: RemoteFileNode[],
): RemoteFileNode {
  if (node.path === targetPath) {
    return {
      ...node,
      children,
      loaded: true,
    };
  }

  if (!node.children) {
    return node;
  }

  return {
    ...node,
    children: node.children.map(childNode =>
      updateNodeChildren(childNode, targetPath, children),
    ),
  };
}

function formatFileSize(size?: number): string {
  if (typeof size !== "number") {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatModifyTime(modifyTime?: number): string {
  if (typeof modifyTime !== "number") {
    return "";
  }

  return new Date(modifyTime).toLocaleDateString();
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
    if (!dockShellApi.value) {
      throw new Error("请通过 Electron 窗口启动应用");
    }

    if (editingServerId.value) {
      const updatedServer = await dockShellApi.value.servers.update({
        id: editingServerId.value,
        ...nextServer,
      });
      servers.value = servers.value.map(server =>
        server.id === updatedServer.id ? updatedServer : server,
      );
    } else {
      const createdServer = await dockShellApi.value.servers.create(nextServer);
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
    if (!dockShellApi.value) {
      throw new Error("请通过 Electron 窗口启动应用");
    }

    await dockShellApi.value.servers.delete(serverId);
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
    void dockShellApi.value?.terminals.resize({
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
      cursor: "#89dcae",
      selectionBackground: appSettings.terminal.selectionBackground,
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
    void dockShellApi.value?.terminals.write(tab.id, data);
  });

  terminal.onResize(({ cols, rows }) => {
    void dockShellApi.value?.terminals.resize({
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
    if (!dockShellApi.value) {
      throw new Error("请通过 Electron 窗口启动应用");
    }

    const result = await dockShellApi.value.terminals.open(server.id);
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
  await dockShellApi.value?.sftp.close(tabId);
  await dockShellApi.value?.terminals.close(tabId);
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

  if (!dockShellApi.value) {
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
    const result = await dockShellApi.value.sftp.open(tab.id, tab.serverId);
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
    const children = await dockShellApi.value?.sftp.list({
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

  if (!dockShellApi.value) {
    return;
  }

  writeRendererLog("开始同步文件树到终端路径", {
    tabId: tab.id,
    path: terminalPath,
  });

  try {
    const nodes = await dockShellApi.value.sftp.list({
      tabId: tab.id,
      path: terminalPath,
    });
    const root: RemoteFileNode = {
      path: terminalPath,
      name: getRootName(terminalPath),
      type: "directory",
      loaded: true,
      children: nodes,
    };

    setSftpTree(tab.id, {
      homePath: terminalPath,
      root,
      expandedPaths: new Set<string>([terminalPath]),
      loadingPaths: new Set<string>(),
      error: "",
    });
  } catch (error) {
    const tree = activeSftpTree.value;

    if (tree) {
      setSftpTree(tab.id, {
        ...tree,
        error: error instanceof Error ? error.message : "同步终端路径失败",
      });
    }

    writeRendererLog(
      "同步终端路径失败",
      {
        tabId: tab.id,
        path: terminalPath,
        error: error instanceof Error ? error.message : String(error),
      },
      "error",
    );
  }
}

function handleWindowResize(): void {
  scheduleTerminalFit();
}

async function minimizeWindow(): Promise<void> {
  await dockShellApi.value?.windowControls.minimize();
  scheduleTerminalFit();
}

async function toggleMaximizeWindow(): Promise<void> {
  const isMaximized = await dockShellApi.value?.windowControls.toggleMaximize();
  isWindowMaximized.value = Boolean(isMaximized);
  await nextTick();
  scheduleTerminalFit();
}

async function closeWindow(): Promise<void> {
  await dockShellApi.value?.windowControls.close();
}

function clampSidebarWidth(width: number): number {
  return Math.min(Math.max(width, 260), 520);
}

function handleSidebarResizeMove(event: MouseEvent): void {
  if (!isResizingSidebar.value) {
    return;
  }

  sidebarWidth.value = clampSidebarWidth(event.clientX);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  scheduleTerminalFit();
}

function stopSidebarResize(): void {
  if (!isResizingSidebar.value) {
    return;
  }

  isResizingSidebar.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("mousemove", handleSidebarResizeMove);
  window.removeEventListener("mouseup", stopSidebarResize);
  scheduleTerminalFit();
}

function startSidebarResize(event: MouseEvent): void {
  event.preventDefault();
  isResizingSidebar.value = true;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("mousemove", handleSidebarResizeMove);
  window.addEventListener("mouseup", stopSidebarResize);
}

// 启动时从主进程读取服务器配置，Renderer 不直接接触本地文件。
async function loadServers(): Promise<void> {
  isServerListLoading.value = true;
  listError.value = "";
  writeRendererLog("开始加载服务器列表");

  try {
    if (!dockShellApi.value) {
      runtimeError.value =
        "未检测到 Electron Preload API，请通过 Electron 窗口启动应用";
      servers.value = [];
      return;
    }

    servers.value = await dockShellApi.value.servers.list();
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

async function loadAppSettings(): Promise<void> {
  try {
    const savedSettings = await dockShellApi.value?.settings.get();

    if (!savedSettings) {
      return;
    }

    Object.assign(appSettings.terminal, savedSettings.terminal);
    applyTerminalSettings();
    writeRendererLog("应用设置加载完成", {
      terminal: savedSettings.terminal,
    });
  } catch (error) {
    writeRendererLog(
      "应用设置加载失败",
      { error: error instanceof Error ? error.message : String(error) },
      "error",
    );
  }
}

onMounted(() => {
  writeRendererLog("Renderer mounted", {
    hasDockShellApi: Boolean(dockShellApi.value),
  });
  void loadServers();
  void loadAppSettings();

  if (dockShellApi.value) {
    void dockShellApi.value.windowControls.isMaximized().then(value => {
      isWindowMaximized.value = value;
    });
    removeTerminalDataListener =
      dockShellApi.value.terminals.onData(handleTerminalData);
    removeTerminalStatusListener =
      dockShellApi.value.terminals.onStatus(handleTerminalStatus);
  }

  window.addEventListener("resize", handleWindowResize);
  window.addEventListener("keydown", handleGlobalKeydown);
});

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
  window.removeEventListener("resize", handleWindowResize);
  window.removeEventListener("keydown", handleGlobalKeydown);
  window.clearTimeout(fitScheduleTimer);
  stopSidebarResize();
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
        <div class="brand-mark">DS</div>
        <div>
          <h1>DockShell</h1>
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
                    @click.stop="editServer(server)">
                    <img :src="editIcon" alt="" />
                  </button>
                  <button
                    type="button"
                    class="server-action danger"
                    aria-label="删除服务器"
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
            <div :class="['empty-hint', { error: activeSftpTree?.error }]">
              <span>{{ getFilePanelHint() }}</span>
            </div>
            <button
              type="button"
              class="path-sync-button"
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
              @click="toggleRemoteDirectory(node)">
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

          <section v-if="activeSettingsSection === 'general'" class="settings-content">
            <div class="settings-field">
              <div>
                <h3>终端文字字号</h3>
                <p>控制当前和后续终端的字体大小。</p>
              </div>
              <div class="stepper-control">
                <button type="button" @click="stepTerminalNumberSetting('fontSize', -1)">-</button>
                <output>{{ appSettings.terminal.fontSize }}</output>
                <button type="button" @click="stepTerminalNumberSetting('fontSize', 1)">+</button>
              </div>
            </div>

            <div class="settings-field">
              <div>
                <h3>终端行高</h3>
                <p>调整终端每行文字的垂直间距。</p>
              </div>
              <div class="stepper-control">
                <button type="button" @click="stepTerminalNumberSetting('lineHeight', -0.1)">-</button>
                <output>{{ appSettings.terminal.lineHeight.toFixed(1) }}</output>
                <button type="button" @click="stepTerminalNumberSetting('lineHeight', 0.1)">+</button>
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
