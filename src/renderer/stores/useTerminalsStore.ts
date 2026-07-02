import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import { defineStore } from "pinia";
import { computed, nextTick, reactive, ref } from "vue";

import { appConfig } from "../../shared/config";
import type { ServerConfig } from "../../shared/server";
import type { TerminalStatusEvent } from "../../shared/terminal";
import { LOCAL_TERMINAL_SERVER_ID } from "../../shared/terminal";
import type {
  TerminalInstance,
  TerminalSearchMatch,
  TerminalTab,
} from "../types/terminal";
import { copyTextByFallback } from "../utils/clipboard";
import { parseOsc7Path } from "../utils/path";
import {
  getTerminalSearchDecorations,
  getTerminalTheme,
} from "../utils/theme";
import { useCoreStore } from "./useCoreStore";
import { useSettingsStore } from "./useSettingsStore";

const TERMINAL_FIT_DEBOUNCE_MS = 120;
const TERMINAL_RESIZE_THROTTLE_MS = 150;

export interface TerminalStoreCallbacks {
  afterOpen?: (tab: TerminalTab) => void | Promise<void>;
  beforeClose?: (tabId: string) => void | Promise<void>;
  afterClose?: (tabId: string) => void | Promise<void>;
}

// 终端域 store：管理 Tab、xterm 实例、搜索与 IPC 监听，通过回调通知外部域处理 SFTP 等副作用。
export const useTerminalsStore = defineStore("terminals", () => {
  const core = useCoreStore();
  const settingsStore = useSettingsStore();

  const tabs = ref<TerminalTab[]>([]);
  const activeTabId = ref("");
  const isTerminalSearchOpen = ref(false);
  const isTerminalSearchCaseSensitive = ref(false);
  const terminalSearchKeyword = ref("");
  const terminalSearchInput = ref<HTMLInputElement | null>(null);
  const terminalSearchResult = reactive({
    index: 0,
    total: 0,
  });

  const terminalHosts = new Map<string, HTMLElement>();
  const terminalInstances = new Map<string, TerminalInstance>();
  const lastSentTerminalSizes = new Map<string, { cols: number; rows: number }>();
  const pendingTerminalSizes = new Map<string, { cols: number; rows: number }>();
  const terminalResizeTimers = new Map<string, number>();
  let removeTerminalDataListener: (() => void) | undefined;
  let removeTerminalStatusListener: (() => void) | undefined;
  let fitScheduleTimer: number | undefined;
  let lastTerminalSearchKeyword = "";

  const activeTab = computed(() =>
    tabs.value.find(tab => tab.id === activeTabId.value),
  );

  function resetTerminalSearchResult(): void {
    terminalSearchResult.index = 0;
    terminalSearchResult.total = 0;
  }

  function getTerminalSearchOptions(incremental = false): ISearchOptions {
    return {
      caseSensitive: isTerminalSearchCaseSensitive.value,
      incremental,
      decorations: getTerminalSearchDecorations(
        settingsStore.appSettings.appearance.themeMode,
      ),
    };
  }

  function getCurrentTerminalTheme() {
    return getTerminalTheme(
      settingsStore.appSettings.appearance.themeMode,
      settingsStore.appSettings.terminal.selectionBackground,
    );
  }

  function applyTerminalSettings(): void {
    terminalInstances.forEach(({ terminal, fitAddon }) => {
      terminal.options.fontSize = settingsStore.appSettings.terminal.fontSize;
      terminal.options.lineHeight = settingsStore.appSettings.terminal.lineHeight;
      terminal.options.theme = getCurrentTerminalTheme();
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
    let nextIndex = Math.max(terminalSearchResult.index - 1, 0);

    if (keywordChanged) {
      nextIndex = direction === "previous" ? matches.length - 1 : 0;
    } else if (direction === "next") {
      nextIndex = (nextIndex + 1) % matches.length;
    } else if (direction === "previous") {
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
      core.writeRendererLog(
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

  // 判断当前终端是否存在选区，右键菜单用它决定复制项是否可用。
  function hasActiveTerminalSelection(): boolean {
    const terminalEntry = terminalInstances.get(activeTabId.value);

    if (!terminalEntry?.terminal.hasSelection()) {
      return false;
    }

    return Boolean(terminalEntry.terminal.getSelection().trim());
  }

  // 只检查剪贴板文本内容，文件和图片剪贴板不会被当作可粘贴内容。
  async function hasClipboardText(): Promise<boolean> {
    try {
      if (typeof core.orbitSSHApi?.clipboard?.readText !== "function") {
        return false;
      }

      return Boolean(await core.orbitSSHApi.clipboard.readText());
    } catch {
      return false;
    }
  }

  // 复制当前终端选区；没有选区时直接跳过，不写入剪贴板。
  async function copyActiveTerminalSelection(): Promise<void> {
    const terminalEntry = terminalInstances.get(activeTabId.value);

    if (!terminalEntry?.terminal.hasSelection()) {
      return;
    }

    const selectedText = terminalEntry.terminal.getSelection();

    if (!selectedText.trim()) {
      return;
    }

    try {
      if (typeof core.orbitSSHApi?.clipboard?.writeText === "function") {
        await core.orbitSSHApi.clipboard.writeText(selectedText);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(selectedText);
      } else if (!copyTextByFallback(selectedText)) {
        throw new Error("复制失败");
      }
    } catch (error) {
      core.writeRendererLog(
        "终端选区复制失败",
        { error: error instanceof Error ? error.message : String(error) },
        "warn",
      );
    }
  }

  // 只把剪贴板中的文本写入远端 shell，非文本内容或空文本不执行粘贴。
  async function pasteClipboardTextToActiveTerminal(): Promise<void> {
    const tabId = activeTabId.value;
    const terminalEntry = terminalInstances.get(tabId);

    if (!tabId || !terminalEntry) {
      return;
    }

    try {
      // 只读取剪贴板文本；图片、文件等非文本内容会得到空字符串并跳过写入。
      const clipboardText = typeof core.orbitSSHApi?.clipboard?.readText === "function"
        ? await core.orbitSSHApi.clipboard.readText()
        : await navigator.clipboard?.readText?.();

      if (!clipboardText) {
        return;
      }

      void core.orbitSSHApi?.terminals.write(tabId, clipboardText);
      terminalEntry.terminal.focus();
    } catch (error) {
      core.writeRendererLog(
        "终端粘贴文本失败",
        { tabId, error: error instanceof Error ? error.message : String(error) },
        "warn",
      );
    }
  }

  function handleTerminalKeyEvent(event: KeyboardEvent): boolean {
    const isSearchShortcut =
      event.type === "keydown" &&
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      event.key.toLowerCase() === "f";

    if (isSearchShortcut) {
      event.preventDefault();
      void openTerminalSearch();
      return false;
    }

    // 终端内复制 / 粘贴：Ctrl+Shift+C / Ctrl+Shift+V（Mac 上为 Cmd+Shift+C / Cmd+Shift+V）。
    // 终端里的纯 Ctrl+C / Ctrl+V 通常被 shell 用作中断 / 杂交，因此用 Shift 修饰符区分。
    if (
      event.type === "keydown" &&
      event.shiftKey &&
      (event.ctrlKey || event.metaKey)
    ) {
      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        void copyActiveTerminalSelection();
        return false;
      }
      if (key === "v") {
        event.preventDefault();
        void pasteClipboardTextToActiveTerminal();
        return false;
      }
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

  function setTerminalHost(tabId: string, element: unknown): void {
    if (element instanceof HTMLElement) {
      terminalHosts.set(tabId, element);
      return;
    }

    terminalHosts.delete(tabId);
  }

  function sendTerminalResize(tabId: string, cols: number, rows: number): void {
    const lastSize = lastSentTerminalSizes.get(tabId);

    if (lastSize?.cols === cols && lastSize.rows === rows) {
      return;
    }

    lastSentTerminalSizes.set(tabId, { cols, rows });
    void core.orbitSSHApi?.terminals.resize({
      tabId,
      cols,
      rows,
    });
  }

  function scheduleTerminalResize(
    tabId: string,
    cols: number,
    rows: number,
  ): void {
    if (cols <= 0 || rows <= 0) {
      return;
    }

    pendingTerminalSizes.set(tabId, { cols, rows });

    if (terminalResizeTimers.has(tabId)) {
      return;
    }

    const timer = window.setTimeout(() => {
      terminalResizeTimers.delete(tabId);
      const nextSize = pendingTerminalSizes.get(tabId);
      pendingTerminalSizes.delete(tabId);

      if (!nextSize) {
        return;
      }

      sendTerminalResize(tabId, nextSize.cols, nextSize.rows);
    }, TERMINAL_RESIZE_THROTTLE_MS);

    terminalResizeTimers.set(tabId, timer);
  }

  function fitTerminal(tabId: string): void {
    const terminalEntry = terminalInstances.get(tabId);

    if (!terminalEntry) {
      return;
    }

    terminalEntry.fitAddon.fit();

    const { cols, rows } = terminalEntry.terminal;
    if (cols > 0 && rows > 0) {
      scheduleTerminalResize(tabId, cols, rows);
    }
  }

  function fitActiveTerminal(): void {
    if (activeTabId.value) {
      fitTerminal(activeTabId.value);
    }
  }

  function scheduleTerminalFit(): void {
    window.clearTimeout(fitScheduleTimer);
    fitScheduleTimer = window.setTimeout(() => {
      window.requestAnimationFrame(fitActiveTerminal);
    }, TERMINAL_FIT_DEBOUNCE_MS);
  }

  // 为每个 Tab 创建独立 xterm 实例，并把输入通过 IPC 写入 SSH shell。
  function createTerminalInstance(tab: TerminalTab): void {
    const startedAt = performance.now();
    const host = terminalHosts.get(tab.id);

    if (!host || terminalInstances.has(tab.id)) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      scrollback: appConfig.terminal.scrollbackRows,
      fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: settingsStore.appSettings.terminal.fontSize,
      lineHeight: settingsStore.appSettings.terminal.lineHeight,
      theme: getCurrentTerminalTheme(),
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    let canvasAddon: CanvasAddon | undefined;
    const terminalCreatedAt = performance.now();

    try {
      canvasAddon = new CanvasAddon();
      terminal.loadAddon(canvasAddon);
      core.writeRendererLog("xterm Canvas 渲染器已启用", { tabId: tab.id });
    } catch (error) {
      core.writeRendererLog(
        "xterm Canvas 渲染器启用失败，回退默认渲染",
        {
          tabId: tab.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "warn",
      );
    }

    const addonLoadedAt = performance.now();
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
    const openedAt = performance.now();
    terminal.writeln(`正在连接 ${tab.title} ...`);

    terminal.parser.registerOscHandler(7, data => {
      const terminalPath = parseOsc7Path(data);

      if (!terminalPath) {
        return false;
      }

      tabs.value = tabs.value.map(item =>
        item.id === tab.id ? { ...item, currentPath: terminalPath } : item,
      );
      core.writeRendererLog("终端当前路径已更新", {
        tabId: tab.id,
        path: terminalPath,
      });

      return true;
    });

    terminal.onData(data => {
      void core.orbitSSHApi?.terminals.write(tab.id, data);
    });

    terminal.onResize(({ cols, rows }) => {
      scheduleTerminalResize(tab.id, cols, rows);
    });

    terminalInstances.set(tab.id, {
      terminal,
      fitAddon,
      searchAddon,
      searchResultsDisposable,
      canvasAddon,
    });
    core.writeRendererLog("终端实例初始化耗时", {
      tabId: tab.id,
      createTerminalMs: Math.round(terminalCreatedAt - startedAt),
      addonLoadMs: Math.round(addonLoadedAt - terminalCreatedAt),
      openAndFitMs: Math.round(openedAt - addonLoadedAt),
      totalMs: Math.round(openedAt - startedAt),
    });
  }

  async function openServerTerminal(
    server: ServerConfig,
    callbacks: Pick<TerminalStoreCallbacks, "afterOpen"> = {},
  ): Promise<void> {
    if (!core.orbitSSHApi) {
      throw new Error("请通过 Electron 窗口启动应用");
    }

    const startedAt = performance.now();
    const result = await core.orbitSSHApi.terminals.open(server.id);
    const ipcReturnedAt = performance.now();
    core.writeRendererLog("终端打开请求成功", {
      tabId: result.tabId,
      serverId: server.id,
      serverName: server.name,
      terminalOpenIpcMs: Math.round(ipcReturnedAt - startedAt),
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
    const beforeCreateAt = performance.now();
    createTerminalInstance(tab);
    const afterCreateAt = performance.now();
    await callbacks.afterOpen?.(tab);
    const afterCallbackAt = performance.now();
    core.writeRendererLog("终端打开流程耗时", {
      tabId: tab.id,
      serverId: server.id,
      ipcMs: Math.round(ipcReturnedAt - startedAt),
      renderWaitMs: Math.round(beforeCreateAt - ipcReturnedAt),
      createTerminalMs: Math.round(afterCreateAt - beforeCreateAt),
      afterOpenCallbackMs: Math.round(afterCallbackAt - afterCreateAt),
      totalMs: Math.round(afterCallbackAt - startedAt),
    });
  }

  async function openLocalTerminal(): Promise<void> {
    if (!core.orbitSSHApi) {
      throw new Error("请通过 Electron 窗口启动应用");
    }

    const existingLocalTab = tabs.value.find(
      tab => tab.serverId === LOCAL_TERMINAL_SERVER_ID,
    );

    if (existingLocalTab) {
      await activateTerminalTab(existingLocalTab.id);
      return;
    }

    const startedAt = performance.now();
    const result = await core.orbitSSHApi.terminals.openLocal();
    const ipcReturnedAt = performance.now();
    const tab: TerminalTab = {
      id: result.tabId,
      serverId: result.serverId,
      title: "本地",
      status: "connected",
      currentPath: result.cwd,
    };

    tabs.value = [tab, ...tabs.value];
    activeTabId.value = tab.id;

    await nextTick();
    const beforeCreateAt = performance.now();
    createTerminalInstance(tab);
    const afterCreateAt = performance.now();
    core.writeRendererLog("本地终端打开流程耗时", {
      tabId: tab.id,
      cwd: result.cwd,
      ipcMs: Math.round(ipcReturnedAt - startedAt),
      renderWaitMs: Math.round(beforeCreateAt - ipcReturnedAt),
      createTerminalMs: Math.round(afterCreateAt - beforeCreateAt),
      totalMs: Math.round(afterCreateAt - startedAt),
    });
  }

  async function activateTerminalTab(tabId: string): Promise<void> {
    activeTabId.value = tabId;
    await nextTick();
    scheduleTerminalFit();
  }

  async function closeTerminalTab(
    tabId: string,
    callbacks: Pick<TerminalStoreCallbacks, "beforeClose" | "afterClose"> = {},
  ): Promise<void> {
    await callbacks.beforeClose?.(tabId);
    await core.orbitSSHApi?.terminals.close(tabId);
    const terminalEntry = terminalInstances.get(tabId);
    terminalEntry?.searchResultsDisposable.dispose();
    terminalEntry?.terminal.dispose();
    terminalInstances.delete(tabId);
    lastSentTerminalSizes.delete(tabId);
    pendingTerminalSizes.delete(tabId);
    const resizeTimer = terminalResizeTimers.get(tabId);
    if (resizeTimer) {
      window.clearTimeout(resizeTimer);
      terminalResizeTimers.delete(tabId);
    }
    await callbacks.afterClose?.(tabId);
    tabs.value = tabs.value.filter(tab => tab.id !== tabId);

    if (activeTabId.value === tabId) {
      activeTabId.value = tabs.value.at(-1)?.id ?? "";
      await nextTick();

      if (activeTabId.value) {
        fitTerminal(activeTabId.value);
      }
    }
  }

  // 重新连接已断开的终端会话：复用原 tabId，
  // 状态更新由 handleTerminalStatus 统一处理。
  async function reconnectTerminal(tabId: string): Promise<void> {
    const tab = tabs.value.find(t => t.id === tabId);
    if (!tab) return;

    tabs.value = tabs.value.map(t =>
      t.id === tabId ? { ...t, status: "connecting" as const } : t,
    );

    try {
      const ok = await core.orbitSSHApi?.terminals.reconnect(tabId, tab.serverId);

      if (!ok) {
        // 主进程会同时回写错误状态；这里兜底避免 IPC 异常丢失时卡在连接中。
        tabs.value = tabs.value.map(t =>
          t.id === tabId
            ? { ...t, status: "error" as const, message: "终端重连失败" }
            : t,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      core.writeRendererLog(
        "终端重连失败",
        { tabId, error: message },
        "error",
      );
      tabs.value = tabs.value.map(t =>
        t.id === tabId
          ? { ...t, status: "error" as const, message: `终端重连失败：${message}` }
          : t,
      );
    }
  }

  function handleTerminalData(event: { tabId: string; data: string }): void {
    terminalInstances.get(event.tabId)?.terminal.write(event.data);
  }

  function handleTerminalStatus(event: TerminalStatusEvent): void {
    core.writeRendererLog("收到终端状态", {
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

    // SSH shell 就绪后补发一次终端尺寸同步。
    // createTerminalInstance 中的 fitAddon.fit() 触发的 resize IPC
    // 可能早于 shellStream 就绪到达主进程，从而被 resizeTerminal
    // 静默丢弃，导致远端 pty 停留在 sshClient.shell() 的初始 80×24。
    // 此处补发确保 shell 拿到实际窗口尺寸。
    if (event.status === "connected" && event.tabId === activeTabId.value) {
      scheduleTerminalFit();
    }
  }

  function startListeners(): void {
    if (core.orbitSSHApi && !removeTerminalDataListener) {
      removeTerminalDataListener =
        core.orbitSSHApi.terminals.onData(handleTerminalData);
    }

    if (core.orbitSSHApi && !removeTerminalStatusListener) {
      removeTerminalStatusListener =
        core.orbitSSHApi.terminals.onStatus(handleTerminalStatus);
    }
  }

  function stopListeners(): void {
    removeTerminalDataListener?.();
    removeTerminalStatusListener?.();
    removeTerminalDataListener = undefined;
    removeTerminalStatusListener = undefined;
  }

  function disposeAllTerminals(): void {
    terminalInstances.forEach(({ terminal, searchResultsDisposable }) => {
      searchResultsDisposable.dispose();
      terminal.dispose();
    });
    terminalInstances.clear();
  }

  function cleanup(): void {
    stopListeners();
    window.clearTimeout(fitScheduleTimer);
    terminalResizeTimers.forEach(timer => window.clearTimeout(timer));
    terminalResizeTimers.clear();
    pendingTerminalSizes.clear();
    lastSentTerminalSizes.clear();
    disposeAllTerminals();
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    isTerminalSearchOpen,
    isTerminalSearchCaseSensitive,
    terminalSearchKeyword,
    terminalSearchInput,
    terminalSearchResult,
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
    fitTerminal,
    fitActiveTerminal,
    scheduleTerminalFit,
    createTerminalInstance,
    openServerTerminal,
    openLocalTerminal,
    activateTerminalTab,
    closeTerminalTab,
    reconnectTerminal,
    handleTerminalData,
    handleTerminalStatus,
    startListeners,
    stopListeners,
    disposeAllTerminals,
    cleanup,
  };
});
