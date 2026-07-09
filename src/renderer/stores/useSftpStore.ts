import { defineStore } from "pinia";
import { reactive, ref } from "vue";

import type { TerminalTab } from "../types/terminal";
import type {
  BlankContextMenuState,
  FileContextMenuState,
  FileTextProbeState,
  ImagePreviewState,
  RenamingState,
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
import { closeFloatingMenus } from "../utils/floating-menu";
import { resolveMenuPlacement } from "../utils/menu-position";
import {
  canMoveRemoteNodesToDirectory,
  deleteRemoteNodes,
  getRemoteDeleteConfirmMessage,
  getRemoteMoveConfirmMessage,
  moveRemoteNodesToDirectory,
  refreshRemoteDirectory,
  renameRemoteNodeByName,
} from "../utils/remote-node-actions";
import {
  selectAllRemoteFileNodes,
  selectRemoteFileNode,
  selectRemoteFileNodesByPaths,
} from "../utils/remote-file-selection";
import { useCoreStore } from "./useCoreStore";

export interface DeleteRemoteNodeCallbacks {
  shouldDelete: (message: string) => boolean | Promise<boolean>;
  onDeleted?: (node: RemoteFileNode) => void;
}

export interface MoveRemoteNodeCallbacks {
  shouldMove: (message: string) => boolean | Promise<boolean>;
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
  const fileDragSourcePaths = ref<Set<string>>(new Set());
  const fileDragTargetPath = ref("");
  const fileContextMenu = reactive<FileContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    node: null,
    selectedCount: 0,
    contextNodeSelected: false,
  });
  const blankContextMenu = reactive<BlankContextMenuState>({
    open: false,
    x: 0,
    y: 0,
  });
  // 内联重命名/新建后的编辑态：非 null 时对应节点文件名处显示输入框。
  const renaming = ref<RenamingState | null>(null);
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
      disconnected: false,
      expandedPaths: new Set<string>(),
      loadingPaths: new Set<string>([pendingRoot.path]),
      deletingPaths: new Set<string>(),
      selectedPaths: new Set<string>(),
      lastClickedIndex: -1,
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
        disconnected: false,
        expandedPaths: new Set<string>([root.path]),
        loadingPaths: new Set<string>(),
        deletingPaths: new Set<string>(),
        selectedPaths: new Set<string>(),
        lastClickedIndex: -1,
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
        disconnected: false,
        expandedPaths: new Set<string>(),
        loadingPaths: new Set<string>(),
        deletingPaths: new Set<string>(),
        selectedPaths: new Set<string>(),
        lastClickedIndex: -1,
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
        disconnected: false,
        expandedPaths: new Set<string>([targetPath]),
        loadingPaths: new Set<string>(),
        deletingPaths: new Set<string>(),
        selectedPaths: new Set<string>(),
        lastClickedIndex: -1,
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

  function markSftpDisconnected(tabId: string): void {
    const tree = getSftpTree(tabId);

    if (!tree || tree.disconnected) {
      return;
    }

    const root: RemoteFileNode = {
      ...tree.root,
      loaded: true,
      children: [],
    };

    // SSH 断开后主 SFTP 会话也不可继续使用，立即清空旧目录，避免用户误操作陈旧文件列表。
    setSftpTree(tabId, {
      ...tree,
      root,
      disconnected: true,
      expandedPaths: new Set<string>(),
      loadingPaths: new Set<string>(),
      deletingPaths: new Set<string>(),
      selectedPaths: new Set<string>(),
      lastClickedIndex: -1,
      error: "SFTP 已断开",
    });

    if (renaming.value?.tabId === tabId) {
      renaming.value = null;
    }

    closeFileContextMenu();
    closeBlankContextMenu();
    clearRemoteNodeDrag();
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
    fileContextMenu.selectedCount = 0;
    fileContextMenu.contextNodeSelected = false;
  }

  function closeBlankContextMenu(): void {
    blankContextMenu.open = false;
  }

  // 在文件面板空白处右键：不改变选中状态，仅弹出新建菜单。
  function openBlankContextMenu(tabId: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (!getSftpTree(tabId)) {
      return;
    }

    closeFloatingMenus();

    const placement = resolveMenuPlacement({
      x: event.clientX,
      y: event.clientY,
    });
    blankContextMenu.x = placement.x;
    blankContextMenu.y = placement.y;
    blankContextMenu.open = true;
  }

  // 进入重命名编辑态：右键节点选「重命名」或新建占位节点后调用。
  function startRename(tabId: string, node: RemoteFileNode): void {
    renaming.value = {
      tabId,
      path: node.path,
      value: node.name,
    };
  }

  function cancelRename(): void {
    renaming.value = null;
  }

  // 提交重命名：空名直接取消；同名直接关闭；否则调用后端 rename 后刷新父目录。
  async function commitRename(): Promise<void> {
    const state = renaming.value;

    if (!state || !core.orbitSSHApi) {
      return;
    }

    const trimmed = state.value.trim();

    if (!trimmed) {
      renaming.value = null;
      return;
    }

    // 拼出新路径：父目录 + 新名。
    const parentPath = getRemoteParentPath(state.path);
    renaming.value = null;

    try {
      const result = await renameRemoteNodeByName(
        core.orbitSSHApi.sftp,
        state.tabId,
        state.path,
        trimmed,
      );

      if (result.renamed) {
        // 旧路径的文本探测结果失效，清掉避免残留状态。
        delete fileTextProbeStates[state.path];
      }

      await refreshRemoteDirectoryPath(state.tabId, parentPath);
    } catch (error) {
      showSftpPathPrompt(
        error instanceof Error ? error.message : "重命名失败",
        "重命名失败",
      );
    }
  }

  // 新建文件/文件夹：先用占位名创建，成功后刷新目录并进入重命名态（名称全选可改名）。
  async function createRemoteNode(
    tabId: string,
    parentPath: string,
    type: "file" | "directory",
  ): Promise<void> {
    if (!tabId || !core.orbitSSHApi || !parentPath) {
      return;
    }

    const placeholderName =
      type === "directory" ? "新建文件夹" : "新建文件.txt";
    const newPath =
      parentPath === "/" ? `/${placeholderName}` : `${parentPath}/${placeholderName}`;

    closeFileContextMenu();
    closeBlankContextMenu();

    try {
      if (type === "directory") {
        await core.orbitSSHApi.sftp.createDirectory({ tabId, path: newPath });
      } else {
        await core.orbitSSHApi.sftp.createFile({ tabId, path: newPath });
      }

      await refreshRemoteDirectoryPath(tabId, parentPath);

      // 进入重命名态，名称默认全选，用户可立即改名（Windows 式）。
      renaming.value = { tabId, path: newPath, value: placeholderName };
    } catch (error) {
      showSftpPathPrompt(
        error instanceof Error ? error.message : "新建失败",
        "新建失败",
      );
    }
  }

  function clearFileSelection(tabId: string): void {
    const tree = getSftpTree(tabId);

    if (!tree) {
      return;
    }

    setSftpTree(tabId, {
      ...tree,
      selectedPaths: new Set<string>(),
      lastClickedIndex: -1,
    });
  }

  function selectFileNode(
    tabId: string,
    node: RemoteFileNode & { isVirtualParent?: boolean },
    visibleNodes: (RemoteFileNode & { isVirtualParent?: boolean })[],
    event: MouseEvent,
  ): void {
    const tree = getSftpTree(tabId);

    if (!tree) {
      return;
    }

    const nextSelection = selectRemoteFileNode({
      current: tree,
      node,
      visibleNodes,
      event,
      isSelectable: item =>
        !item.isVirtualParent && !tree.deletingPaths.has(item.path),
    });

    if (!nextSelection) {
      return;
    }

    setSftpTree(tabId, {
      ...tree,
      selectedPaths: nextSelection.selectedPaths,
      lastClickedIndex: nextSelection.lastClickedIndex,
    });
  }

  function selectAllInFileTree(
    tabId: string,
    visibleNodes: (RemoteFileNode & { isVirtualParent?: boolean })[],
  ): void {
    const tree = getSftpTree(tabId);

    if (!tree) {
      return;
    }

    const nextSelection = selectAllRemoteFileNodes(
      visibleNodes,
      node => !node.isVirtualParent && !tree.deletingPaths.has(node.path),
    );

    setSftpTree(tabId, {
      ...tree,
      selectedPaths: nextSelection.selectedPaths,
      lastClickedIndex: nextSelection.lastClickedIndex,
    });
  }

  function selectFileNodesByPaths(
    tabId: string,
    visibleNodes: (RemoteFileNode & { isVirtualParent?: boolean })[],
    paths: string[],
  ): void {
    const tree = getSftpTree(tabId);

    if (!tree) {
      return;
    }

    const nextSelection = selectRemoteFileNodesByPaths(
      visibleNodes,
      paths,
      node => !node.isVirtualParent && !tree.deletingPaths.has(node.path),
    );

    setSftpTree(tabId, {
      ...tree,
      selectedPaths: nextSelection.selectedPaths,
      lastClickedIndex: nextSelection.lastClickedIndex,
    });
  }

  function getSelectedNodes(
    tree: SftpTreeState | undefined,
  ): RemoteFileNode[] {
    if (!tree) {
      return [];
    }

    const result: RemoteFileNode[] = [];
    collectNodes(tree.root, tree.selectedPaths, result);
    return result;
  }

  function collectNodes(
    node: RemoteFileNode,
    selectedPaths: Set<string>,
    result: RemoteFileNode[],
  ): void {
    if (selectedPaths.has(node.path)) {
      result.push(node);
    }

    if (node.children) {
      for (const child of node.children) {
        collectNodes(child, selectedPaths, result);
      }
    }
  }

  function getDragMoveNodes(
    tree: SftpTreeState | undefined,
    node: RemoteFileNode,
  ): RemoteFileNode[] {
    if (!tree || tree.deletingPaths.has(node.path) || node.path === tree.root.path) {
      return [];
    }

    const selectedNodes = getSelectedNodes(tree);
    const nodes = tree.selectedPaths.has(node.path) && selectedNodes.length > 0
      ? selectedNodes
      : [node];

    return nodes.filter(
      (item) => !tree.deletingPaths.has(item.path) && item.path !== tree.root.path,
    );
  }

  function startRemoteNodeDrag(
    tree: SftpTreeState | undefined,
    node: RemoteFileNode,
  ): void {
    fileDragSourcePaths.value = new Set(
      getDragMoveNodes(tree, node).map((item) => item.path),
    );
    fileDragTargetPath.value = "";
  }

  function clearRemoteNodeDrag(): void {
    fileDragSourcePaths.value = new Set<string>();
    fileDragTargetPath.value = "";
  }

  function clearRemoteNodeDragTarget(): void {
    fileDragTargetPath.value = "";
  }

  function updateRemoteNodeDragTarget(
    tree: SftpTreeState | undefined,
    targetNode: RemoteFileNode,
  ): boolean {
    const sourceNodes = getSelectedNodesByPaths(tree, fileDragSourcePaths.value);
    const canMove = canMoveRemoteNodesToDirectory(sourceNodes, targetNode);

    fileDragTargetPath.value = canMove ? targetNode.path : "";
    return canMove;
  }

  function getSelectedNodesByPaths(
    tree: SftpTreeState | undefined,
    selectedPaths: Set<string>,
  ): RemoteFileNode[] {
    if (!tree) {
      return [];
    }

    const result: RemoteFileNode[] = [];
    collectNodes(tree.root, selectedPaths, result);
    return result;
  }

  async function moveDraggedRemoteNodesToDirectory(
    tabId: string,
    tree: SftpTreeState | undefined,
    targetDirectory: RemoteFileNode,
    callbacks: MoveRemoteNodeCallbacks,
  ): Promise<void> {
    if (!tabId || !tree || !core.orbitSSHApi) {
      clearRemoteNodeDrag();
      return;
    }

    const nodesToMove = getSelectedNodesByPaths(tree, fileDragSourcePaths.value);

    if (!canMoveRemoteNodesToDirectory(nodesToMove, targetDirectory)) {
      clearRemoteNodeDrag();
      return;
    }

    if (!(await callbacks.shouldMove(getRemoteMoveConfirmMessage(nodesToMove, targetDirectory)))) {
      clearRemoteNodeDrag();
      return;
    }

    const { firstError } = await moveRemoteNodesToDirectory(
      core.orbitSSHApi.sftp,
      tabId,
      nodesToMove,
      targetDirectory,
    );
    const refreshPaths = new Set<string>([targetDirectory.path]);

    for (const node of nodesToMove) {
      refreshPaths.add(getRemoteParentPath(node.path));
      delete fileTextProbeStates[node.path];
    }

    try {
      for (const path of refreshPaths) {
        await refreshRemoteDirectoryPath(tabId, path);
      }

      const latestTree = getSftpTree(tabId);
      if (latestTree) {
        setSftpTree(tabId, {
          ...latestTree,
          selectedPaths: new Set<string>(),
          lastClickedIndex: -1,
          error: firstError,
        });
      }
    } catch (error) {
      const latestTree = getSftpTree(tabId);
      if (latestTree) {
        setSftpTree(tabId, {
          ...latestTree,
          error:
            firstError ||
            (error instanceof Error ? error.message : "移动后刷新目录失败"),
        });
      }
    } finally {
      clearRemoteNodeDrag();
    }
  }

  function openFileContextMenu(
    tabId: string,
    event: MouseEvent,
    node: RemoteFileNode,
  ): void {
    event.preventDefault();
    event.stopPropagation();

    const tree = getSftpTree(tabId);
    closeFloatingMenus();

    // 右键不参与选中，仅记录当前选区状态，避免右键污染多选/单选状态。
    fileContextMenu.selectedCount = tree?.selectedPaths.size ?? 0;
    fileContextMenu.contextNodeSelected = Boolean(
      tree?.selectedPaths.has(node.path),
    );

    fileContextMenu.open = true;
    const placement = resolveMenuPlacement({
      x: event.clientX,
      y: event.clientY,
    });
    fileContextMenu.x = placement.x;
    fileContextMenu.y = placement.y;
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
    const tree = getSftpTree(tabId);

    if (!tabId || !core.orbitSSHApi) {
      return;
    }

    // 右键菜单上传始终落到当前所在目录，避免选中目录时改变目标。
    const targetPath = tree?.homePath;

    if (!targetPath) {
      return;
    }

    closeFileContextMenu();
    await uploadToRemoteDirectory(tabId, targetPath, sourceType);
  }

  async function uploadToCurrentDirectory(
    tabId: string,
    sourceType: "file" | "directory",
  ): Promise<void> {
    const tree = getSftpTree(tabId);

    if (!tabId || !tree?.homePath || !core.orbitSSHApi) {
      return;
    }

    closeBlankContextMenu();
    await uploadToRemoteDirectory(tabId, tree.homePath, sourceType);
  }

  async function uploadToRemoteDirectory(
    tabId: string,
    remoteDirectoryPath: string,
    sourceType: "file" | "directory",
  ): Promise<void> {
    try {
      const result = await core.orbitSSHApi.sftp.upload({
        tabId,
        remoteDirectoryPath,
        sourceType,
      });

      if (!result.uploaded) {
        return;
      }

      await refreshRemoteDirectoryPath(tabId, remoteDirectoryPath);
    } catch (error) {
      showSftpPathPrompt(
        error instanceof Error ? error.message : "文件上传失败",
        "上传失败",
      );
      core.writeRendererLog(
        "远程目录上传失败",
        {
          tabId,
          path: remoteDirectoryPath,
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

    const children = await refreshRemoteDirectory(core.orbitSSHApi.sftp, tabId, path);
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
    const contextNode = fileContextMenu.node;

    if (!contextNode || !tabId || !core.orbitSSHApi || !tree) {
      return;
    }

    // 收集待删除节点：多选时取全部选中项，否则取右键目标
    const selectedNodes = getSelectedNodes(tree);
    const shouldDeleteSelectedNodes =
      fileContextMenu.contextNodeSelected && selectedNodes.length > 1;
    const nodesToDelete =
      shouldDeleteSelectedNodes
        ? selectedNodes
        : [contextNode];

    // 过滤掉根目录和已在删除中的
    const validNodes = nodesToDelete.filter(
      n =>
        n.path !== tree.root.path &&
        !tree.deletingPaths.has(n.path),
    );

    if (validNodes.length === 0) {
      return;
    }

    const confirmMessage = getRemoteDeleteConfirmMessage(validNodes);

    if (!(await callbacks.shouldDelete(confirmMessage))) {
      closeFileContextMenu();
      return;
    }

    closeFileContextMenu();

    // 先标记所有待删节点
    const deletingPaths = new Set(tree.deletingPaths);

    for (const n of validNodes) {
      deletingPaths.add(n.path);
    }

    setSftpTree(tabId, {
      ...tree,
      deletingPaths,
      selectedPaths: new Set<string>(),
      lastClickedIndex: -1,
      error: '',
    });

    const { firstError } = await deleteRemoteNodes(
      core.orbitSSHApi.sftp,
      tabId,
      validNodes,
      {
        onDeleted: node => {
          delete fileTextProbeStates[node.path];
          callbacks.onDeleted?.(node);
        },
        onError: (node, error) => {
          core.writeRendererLog(
            '远程文件节点删除失败',
            {
              tabId,
              path: node.path,
              type: node.type,
              error: error instanceof Error ? error.message : String(error),
            },
            'error',
          );
        },
      },
    );

    // 删除完成后刷新父目录
    const contextParentPath = getRemoteParentPath(contextNode.path);

    try {
      const children = await refreshRemoteDirectory(
        core.orbitSSHApi.sftp,
        tabId,
        contextParentPath,
      );
      const latestTree = getSftpTree(tabId);

      if (latestTree) {
        const nextExpandedPaths = new Set(latestTree.expandedPaths);
        const nextDeletingPaths = new Set(latestTree.deletingPaths);

        for (const n of validNodes) {
          nextExpandedPaths.delete(n.path);
          nextDeletingPaths.delete(n.path);
        }

        setSftpTree(tabId, {
          ...latestTree,
          root: updateNodeChildren(latestTree.root, contextParentPath, children),
          expandedPaths: nextExpandedPaths,
          deletingPaths: nextDeletingPaths,
          error: firstError || '',
        });
      }
    } catch (error) {
      const latestTree = getSftpTree(tabId);

      if (latestTree) {
        const nextDeletingPaths = new Set(latestTree.deletingPaths);

        for (const n of validNodes) {
          nextDeletingPaths.delete(n.path);
        }

        setSftpTree(tabId, {
          ...latestTree,
          deletingPaths: nextDeletingPaths,
          error:
            firstError ||
            (error instanceof Error
              ? error.message
              : '删除后刷新目录失败'),
        });
      }
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
    blankContextMenu,
    renaming,
    fileTextProbeStates,
    fileDragTargetPath,
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
    markSftpDisconnected,
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
    closeBlankContextMenu,
    openBlankContextMenu,
    startRename,
    commitRename,
    cancelRename,
    createRemoteNode,
    openFileContextMenu,
    clearFileSelection,
    selectFileNode,
    selectAllInFileTree,
    selectFileNodesByPaths,
    startRemoteNodeDrag,
    clearRemoteNodeDrag,
    clearRemoteNodeDragTarget,
    updateRemoteNodeDragTarget,
    moveDraggedRemoteNodesToDirectory,
    getSelectedNodes,
    openRemoteImagePreview,
    closeImagePreview,
    downloadRemoteFileNode,
    downloadContextFile,
    downloadImagePreviewFile,
    uploadToContextDirectory,
    uploadToCurrentDirectory,
    refreshRemoteDirectoryPath,
    deleteContextFile,
  };
});
