import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import { defineStore } from "pinia";
import { computed, nextTick, reactive, ref } from "vue";

import type { ServerConfig } from "../../shared/server";
import type { TerminalStatusEvent } from "../../shared/terminal";
import type {
  TerminalInstance,
  TerminalSearchMatch,
  TerminalTab,
} from "../types/terminal";
import { copyTextByFallback } from "../utils/clipboard";
import { parseOsc7Path } from "../utils/path";
import { useCoreStore } from "./useCoreStore";
import { useSettingsStore } from "./useSettingsStore";

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

  function applyTerminalSettings(): void {
    terminalInstances.forEach(({ terminal, fitAddon }) => {
      terminal.options.fontSize = settingsStore.appSettings.terminal.fontSize;
      terminal.options.lineHeight = settingsStore.appSettings.terminal.lineHeight;
      terminal.options.theme = {
        ...terminal.options.theme,
        selectionBackground:
          settingsStore.appSettings.terminal.selectionBackground,
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
      void core.orbitSSHApi?.terminals.resize({
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
    const startedAt = performance.now();
    const host = terminalHosts.get(tab.id);

    if (!host || terminalInstances.has(tab.id)) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: settingsStore.appSettings.terminal.fontSize,
      lineHeight: settingsStore.appSettings.terminal.lineHeight,
      theme: {
        background: "#0b0f14",
        foreground: "#d8e2f0",
        cursor: "#ffffff",
        selectionBackground:
          settingsStore.appSettings.terminal.selectionBackground,
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
      void core.orbitSSHApi?.terminals.resize({
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
    activateTerminalTab,
    closeTerminalTab,
    handleTerminalData,
    handleTerminalStatus,
    startListeners,
    stopListeners,
    disposeAllTerminals,
    cleanup,
  };
});
