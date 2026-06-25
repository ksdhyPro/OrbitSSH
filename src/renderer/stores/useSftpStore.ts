import { defineStore } from "pinia";
import { reactive, ref } from "vue";

import type { TerminalTab } from "../types/terminal";
import type {
  FileContextMenuState,
  FileTextProbeState,
  ImagePreviewState,
  SftpTreeState,
} from "../types/sftp";
import type {
  RemoteFileNode,
  SftpPreviewImageResult,
} from "../../shared/sftp";
import { copyTextByFallback } from "../utils/clipboard";
import { getRemoteParentPath, getRootName } from "../utils/path";
import { updateNodeChildren } from "../utils/file-tree";
import { isKnownEditableTextFile, isPreviewImageFile } from "../utils/file-kind";
import { useCoreStore } from "./useCoreStore";

export interface DeleteRemoteNodeCallbacks {
  shouldDelete: (message: string) => boolean | Promise<boolean>;
  onDeleted?: (node: RemoteFileNode) => void;
}

// SFTP 域 store：管理文件树、路径跳转、远程文件探测、预览、下载与删除。
export const useSftpStore = defineStore("sftp", () => {
  const core = useCoreStore();

  const isImagePreviewOpen = ref(false);
  const isSftpPathPromptOpen = ref(false);
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
  const imagePreview = reactive<ImagePreviewState>({
    tabId: "",
    path: "",
    name: "",
    dataUrl: "",
    mimeType: "",
    loading: false,
    error: "",
  });

  function getSftpTree(tabId: string): SftpTreeState | undefined {
    return sftpTrees.value[tabId];
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

  async function closeSftpSession(tabId: string): Promise<void> {
    await core.orbitSSHApi?.sftp.close(tabId);
  }

  async function loadSftpHome(tab: TerminalTab): Promise<void> {
    const startedAt = performance.now();
    core.writeRendererLog("开始加载 SFTP home", {
      tabId: tab.id,
      serverId: tab.serverId,
    });

    if (!core.orbitSSHApi) {
      core.writeRendererLog(
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
      deletingPaths: new Set<string>(),
      error: "",
    });

    try {
      const result = await core.orbitSSHApi.sftp.open(tab.id, tab.serverId);
      const loadedAt = performance.now();
      core.writeRendererLog("SFTP home 返回成功", {
        tabId: tab.id,
        homePath: result.homePath,
        nodeCount: result.nodes.length,
        totalMs: Math.round(loadedAt - startedAt),
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
        deletingPaths: new Set<string>(),
        error: "",
      });
    } catch (error) {
      core.writeRendererLog(
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
        deletingPaths: new Set<string>(),
        error: error instanceof Error ? error.message : "SFTP 文件树加载失败",
      });
    }
  }

  async function toggleRemoteDirectory(
    tabId: string,
    node: RemoteFileNode,
  ): Promise<void> {
    const tree = getSftpTree(tabId);

    core.writeRendererLog("点击远程文件节点", {
      tabId,
      path: node.path,
      type: node.type,
      loaded: node.loaded,
    });

    if (node.type !== "directory" || !tree) {
      return;
    }

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
      const children = await core.orbitSSHApi?.sftp.list({
        tabId,
        path: node.path,
      });

      if (!children) {
        core.writeRendererLog(
          "目录读取返回空结果",
          { tabId, path: node.path },
          "warn",
        );
        return;
      }

      core.writeRendererLog("目录懒加载完成", {
        tabId,
        path: node.path,
        nodeCount: children.length,
      });

      const latestTree = getSftpTree(tabId);

      if (!latestTree) {
        return;
      }

      const latestLoadingPaths = new Set(latestTree.loadingPaths);
      latestLoadingPaths.delete(node.path);

      setSftpTree(tabId, {
        ...latestTree,
        root: updateNodeChildren(latestTree.root, node.path, children),
        loadingPaths: latestLoadingPaths,
      });
    } catch (error) {
      core.writeRendererLog(
        "目录懒加载失败",
        {
          tabId,
          path: node.path,
          error: error instanceof Error ? error.message : String(error),
        },
        "error",
      );
      const latestTree = getSftpTree(tabId);

      if (!latestTree) {
        return;
      }

      const latestLoadingPaths = new Set(latestTree.loadingPaths);
      latestLoadingPaths.delete(node.path);

      setSftpTree(tabId, {
        ...latestTree,
        loadingPaths: latestLoadingPaths,
        error: error instanceof Error ? error.message : "目录读取失败",
      });
    }
  }

  async function refreshActiveDirectory(tab: TerminalTab | undefined): Promise<void> {
    if (!tab) {
      core.writeRendererLog("刷新文件树跳过：没有活动 Tab", undefined, "warn");
      return;
    }

    core.writeRendererLog("刷新活动文件树", {
      tabId: tab.id,
      serverId: tab.serverId,
    });
    await loadSftpHome(tab);
  }

  function showSftpPathPrompt(message: string, title = "路径无法访问"): void {
    sftpPathPromptTitle.value = title;
    sftpPathPromptMessage.value = message;
    isSftpPathPromptOpen.value = true;
  }

  function closeSftpPathPrompt(homePath = ""): void {
    isSftpPathPromptOpen.value = false;
    sftpPathPromptTitle.value = "路径无法访问";
    sftpPathPromptMessage.value = "";
    filePathInput.value = homePath;
  }

  async function openSftpDirectoryPath(
    tab: TerminalTab,
    path: string,
    fallbackError: string,
  ): Promise<boolean> {
    const targetPath = path.trim();

    if (!targetPath) {
      const tree = getSftpTree(tab.id);

      if (tree) {
        setSftpTree(tab.id, {
          ...tree,
          error: "请输入远程路径",
        });
      }

      return false;
    }

    try {
      const nodes = await core.orbitSSHApi?.sftp.list({
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
        deletingPaths: new Set<string>(),
        error: "",
      });
      return true;
    } catch (error) {
      const tree = getSftpTree(tab.id);

      if (tree) {
        setSftpTree(tab.id, {
          ...tree,
          error: "",
        });
      }

      showSftpPathPrompt(fallbackError);
      core.writeRendererLog(
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

  async function submitFilePathInput(tab: TerminalTab | undefined): Promise<void> {
    if (!tab || !core.orbitSSHApi) {
      return;
    }

    await openSftpDirectoryPath(tab, filePathInput.value, "路径不存在或无法访问");
  }

  async function copyActiveSftpPath(
    tabId: string,
    tree: SftpTreeState | undefined,
  ): Promise<void> {
    if (!tabId || !tree?.homePath) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tree.homePath);
      } else if (!copyTextByFallback(tree.homePath)) {
        throw new Error("复制失败");
      }

      setSftpTree(tabId, {
        ...tree,
        error: "",
      });
    } catch (error) {
      setSftpTree(tabId, {
        ...tree,
        error: error instanceof Error ? error.message : "复制路径失败",
      });
    }
  }

  async function syncFileTreeToTerminalPath(
    tab: TerminalTab | undefined,
  ): Promise<void> {
    const terminalPath = tab?.currentPath;

    if (!tab || !terminalPath) {
      core.writeRendererLog(
        "同步终端路径跳过：终端路径为空",
        { tabId: tab?.id },
        "warn",
      );
      return;
    }

    if (!core.orbitSSHApi) {
      return;
    }

    core.writeRendererLog("开始同步文件树到终端路径", {
      tabId: tab.id,
      path: terminalPath,
    });

    await openSftpDirectoryPath(tab, terminalPath, "同步终端路径失败");
  }

  function canDownloadRemoteFile(
    tabId: string,
    node: RemoteFileNode | null,
  ): boolean {
    return Boolean(node && node.type === "file" && tabId);
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

  function canDeleteRemoteNode(
    tree: SftpTreeState | undefined,
    node: RemoteFileNode | null,
  ): boolean {
    return Boolean(
      node &&
        tree &&
        node.path !== tree.root.path &&
        !tree.deletingPaths.has(node.path),
    );
  }

  function canUploadRemoteNode(node: RemoteFileNode | null): boolean {
    return Boolean(node && node.type === "directory");
  }

  async function probeFileTextSupport(
    tabId: string,
    node: RemoteFileNode,
  ): Promise<void> {
    if (
      node.type !== "file" ||
      isKnownEditableTextFile(node) ||
      !tabId ||
      fileTextProbeStates[node.path]
    ) {
      return;
    }

    fileTextProbeStates[node.path] = { status: "checking" };

    try {
      const result = await core.orbitSSHApi?.sftp.probeText({
        tabId,
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
      core.writeRendererLog(
        "远程文件文本探测失败",
        {
          tabId,
          path: node.path,
          error: error instanceof Error ? error.message : String(error),
        },
        "warn",
      );
    }
  }

  async function ensureEditableTextFile(
    tabId: string,
    node: RemoteFileNode,
  ): Promise<boolean> {
    if (isEditableTextFile(node)) {
      return true;
    }

    if (node.type !== "file" || !tabId) {
      return false;
    }

    await probeFileTextSupport(tabId, node);
    return isEditableTextFile(node);
  }

  function closeFileContextMenu(): void {
    fileContextMenu.open = false;
    fileContextMenu.node = null;
  }

  function openFileContextMenu(
    tabId: string,
    event: MouseEvent,
    node: RemoteFileNode,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    fileContextMenu.open = true;
    fileContextMenu.x = event.clientX;
    fileContextMenu.y = event.clientY;
    fileContextMenu.node = node;

    if (!isPreviewImageFile(node)) {
      void probeFileTextSupport(tabId, node);
    }
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

  async function openRemoteImagePreview(
    tabId: string,
    node: RemoteFileNode,
  ): Promise<void> {
    if (!tabId || !core.orbitSSHApi || !isPreviewImageFile(node)) {
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
      const result = await core.orbitSSHApi.sftp.previewImage({
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

  async function downloadRemoteFileNode(
    tabId: string,
    node: RemoteFileNode,
  ): Promise<void> {
    if (!tabId || !core.orbitSSHApi || !canDownloadRemoteFile(tabId, node)) {
      return;
    }

    try {
      await core.orbitSSHApi.sftp.download({
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

  async function downloadContextFile(tabId: string): Promise<void> {
    const node = fileContextMenu.node;

    if (!node || !canDownloadRemoteFile(tabId, node)) {
      return;
    }

    closeFileContextMenu();
    await downloadRemoteFileNode(tabId, node);
  }

  async function downloadImagePreviewFile(): Promise<void> {
    if (
      !imagePreview.tabId ||
      !imagePreview.path ||
      !imagePreview.name ||
      !core.orbitSSHApi
    ) {
      return;
    }

    try {
      await core.orbitSSHApi.sftp.download({
        tabId: imagePreview.tabId,
        path: imagePreview.path,
        name: imagePreview.name,
      });
    } catch (error) {
      imagePreview.error =
        error instanceof Error ? error.message : "文件下载失败";
    }
  }

  async function uploadToContextDirectory(
    tabId: string,
    sourceType: "file" | "directory",
  ): Promise<void> {
    const node = fileContextMenu.node;

    if (!node || !tabId || !core.orbitSSHApi || !canUploadRemoteNode(node)) {
      return;
    }

    closeFileContextMenu();

    try {
      const result = await core.orbitSSHApi.sftp.upload({
        tabId,
        remoteDirectoryPath: node.path,
        sourceType,
      });

      if (!result.uploaded) {
        return;
      }
    } catch (error) {
      showSftpPathPrompt(
        error instanceof Error ? error.message : "文件上传失败",
        "上传失败",
      );
      core.writeRendererLog(
        "远程目录上传失败",
        {
          tabId,
          path: node.path,
          error: error instanceof Error ? error.message : String(error),
        },
        "error",
      );
    }
  }

  async function refreshRemoteDirectoryPath(
    tabId: string,
    path: string,
  ): Promise<void> {
    if (!tabId || !path || !core.orbitSSHApi) {
      return;
    }

    const children = await core.orbitSSHApi.sftp.list({
      tabId,
      path,
    });
    const latestTree = getSftpTree(tabId);

    if (!latestTree) {
      return;
    }

    setSftpTree(tabId, {
      ...latestTree,
      root: updateNodeChildren(latestTree.root, path, children),
      error: "",
    });
  }

  async function deleteContextFile(
    tabId: string,
    tree: SftpTreeState | undefined,
    callbacks: DeleteRemoteNodeCallbacks,
  ): Promise<void> {
    const node = fileContextMenu.node;
    const typeLabel = node?.type === "directory" ? "文件夹" : "文件";

    if (
      !node ||
      !tabId ||
      !core.orbitSSHApi ||
      !tree ||
      !canDeleteRemoteNode(tree, node)
    ) {
      return;
    }

    const confirmMessage =
      node.type === "directory"
        ? `确认删除文件夹“${node.name}”？\n\n该操作会递归删除其中的所有文件和子文件夹。`
        : `确认删除文件“${node.name}”？`;

    if (!(await callbacks.shouldDelete(confirmMessage))) {
      closeFileContextMenu();
      return;
    }

    closeFileContextMenu();
    const deletingPaths = new Set(tree.deletingPaths);
    deletingPaths.add(node.path);
    setSftpTree(tabId, {
      ...tree,
      deletingPaths,
      error: "",
    });

    try {
      await core.orbitSSHApi.sftp.delete({
        tabId,
        path: node.path,
        type: node.type,
      });

      // 删除后清理本地探测状态，避免同路径新文件复用旧结论。
      delete fileTextProbeStates[node.path];
      callbacks.onDeleted?.(node);

      const parentPath = getRemoteParentPath(node.path);
      const children = await core.orbitSSHApi.sftp.list({
        tabId,
        path: parentPath,
      });
      const latestTree = getSftpTree(tabId);

      if (!latestTree) {
        return;
      }

      const nextExpandedPaths = new Set(latestTree.expandedPaths);
      nextExpandedPaths.delete(node.path);
      const nextDeletingPaths = new Set(latestTree.deletingPaths);
      nextDeletingPaths.delete(node.path);

      setSftpTree(tabId, {
        ...latestTree,
        root: updateNodeChildren(latestTree.root, parentPath, children),
        expandedPaths: nextExpandedPaths,
        deletingPaths: nextDeletingPaths,
        error: "",
      });
    } catch (error) {
      const latestTree = getSftpTree(tabId);

      if (latestTree) {
        const nextDeletingPaths = new Set(latestTree.deletingPaths);
        nextDeletingPaths.delete(node.path);

        setSftpTree(tabId, {
          ...latestTree,
          deletingPaths: nextDeletingPaths,
          error:
            error instanceof Error ? error.message : `删除${typeLabel}失败`,
        });
      }

      core.writeRendererLog(
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

  return {
    isImagePreviewOpen,
    isSftpPathPromptOpen,
    filePathInput,
    sftpPathPromptTitle,
    sftpPathPromptMessage,
    sftpTrees,
    fileTreeElement,
    fileContextMenu,
    fileTextProbeStates,
    imagePreview,
    getSftpTree,
    setSftpTree,
    removeSftpTree,
    closeSftpSession,
    loadSftpHome,
    toggleRemoteDirectory,
    refreshActiveDirectory,
    showSftpPathPrompt,
    closeSftpPathPrompt,
    openSftpDirectoryPath,
    submitFilePathInput,
    copyActiveSftpPath,
    syncFileTreeToTerminalPath,
    canDownloadRemoteFile,
    getFileTextProbeState,
    isEditableTextFile,
    getFileEditMenuLabel,
    canDeleteRemoteNode,
    canUploadRemoteNode,
    probeFileTextSupport,
    ensureEditableTextFile,
    closeFileContextMenu,
    openFileContextMenu,
    openRemoteImagePreview,
    closeImagePreview,
    downloadRemoteFileNode,
    downloadContextFile,
    downloadImagePreviewFile,
    uploadToContextDirectory,
    refreshRemoteDirectoryPath,
    deleteContextFile,
  };
});
