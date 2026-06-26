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
import { defineStore } from "pinia";
import { computed, nextTick, reactive, ref } from "vue";

import type { RemoteFileNode } from "../../shared/sftp";
import { createFileEditorState } from "../utils/codemirror/state";
import { createFileEditorTheme } from "../utils/codemirror/theme";
import { useCoreStore } from "./useCoreStore";
import { useSettingsStore } from "./useSettingsStore";

// 文件编辑器域 store：管理远程文本文件读取、CodeMirror 实例、搜索替换与保存。
export const useFileEditorStore = defineStore("fileEditor", () => {
  const core = useCoreStore();
  const settingsStore = useSettingsStore();

  const isFileEditorOpen = ref(false);
  const isFileEditorCloseConfirmOpen = ref(false);
  const isFileEditorSearchOpen = ref(false);
  const isFileEditorSearchCaseSensitive = ref(false);
  const fileEditorContainer = ref<HTMLElement | null>(null);
  const fileEditorSearchInput = ref<HTMLInputElement | null>(null);
  const fileEditorReplaceInput = ref<HTMLInputElement | null>(null);
  const fileEditorError = ref("");
  const fileEditorSearchKeyword = ref("");
  const fileEditorReplaceText = ref("");
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

  let fileEditorView: EditorView | undefined;
  const fileEditorThemeCompartment = new Compartment();

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
          createFileEditorTheme(
            settingsStore.appSettings.terminal.selectionBackground,
            settingsStore.appSettings.appearance.themeMode,
          ),
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

  async function openRemoteFileEditor(
    tabId: string,
    node: RemoteFileNode,
  ): Promise<void> {
    if (!tabId || !core.orbitSSHApi) {
      return;
    }

    fileEditor.loading = true;
    fileEditorError.value = "";
    isFileEditorOpen.value = true;
    fileEditor.tabId = tabId;
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
      const result = await core.orbitSSHApi.sftp.readText({
        tabId,
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
      // 保存前优先同步 CodeMirror 文档，避免最后一次输入未进入响应式状态。
      fileEditor.content =
        fileEditorView?.state.doc.toString() ?? fileEditor.content;
      await core.orbitSSHApi?.sftp.writeText({
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

  function applyFileEditorTheme(): void {
    if (!fileEditorView) {
      return;
    }

    fileEditorView.dispatch({
      effects: fileEditorThemeCompartment.reconfigure(
        createFileEditorTheme(
          settingsStore.appSettings.terminal.selectionBackground,
          settingsStore.appSettings.appearance.themeMode,
        ),
      ),
    });
  }

  return {
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
    fileEditorLineNumbers,
    mountFileEditorView,
    openRemoteFileEditor,
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
    handleFileEditorKeydown,
    applyFileEditorTheme,
  };
});
