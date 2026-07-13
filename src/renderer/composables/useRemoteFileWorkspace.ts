import { storeToRefs } from "pinia";
import { computed, nextTick, watch } from "vue";

import type { RemoteFileNode } from "../../shared/sftp";
import { useCoreStore } from "../stores/useCoreStore";
import { useFileEditorStore } from "../stores/useFileEditorStore";
import { useSftpStore } from "../stores/useSftpStore";
import { useTerminalsStore } from "../stores/useTerminalsStore";
import type { VisibleRemoteFileNode } from "../types/sftp";
import { isPreviewImageFile } from "../utils/file-kind";
import { getRemoteParentPath } from "../utils/path";

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
}

/**
 * 统一编排远程文件树、拖放、预览和编辑器交互，避免根组件承担文件域细节。
 */
export function useRemoteFileWorkspace(
  requestConfirm: (input: ConfirmRequest) => Promise<boolean>,
) {
  const coreStore = useCoreStore();
  const terminalsStore = useTerminalsStore();
  const sftpStore = useSftpStore();
  const fileEditorStore = useFileEditorStore();
  const writeRendererLog = coreStore.writeRendererLog;

  const { activeTabId, activeTab } = storeToRefs(terminalsStore);
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

  const activeSftpTree = computed(() => {
    if (!activeTabId.value) return undefined;
    return sftpTrees.value[activeTabId.value];
  });

  const visibleFileTree = computed<VisibleRemoteFileNode[]>(() => {
    const tree = activeSftpTree.value;
    if (!tree || tree.disconnected) return [];

    const parentNode = createParentDirectoryNode(tree.root.path);
    const currentLevelNodes = (tree.root.children ?? []).map(node => ({
      ...node,
      level: 0,
    }));
    return parentNode ? [parentNode, ...currentLevelNodes] : currentLevelNodes;
  });

  function createParentDirectoryNode(
    currentPath: string,
  ): VisibleRemoteFileNode | null {
    const normalizedPath = currentPath.replace(/\/+/g, "/").replace(/\/$/, "");
    if (!normalizedPath || normalizedPath === "/") return null;

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

  function getFilePanelHint(): string {
    if (!activeTab.value) return "打开 SSH 会话后显示远程目录";
    if (
      activeTab.value.status === "disconnected" ||
      activeTab.value.status === "error"
    ) {
      return "SFTP 已断开";
    }

    const tree = activeSftpTree.value;
    if (!tree) return "正在建立 SFTP 文件会话...";
    return tree.error || tree.homePath;
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
    if (node?.isVirtualParent) return false;
    return sftpStore.canDeleteRemoteNode(activeSftpTree.value, node);
  }

  function isRemoteNodeDeleting(node: RemoteFileNode | null): boolean {
    return Boolean(node && activeSftpTree.value?.deletingPaths.has(node.path));
  }

  function openFileContextMenu(
    event: MouseEvent,
    node: RemoteFileNode & { isVirtualParent?: boolean },
  ): void {
    if (node.isVirtualParent || isRemoteNodeDeleting(node)) return;
    sftpStore.openFileContextMenu(activeTabId.value, event, node);
  }

  function handleFileSelectNode(event: MouseEvent, node: RemoteFileNode): void {
    if (isRemoteNodeDeleting(node)) return;
    sftpStore.selectFileNode(
      activeTabId.value,
      node,
      visibleFileTree.value,
      event,
    );
  }

  function handleFileSelectAll(): void {
    sftpStore.selectAllInFileTree(activeTabId.value, visibleFileTree.value);
  }

  function handleFileClearSelection(): void {
    sftpStore.clearFileSelection(activeTabId.value);
  }

  function handleFileMarqueeSelect(paths: string[]): void {
    sftpStore.selectFileNodesByPaths(
      activeTabId.value,
      visibleFileTree.value,
      paths,
    );
  }

  function handleFileDragStart(
    event: DragEvent,
    node: RemoteFileNode & { isVirtualParent?: boolean },
  ): void {
    if (node.isVirtualParent || isRemoteNodeDeleting(node)) {
      event.preventDefault();
      return;
    }

    sftpStore.startRemoteNodeDrag(activeSftpTree.value, node);
    event.dataTransfer?.setData("text/plain", node.path);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function handleFileDragOver(
    event: DragEvent,
    node: RemoteFileNode & { isVirtualParent?: boolean },
  ): void {
    if (node.type !== "directory") {
      sftpStore.clearRemoteNodeDragTarget();
      return;
    }

    if (!sftpStore.updateRemoteNodeDragTarget(activeSftpTree.value, node)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function handleFileDragLeave(event: DragEvent, node: RemoteFileNode): void {
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
      sftpStore.clearRemoteNodeDragTarget();
    }
  }

  async function handleFileDrop(
    event: DragEvent,
    node: RemoteFileNode & { isVirtualParent?: boolean },
  ): Promise<void> {
    event.preventDefault();
    if (node.type !== "directory") {
      sftpStore.clearRemoteNodeDrag();
      return;
    }

    await sftpStore.moveDraggedRemoteNodesToDirectory(
      activeTabId.value,
      activeSftpTree.value,
      node,
      {
        shouldMove: message =>
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
    await sftpStore.downloadContextFile(activeTabId.value);
  }

  async function uploadContextFile(
    sourceType: "file" | "directory",
  ): Promise<void> {
    await sftpStore.uploadToContextDirectory(activeTabId.value, sourceType);
  }

  async function uploadToActiveSftpDirectory(
    sourceType: "file" | "directory",
  ): Promise<void> {
    await sftpStore.uploadToCurrentDirectory(activeTabId.value, sourceType);
  }

  async function refreshActiveDirectory(): Promise<void> {
    const tab = activeTab.value;
    const tree = activeSftpTree.value;
    if (!tab || !tree?.homePath) {
      await sftpStore.refreshActiveDirectory(tab);
      return;
    }
    await sftpStore.openSftpDirectoryPath(tab, tree.homePath, "刷新目录失败");
  }

  function closeSftpPathPrompt(): void {
    sftpStore.closeSftpPathPrompt(activeSftpTree.value?.homePath ?? "");
  }

  async function submitFilePathInput(): Promise<void> {
    await sftpStore.submitFilePathInput(activeTab.value);
  }

  async function copyActiveSftpPath(): Promise<void> {
    await sftpStore.copyActiveSftpPath(activeTabId.value, activeSftpTree.value);
  }

  async function syncFileTreeToTerminalPath(): Promise<void> {
    await sftpStore.syncFileTreeToTerminalPath(activeTab.value);
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
    if (!node || !sftpStore.isEditableTextFile(node) || !activeTabId.value) return;

    sftpStore.closeFileContextMenu();
    await fileEditorStore.openRemoteFileEditor(activeTabId.value, node);
  }

  async function previewContextFile(): Promise<void> {
    const node = fileContextMenu.value.node;
    if (!node || !isPreviewImageFile(node)) return;

    sftpStore.closeFileContextMenu();
    await sftpStore.openRemoteImagePreview(activeTabId.value, node);
  }

  async function openRemoteFileEditorByDoubleClick(
    node: RemoteFileNode,
  ): Promise<void> {
    if (node.type !== "file") return;
    if (isPreviewImageFile(node)) {
      await sftpStore.openRemoteImagePreview(activeTabId.value, node);
      return;
    }

    if (await sftpStore.ensureEditableTextFile(activeTabId.value, node)) {
      await fileEditorStore.openRemoteFileEditor(activeTabId.value, node);
    }
  }

  async function openRemoteNodeByDoubleClick(node: RemoteFileNode): Promise<void> {
    const tab = activeTab.value;
    if (isRemoteNodeDeleting(node)) return;

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
    await sftpStore.deleteContextFile(activeTabId.value, activeSftpTree.value, {
      shouldDelete: message =>
        requestConfirm({
          title: "确认删除",
          message,
          confirmLabel: "删除",
          danger: true,
        }),
      onDeleted: node => {
        if (fileEditor.value.path === node.path) fileEditorStore.closeFileEditor();
      },
    });
  }

  function handleOpenBlankContextMenu(event: MouseEvent): void {
    if (activeTab.value) {
      sftpStore.openBlankContextMenu(activeTabId.value, event);
    }
  }

  function renameContextFile(): void {
    const node = fileContextMenu.value.node;
    if (!node || !activeTabId.value) return;
    sftpStore.closeFileContextMenu();
    sftpStore.startRename(activeTabId.value, node);
  }

  async function handleCommitRename(): Promise<void> {
    const oldPath = renaming.value?.path;
    await sftpStore.commitRename();
    if (oldPath && fileEditor.value.path === oldPath) {
      fileEditorStore.closeFileEditor();
    }
  }

  function handleCancelRename(): void {
    sftpStore.cancelRename();
  }

  async function handleCreateBlankNode(
    type: "file" | "directory",
  ): Promise<void> {
    const parentPath = activeSftpTree.value?.homePath;
    if (parentPath) {
      await sftpStore.createRemoteNode(activeTabId.value, parentPath, type);
    }
  }

  watch(
    () => activeSftpTree.value?.homePath,
    homePath => {
      filePathInput.value = homePath ?? "";
    },
    { immediate: true },
  );

  watch(visibleFileTree, async nodes => {
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
  });

  return {
    activeSftpTree,
    visibleFileTree,
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
    loadSftpHome: sftpStore.loadSftpHome,
    removeSftpTree: sftpStore.removeSftpTree,
    closeSftpSession: sftpStore.closeSftpSession,
    markSftpDisconnected: sftpStore.markSftpDisconnected,
    closeFileContextMenu: sftpStore.closeFileContextMenu,
    closeBlankContextMenu: sftpStore.closeBlankContextMenu,
    clearRemoteNodeDrag: sftpStore.clearRemoteNodeDrag,
    downloadImagePreviewFile: sftpStore.downloadImagePreviewFile,
    closeImagePreview: sftpStore.closeImagePreview,
    requestCloseFileEditor: fileEditorStore.requestCloseFileEditor,
    saveFileEditor: fileEditorStore.saveFileEditor,
    saveAndCloseFileEditor: fileEditorStore.saveAndCloseFileEditor,
    discardFileEditorChanges: fileEditorStore.discardFileEditorChanges,
    undoFileEditor: fileEditorStore.undoFileEditor,
    redoFileEditor: fileEditorStore.redoFileEditor,
    applyFileEditorSearchQuery: fileEditorStore.applyFileEditorSearchQuery,
    openFileEditorSearch: fileEditorStore.openFileEditorSearch,
    closeFileEditorSearch: fileEditorStore.closeFileEditorSearch,
    toggleFileEditorSearchCaseSensitive:
      fileEditorStore.toggleFileEditorSearchCaseSensitive,
    searchFileEditor: fileEditorStore.searchFileEditor,
    replaceCurrentFileEditorMatch: fileEditorStore.replaceCurrentFileEditorMatch,
    replaceAllFileEditorMatches: fileEditorStore.replaceAllFileEditorMatches,
    applyFileEditorTheme: fileEditorStore.applyFileEditorTheme,
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
  };
}
