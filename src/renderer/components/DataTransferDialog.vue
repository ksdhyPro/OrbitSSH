<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import arrowUpIcon from "../assets/icons/arrow-up.svg";
import editIcon from "../assets/icons/edit.svg";
import trashIcon from "../assets/icons/trash.svg";
import type { ServerConfig } from "../../shared/server";
import type {
  RemoteFileNode,
  SftpRemoteTransferProgressEvent,
  SftpRemoteTransferSource,
} from "../../shared/sftp";
import type { ContextMenuItem, ContextMenuState } from "../types/context-menu";
import { resolveLocalMenuPlacement } from "../utils/menu-position";
import { getRemoteParentPath } from "../utils/path";
import {
  canMoveRemoteNodesToDirectory,
  deleteRemoteNodes,
  getRemoteDeleteConfirmMessage,
  getRemoteMoveConfirmMessage,
  moveRemoteNodesToDirectory,
  refreshRemoteDirectory,
  renameRemoteNodeByName,
} from "../utils/remote-node-actions";
import { useFileEditorStore } from "../stores/useFileEditorStore";
import { useSftpStore } from "../stores/useSftpStore";
import AppDialog from "./AppDialog.vue";
import ContextMenu from "./ContextMenu.vue";
import DeleteConfirmDialog from "./DeleteConfirmDialog.vue";
import RemoteFileList, { type RemoteFileListNode } from "./RemoteFileList.vue";
import AppSelect, { type AppSelectOption } from "./ui/AppSelect.vue";
type TransferPaneKey = "left" | "right";
interface TransferPaneState {
  tabId: string;
  serverId: string;
  currentPath: string;
  pathInput: string;
  nodes: RemoteFileNode[];
  selectedPaths: Set<string>;
  deletingPaths: Set<string>;
  lastClickedIndex: number;
  loading: boolean;
  error: string;
}
interface TransferContextMenuState extends ContextMenuState {
  paneKey: TransferPaneKey | null;
  node: RemoteFileNode | null;
  selectedCount: number;
  contextNodeSelected: boolean;
}
interface TransferRenamingState {
  paneKey: TransferPaneKey;
  path: string;
  value: string;
}
interface PendingTransferRefresh {
  targetPaneKey: TransferPaneKey;
  targetDirectoryPath: string;
}
const props = defineProps<{
  servers: ServerConfig[];
  isMac: boolean;
  activeSource?: {
    serverId: string;
    currentPath?: string;
  };
}>();
const emit = defineEmits<{
  close: [];
}>();
const sftpStore = useSftpStore();
const fileEditorStore = useFileEditorStore();
const leftPane = reactive<TransferPaneState>({
  tabId: `data-transfer-left-${crypto.randomUUID()}`,
  serverId: "",
  currentPath: "",
  pathInput: "",
  nodes: [],
  selectedPaths: new Set<string>(),
  deletingPaths: new Set<string>(),
  lastClickedIndex: -1,
  loading: false,
  error: "",
});
const rightPane = reactive<TransferPaneState>({
  tabId: `data-transfer-right-${crypto.randomUUID()}`,
  serverId: "",
  currentPath: "",
  pathInput: "",
  nodes: [],
  selectedPaths: new Set<string>(),
  deletingPaths: new Set<string>(),
  lastClickedIndex: -1,
  loading: false,
  error: "",
});
const focusedPane = ref<TransferPaneKey>("left");
const renaming = ref<TransferRenamingState | null>(null);
const transferContextMenu = reactive<TransferContextMenuState>({
  open: false,
  x: 0,
  y: 0,
  paneKey: null,
  node: null,
  selectedCount: 0,
  contextNodeSelected: false,
});
const deleteConfirmDialog = reactive({
  open: false,
  title: "确认删除",
  message: "",
  confirmLabel: "删除",
  danger: true,
});
let resolveDeleteConfirm: ((confirmed: boolean) => void) | null = null;
const pendingTransferRefreshes = new Map<string, PendingTransferRefresh>();
let removeRemoteTransferProgressListener: (() => void) | undefined;
const transferDrag = reactive<{
  paneKey: TransferPaneKey | null;
  sourcePaths: Set<string>;
  targetPath: string;
}>({
  paneKey: null,
  sourcePaths: new Set<string>(),
  targetPath: "",
});
const leftSelectedNodes = computed(() => getSelectedNodes(leftPane));
const rightSelectedNodes = computed(() => getSelectedNodes(rightPane));
const leftServerOptions = computed<AppSelectOption[]>(() =>
  props.servers.map((server) => ({
    value: server.id,
    label: server.name,
  })),
);
const rightServerOptions = computed<AppSelectOption[]>(() =>
  props.servers.map((server) => ({
    value: server.id,
    label: server.name,
  })),
);
const transferMenuItems = computed<ContextMenuItem[]>(() => {
  const paneKey = transferContextMenu.paneKey ?? focusedPane.value;
  const targetKey = getOppositePaneKey(paneKey);
  const node = transferContextMenu.node;
  const multiContext = isContextMultiSelection();
  const items: ContextMenuItem[] = [
    {
      key: "transfer-to-other",
      label: `传输到${getPaneLabel(targetKey)}`,
      icon: arrowUpIcon,
      disabled: !canTransferFromPane(paneKey),
    },
  ];
  if (multiContext) {
    items.push({
      key: "delete",
      label: `删除 ${transferContextMenu.selectedCount} 项`,
      icon: trashIcon,
      danger: true,
      disabled: !canDeleteContextNodes(),
    });
    return items;
  }
  items.push(
    {
      key: "edit",
      label: sftpStore.getFileEditMenuLabel(node),
      icon: editIcon,
      disabled: !canEditContextNode(),
    },
    {
      key: "rename",
      label: "重命名",
      icon: editIcon,
      disabled: !canRenameContextNode(),
    },
    {
      key: "delete",
      label: "删除",
      icon: trashIcon,
      danger: true,
      disabled: !canDeleteContextNodes(),
    },
  );
  return items;
});
const footerText = computed(
  () =>
    `左侧已选 ${leftSelectedNodes.value.length} 项，右侧已选 ${rightSelectedNodes.value.length} 项`,
);

function getPaneByKey(paneKey: TransferPaneKey): TransferPaneState {
  return paneKey === "left" ? leftPane : rightPane;
}
function getOppositePaneKey(paneKey: TransferPaneKey): TransferPaneKey {
  return paneKey === "left" ? "right" : "left";
}
function getPaneLabel(paneKey: TransferPaneKey): string {
  return paneKey === "left" ? "左侧" : "右侧";
}
function getSelectedNodes(pane: TransferPaneState): RemoteFileNode[] {
  return pane.nodes.filter((node) => pane.selectedPaths.has(node.path));
}
function isRemoteNodeDeleting(
  pane: TransferPaneState,
  node: RemoteFileNode,
): boolean {
  return pane.deletingPaths.has(node.path);
}
function getPaneRenamingPath(paneKey: TransferPaneKey): string {
  return renaming.value?.paneKey === paneKey ? renaming.value.path : "";
}
function getPaneRenamingValue(paneKey: TransferPaneKey): string {
  return renaming.value?.paneKey === paneKey ? renaming.value.value : "";
}
function updatePaneRenameValue(paneKey: TransferPaneKey, value: string): void {
  if (renaming.value?.paneKey === paneKey) {
    renaming.value.value = value;
  }
}
function selectAllInPane(pane: TransferPaneState): void {
  const visibleNodes = getVisibleNodes(pane);
  const nextSelected = new Set<string>();

  for (const node of visibleNodes) {
    if (node.isVirtualParent || isRemoteNodeDeleting(pane, node)) {
      continue;
    }
    nextSelected.add(node.path);
  }
  pane.selectedPaths = nextSelected;
  // 全选后把锚点放到最后一个可选项目，保证后续 Shift 范围选择可连续操作。
  const lastSelectable = [...visibleNodes]
    .reverse()
    .find((node) => !node.isVirtualParent && !isRemoteNodeDeleting(pane, node));
  if (lastSelectable) {
    updateClickAnchor(pane, lastSelectable);
  }
}

function clearPaneSelection(paneKey: TransferPaneKey): void {
  const pane = getPaneByKey(paneKey);

  focusedPane.value = paneKey;
  pane.selectedPaths = new Set<string>();
  pane.lastClickedIndex = -1;
}

function selectPaneNodesByPaths(
  paneKey: TransferPaneKey,
  paths: string[],
): void {
  const pane = getPaneByKey(paneKey);
  const visibleNodes = getVisibleNodes(pane);
  const selectedPaths = new Set(paths);
  let lastClickedIndex = -1;

  focusedPane.value = paneKey;

  for (let index = visibleNodes.length - 1; index >= 0; index--) {
    const node = visibleNodes[index];

    if (node && selectedPaths.has(node.path)) {
      lastClickedIndex = index;
      break;
    }
  }

  pane.selectedPaths = selectedPaths;
  pane.lastClickedIndex = lastClickedIndex;
}

function onTransferKeydown(event: KeyboardEvent): void {
  const isSelectAll = props.isMac
    ? event.metaKey && event.key === "a"
    : event.ctrlKey && event.key === "a";
  if (!isSelectAll) {
    return;
  }
  event.preventDefault();
  selectAllInPane(getPaneByKey(focusedPane.value));
}
function canTransferFromPane(paneKey: TransferPaneKey): boolean {
  const sourcePane = getPaneByKey(paneKey);
  const targetPane = getPaneByKey(getOppositePaneKey(paneKey));

  return Boolean(
    sourcePane.serverId &&
    targetPane.serverId &&
    targetPane.currentPath &&
    getSelectedNodes(sourcePane).length > 0 &&
    !sourcePane.loading &&
    !targetPane.loading,
  );
}
function isContextMultiSelection(): boolean {
  return (
    transferContextMenu.contextNodeSelected &&
    transferContextMenu.selectedCount > 1
  );
}
function canEditContextNode(): boolean {
  const pane = transferContextMenu.paneKey
    ? getPaneByKey(transferContextMenu.paneKey)
    : null;
  const node = transferContextMenu.node;
  return Boolean(
    pane &&
    node &&
    node.type === "file" &&
    !isRemoteNodeDeleting(pane, node) &&
    sftpStore.isEditableTextFile(node),
  );
}
function canRenameContextNode(): boolean {
  const pane = transferContextMenu.paneKey
    ? getPaneByKey(transferContextMenu.paneKey)
    : null;
  const node = transferContextMenu.node;
  return Boolean(pane && node && !isRemoteNodeDeleting(pane, node));
}
function getContextDeleteNodes(): RemoteFileNode[] {
  if (!transferContextMenu.paneKey || !transferContextMenu.node) {
    return [];
  }

  const pane = getPaneByKey(transferContextMenu.paneKey);
  const selectedNodes = getSelectedNodes(pane);
  const nodesToDelete = isContextMultiSelection()
    ? selectedNodes
    : [transferContextMenu.node];

  return nodesToDelete.filter((node) => !isRemoteNodeDeleting(pane, node));
}

function canDeleteContextNodes(): boolean {
  return getContextDeleteNodes().length > 0;
}

function createParentNode(currentPath: string): RemoteFileListNode | null {
  const normalizedPath = currentPath.replace(/\/+/g, "/").replace(/\/$/, "");

  if (!normalizedPath || normalizedPath === "/") {
    return null;
  }

  return {
    path: getRemoteParentPath(currentPath),
    name: "..",
    type: "directory",
    loaded: true,
    isVirtualParent: true,
  };
}

function getVisibleNodes(pane: TransferPaneState): RemoteFileListNode[] {
  const parentNode = createParentNode(pane.currentPath);

  return parentNode ? [parentNode, ...pane.nodes] : pane.nodes;
}

async function closePaneSession(pane: TransferPaneState): Promise<void> {
  if (!window.orbitSSH?.sftp || !pane.tabId) {
    return;
  }

  await window.orbitSSH.sftp.close(pane.tabId).catch(() => undefined);
}

async function loadPaneHome(
  pane: TransferPaneState,
  initialPath = "",
): Promise<void> {
  pane.error = "";
  pane.nodes = [];
  pane.currentPath = "";
  pane.pathInput = "";
  pane.selectedPaths = new Set<string>();
  pane.deletingPaths = new Set<string>();
  pane.lastClickedIndex = -1;
  closeTransferContextMenu();

  if (!pane.serverId) {
    return;
  }

  pane.loading = true;

  try {
    await closePaneSession(pane);
    const result = await window.orbitSSH.sftp.open(pane.tabId, pane.serverId);

    if (initialPath && initialPath !== result.homePath) {
      pane.nodes = await refreshRemoteDirectory(
        window.orbitSSH.sftp,
        pane.tabId,
        initialPath,
      );
      pane.currentPath = initialPath;
      pane.pathInput = initialPath;
      return;
    }

    pane.currentPath = result.homePath;
    pane.pathInput = result.homePath;
    pane.nodes = result.nodes;
  } catch (error) {
    pane.error = error instanceof Error ? error.message : "目录加载失败";
  } finally {
    pane.loading = false;
  }
}

async function refreshPaneDirectory(
  pane: TransferPaneState,
  path = pane.currentPath,
): Promise<void> {
  if (!pane.serverId || !path) {
    return;
  }

  pane.nodes = await refreshRemoteDirectory(
    window.orbitSSH.sftp,
    pane.tabId,
    path,
  );
  pane.currentPath = path;
  pane.pathInput = path;
}

async function openPaneDirectory(
  pane: TransferPaneState,
  path: string,
): Promise<void> {
  const targetPath = path.trim();

  if (!pane.serverId || pane.loading) {
    return;
  }

  if (!targetPath) {
    pane.error = "请输入远程路径";
    pane.pathInput = pane.currentPath;
    return;
  }

  pane.loading = true;
  pane.error = "";
  pane.selectedPaths = new Set<string>();
  pane.lastClickedIndex = -1;
  renaming.value = null;
  closeTransferContextMenu();

  try {
    await refreshPaneDirectory(pane, targetPath);
  } catch (error) {
    pane.pathInput = pane.currentPath;
    pane.error = error instanceof Error ? error.message : "目录读取失败";
  } finally {
    pane.loading = false;
  }
}

async function submitPanePathInput(pane: TransferPaneState): Promise<void> {
  await openPaneDirectory(pane, pane.pathInput);
}

function isMultiSelect(event: MouseEvent): boolean {
  return props.isMac ? event.metaKey : event.ctrlKey;
}
function isRangeSelect(event: MouseEvent): boolean {
  return event.shiftKey;
}

function selectRange(
  pane: TransferPaneState,
  anchorIndex: number,
  currentIndex: number,
  baseSelectedPaths: Set<string>,
): Set<string> {
  const visibleNodes = getVisibleNodes(pane);
  const start = Math.min(anchorIndex, currentIndex);
  const end = Math.max(anchorIndex, currentIndex);
  const nextSelectedPaths = new Set(baseSelectedPaths);

  for (let i = start; i <= end; i++) {
    const n = visibleNodes[i];
    if (n && !n.isVirtualParent && !isRemoteNodeDeleting(pane, n)) {
      nextSelectedPaths.add(n.path);
    }
  }

  return nextSelectedPaths;
}

function updateClickAnchor(
  pane: TransferPaneState,
  node: RemoteFileNode,
): void {
  const visibleNodes = getVisibleNodes(pane);
  const clickedIndex = visibleNodes.findIndex((n) => n.path === node.path);

  if (clickedIndex !== -1) {
    pane.lastClickedIndex = clickedIndex;
  }
}

function selectPaneNode(
  event: MouseEvent,
  paneKey: TransferPaneKey,
  node: RemoteFileListNode,
): void {
  const pane = getPaneByKey(paneKey);
  focusedPane.value = paneKey;
  closeTransferContextMenu();

  if (node.isVirtualParent || isRemoteNodeDeleting(pane, node)) {
    return;
  }

  const visibleNodes = getVisibleNodes(pane);
  const currentIndex = visibleNodes.findIndex((n) => n.path === node.path);

  if (currentIndex === -1) {
    return;
  }

  // Shift + 点击：按当前面板的可见顺序批量选择，不再限制文件类型。
  if (isRangeSelect(event) && pane.lastClickedIndex >= 0) {
    event.preventDefault();
    const baseSelectedPaths = isMultiSelect(event)
      ? new Set(pane.selectedPaths)
      : new Set<string>();

    pane.selectedPaths = selectRange(
      pane,
      pane.lastClickedIndex,
      currentIndex,
      baseSelectedPaths,
    );
    return;
  }

  updateClickAnchor(pane, node);

  const nextSelectedPaths = isMultiSelect(event)
    ? new Set(pane.selectedPaths)
    : new Set<string>();

  if (pane.selectedPaths.has(node.path)) {
    nextSelectedPaths.delete(node.path);
  } else {
    nextSelectedPaths.add(node.path);
  }

  pane.selectedPaths = nextSelectedPaths;
}

async function openNodeByDoubleClick(
  pane: TransferPaneState,
  node: RemoteFileNode,
): Promise<void> {
  if (node.type !== "directory" || isRemoteNodeDeleting(pane, node)) {
    return;
  }

  await openPaneDirectory(pane, node.path);
}

function getNodesByPaths(
  pane: TransferPaneState,
  paths: Set<string>,
): RemoteFileNode[] {
  return pane.nodes.filter((node) => paths.has(node.path));
}

function getDragMoveNodes(
  pane: TransferPaneState,
  node: RemoteFileListNode,
): RemoteFileNode[] {
  if (node.isVirtualParent || isRemoteNodeDeleting(pane, node)) {
    return [];
  }

  const selectedNodes = getSelectedNodes(pane);
  const nodes = pane.selectedPaths.has(node.path) && selectedNodes.length > 0
    ? selectedNodes
    : [node];

  return nodes.filter((item) => !isRemoteNodeDeleting(pane, item));
}

function clearTransferDrag(clearSource = true): void {
  if (clearSource) {
    transferDrag.paneKey = null;
    transferDrag.sourcePaths = new Set<string>();
  }
  transferDrag.targetPath = "";
}

function startTransferDrag(
  event: DragEvent,
  paneKey: TransferPaneKey,
  node: RemoteFileListNode,
): void {
  const pane = getPaneByKey(paneKey);
  const nodes = getDragMoveNodes(pane, node);

  if (nodes.length === 0) {
    event.preventDefault();
    return;
  }

  transferDrag.paneKey = paneKey;
  transferDrag.sourcePaths = new Set(nodes.map((item) => item.path));
  transferDrag.targetPath = "";
  event.dataTransfer?.setData("text/plain", node.path);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
  }
}

function updateTransferDragTarget(
  paneKey: TransferPaneKey,
  targetNode: RemoteFileNode,
): boolean {
  if (transferDrag.paneKey !== paneKey) {
    transferDrag.targetPath = "";
    return false;
  }

  const pane = getPaneByKey(paneKey);
  const sourceNodes = getNodesByPaths(pane, transferDrag.sourcePaths);
  const canMove = canMoveRemoteNodesToDirectory(sourceNodes, targetNode);

  transferDrag.targetPath = canMove ? targetNode.path : "";
  return canMove;
}

function dragOverTransferNode(
  event: DragEvent,
  paneKey: TransferPaneKey,
  node: RemoteFileNode,
): void {
  if (node.type !== "directory") {
    clearTransferDrag(false);
    return;
  }

  if (!updateTransferDragTarget(paneKey, node)) {
    event.dataTransfer && (event.dataTransfer.dropEffect = "none");
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

function dragLeaveTransferNode(event: DragEvent, node: RemoteFileNode): void {
  const nextTarget = event.relatedTarget;
  const currentTarget = event.currentTarget;

  if (
    currentTarget instanceof HTMLElement &&
    nextTarget instanceof Node &&
    currentTarget.contains(nextTarget)
  ) {
    return;
  }

  if (transferDrag.targetPath === node.path) {
    clearTransferDrag(false);
  }
}

async function dropTransferNode(
  event: DragEvent,
  paneKey: TransferPaneKey,
  targetNode: RemoteFileNode,
): Promise<void> {
  event.preventDefault();

  if (targetNode.type !== "directory" || transferDrag.paneKey !== paneKey) {
    clearTransferDrag();
    return;
  }

  const pane = getPaneByKey(paneKey);
  const sourceNodes = getNodesByPaths(pane, transferDrag.sourcePaths);

  if (!canMoveRemoteNodesToDirectory(sourceNodes, targetNode)) {
    clearTransferDrag();
    return;
  }

  const confirmed = await requestTransferConfirm({
    title: "确认移动",
    message: getRemoteMoveConfirmMessage(sourceNodes, targetNode),
    confirmLabel: "移动",
    danger: false,
  });

  if (!confirmed) {
    clearTransferDrag();
    return;
  }

  const { firstError } = await moveRemoteNodesToDirectory(
    window.orbitSSH.sftp,
    pane.tabId,
    sourceNodes,
    targetNode,
  );

  for (const node of sourceNodes) {
    delete sftpStore.fileTextProbeStates[node.path];
  }

  try {
    await refreshPaneDirectory(pane, pane.currentPath);
    pane.selectedPaths = new Set<string>();
    pane.lastClickedIndex = -1;
    pane.error = firstError;
  } catch (error) {
    pane.error =
      firstError ||
      (error instanceof Error ? error.message : "移动后刷新目录失败");
  } finally {
    clearTransferDrag();
  }
}

function resolveTransferMenuPlacement(
  event: MouseEvent,
  itemCount: number,
): { x: number; y: number } {
  const dialogElement = (event.currentTarget as HTMLElement | null)?.closest(
    ".app-dialog",
  );
  const rect = dialogElement?.getBoundingClientRect();

  if (!rect) {
    return { x: event.clientX, y: event.clientY };
  }

  return resolveLocalMenuPlacement(
    {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    },
    {
      width: rect.width,
      height: rect.height,
    },
    itemCount,
  );
}

function setContextMenuState(
  paneKey: TransferPaneKey,
  node: RemoteFileNode | null,
): void {
  const pane = getPaneByKey(paneKey);

  focusedPane.value = paneKey;
  transferContextMenu.paneKey = paneKey;
  transferContextMenu.node = node;
  transferContextMenu.selectedCount = pane.selectedPaths.size;
  transferContextMenu.contextNodeSelected = Boolean(
    node && pane.selectedPaths.has(node.path),
  );
}

function openBlankTransferContextMenu(
  event: MouseEvent,
  paneKey: TransferPaneKey,
): void {
  event.preventDefault();
  event.stopPropagation();
  setContextMenuState(paneKey, null);

  const placement = resolveTransferMenuPlacement(
    event,
    transferMenuItems.value.length,
  );
  transferContextMenu.open = true;
  transferContextMenu.x = placement.x;
  transferContextMenu.y = placement.y;
}

function openTransferContextMenu(
  event: MouseEvent,
  paneKey: TransferPaneKey,
  node: RemoteFileListNode,
): void {
  event.preventDefault();
  event.stopPropagation();

  if (node.isVirtualParent) {
    openBlankTransferContextMenu(event, paneKey);
    return;
  }

  setContextMenuState(paneKey, node);

  if (node.type === "file") {
    void sftpStore.probeFileTextSupport(getPaneByKey(paneKey).tabId, node);
  }

  const placement = resolveTransferMenuPlacement(
    event,
    transferMenuItems.value.length,
  );
  transferContextMenu.open = true;
  transferContextMenu.x = placement.x;
  transferContextMenu.y = placement.y;
}

function closeTransferContextMenu(): void {
  transferContextMenu.open = false;
  transferContextMenu.paneKey = null;
  transferContextMenu.node = null;
  transferContextMenu.selectedCount = 0;
  transferContextMenu.contextNodeSelected = false;
}

async function selectTransferMenuItem(item: ContextMenuItem): Promise<void> {
  if (!transferContextMenu.paneKey) {
    return;
  }

  const paneKey = transferContextMenu.paneKey;

  if (item.key === "transfer-to-other") {
    closeTransferContextMenu();
    await submitTransferFromPane(paneKey);
  } else if (item.key === "edit") {
    await editContextNode(paneKey);
  } else if (item.key === "rename") {
    startContextRename(paneKey);
  } else if (item.key === "delete") {
    await deleteContextNodes(paneKey);
  }
}

async function submitTransferFromPane(paneKey: TransferPaneKey): Promise<void> {
  if (!canTransferFromPane(paneKey)) {
    return;
  }

  const sourcePane = getPaneByKey(paneKey);
  const targetPane = getPaneByKey(getOppositePaneKey(paneKey));
  const sources: SftpRemoteTransferSource[] = getSelectedNodes(sourcePane).map(
    (node) => ({
      path: node.path,
      name: node.name,
      type: node.type,
      size: node.size,
    }),
  );

  try {
    if (!window.orbitSSH.sftp.remoteTransfer) {
      throw new Error("当前窗口未加载文件传输能力，请重启应用后重试");
    }

    const result = await window.orbitSSH.sftp.remoteTransfer({
      sourceServerId: sourcePane.serverId,
      targetServerId: targetPane.serverId,
      sources,
      targetDirectoryPath: targetPane.currentPath,
    });
    if (result.taskId) {
      pendingTransferRefreshes.set(result.taskId, {
        targetPaneKey: getOppositePaneKey(paneKey),
        targetDirectoryPath: targetPane.currentPath,
      });
    }
    leftPane.selectedPaths = new Set<string>();
    rightPane.selectedPaths = new Set<string>();
  } catch (error) {
    targetPane.error =
      error instanceof Error ? error.message : "传输任务创建失败";
  }
}

async function handleRemoteTransferProgress(
  event: SftpRemoteTransferProgressEvent,
): Promise<void> {
  if (event.status !== "completed") {
    return;
  }

  const refreshState = pendingTransferRefreshes.get(event.taskId);

  if (!refreshState) {
    return;
  }

  pendingTransferRefreshes.delete(event.taskId);

  const targetPane = getPaneByKey(refreshState.targetPaneKey);
  const refreshes: Promise<void>[] = [];

  if (targetPane.currentPath === refreshState.targetDirectoryPath) {
    refreshes.push(refreshPaneDirectory(targetPane).catch((error) => {
      targetPane.error =
        error instanceof Error ? error.message : "刷新目标目录失败";
    }));
  }

  await Promise.all(refreshes);
}

async function editContextNode(paneKey: TransferPaneKey): Promise<void> {
  const pane = getPaneByKey(paneKey);
  const node = transferContextMenu.node;

  if (!node || node.type !== "file" || isRemoteNodeDeleting(pane, node)) {
    return;
  }

  closeTransferContextMenu();
  const editable = await sftpStore.ensureEditableTextFile(pane.tabId, node);
  if (editable) {
    await fileEditorStore.openRemoteFileEditor(pane.tabId, node);
  }
}

function startContextRename(paneKey: TransferPaneKey): void {
  const pane = getPaneByKey(paneKey);
  const node = transferContextMenu.node;

  if (!node || isRemoteNodeDeleting(pane, node)) {
    return;
  }

  closeTransferContextMenu();
  renaming.value = {
    paneKey,
    path: node.path,
    value: node.name,
  };
}

async function commitRename(): Promise<void> {
  const state = renaming.value;

  if (!state) {
    return;
  }

  const pane = getPaneByKey(state.paneKey);
  const nextName = state.value.trim();
  renaming.value = null;

  if (!nextName) {
    return;
  }

  try {
    const result = await renameRemoteNodeByName(
      window.orbitSSH.sftp,
      pane.tabId,
      state.path,
      nextName,
    );

    if (result.renamed) {
      delete sftpStore.fileTextProbeStates[state.path];
    }

    await refreshPaneDirectory(pane, pane.currentPath);
  } catch (error) {
    pane.error = error instanceof Error ? error.message : "重命名失败";
  }
}

function cancelRename(): void {
  renaming.value = null;
}

function requestTransferConfirm(input: {
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

  return new Promise((resolve) => {
    resolveDeleteConfirm = resolve;
  });
}

function requestDeleteConfirm(message: string): Promise<boolean> {
  return requestTransferConfirm({
    title: "确认删除",
    message,
    confirmLabel: "删除",
    danger: true,
  });
}

function closeDeleteConfirm(confirmed: boolean): void {
  deleteConfirmDialog.open = false;
  deleteConfirmDialog.title = "确认删除";
  deleteConfirmDialog.message = "";
  deleteConfirmDialog.confirmLabel = "删除";
  deleteConfirmDialog.danger = true;
  resolveDeleteConfirm?.(confirmed);
  resolveDeleteConfirm = null;
}

async function deleteContextNodes(paneKey: TransferPaneKey): Promise<void> {
  const pane = getPaneByKey(paneKey);
  const nodesToDelete = getContextDeleteNodes();

  if (nodesToDelete.length === 0) {
    return;
  }

  const confirmed = await requestDeleteConfirm(
    getRemoteDeleteConfirmMessage(nodesToDelete),
  );
  if (!confirmed) {
    closeTransferContextMenu();
    return;
  }

  closeTransferContextMenu();

  const deletingPaths = new Set(pane.deletingPaths);
  for (const node of nodesToDelete) {
    deletingPaths.add(node.path);
  }
  pane.deletingPaths = deletingPaths;
  pane.selectedPaths = new Set<string>();
  pane.lastClickedIndex = -1;
  pane.error = "";

  const { firstError } = await deleteRemoteNodes(
    window.orbitSSH.sftp,
    pane.tabId,
    nodesToDelete,
    {
      onDeleted: (node) => {
        delete sftpStore.fileTextProbeStates[node.path];
        if (fileEditorStore.fileEditor.path === node.path) {
          fileEditorStore.closeFileEditor();
        }
      },
    },
  );

  try {
    await refreshPaneDirectory(pane, pane.currentPath);
    pane.error = firstError;
  } catch (error) {
    pane.error =
      firstError ||
      (error instanceof Error ? error.message : "删除后刷新目录失败");
  } finally {
    const nextDeletingPaths = new Set(pane.deletingPaths);
    for (const node of nodesToDelete) {
      nextDeletingPaths.delete(node.path);
    }
    pane.deletingPaths = nextDeletingPaths;
  }
}

function getServerLabel(serverId: string): string {
  const server = props.servers.find((item) => item.id === serverId);

  if (!server) {
    return "请选择连接";
  }

  return `${server.name} · ${server.username}@${server.host}`;
}

async function resetPaneSelection(pane: TransferPaneState): Promise<void> {
  await closePaneSession(pane);
  pane.serverId = "";
  pane.currentPath = "";
  pane.pathInput = "";
  pane.nodes = [];
  pane.selectedPaths = new Set<string>();
  pane.deletingPaths = new Set<string>();
  pane.lastClickedIndex = -1;
  pane.loading = false;
  pane.error = "";
}

let leftInitialPath = "";

watch(
  () => props.servers,
  (servers) => {
    if (!leftPane.serverId) {
      const active = props.activeSource;

      if (
        active?.serverId &&
        servers.some((item) => item.id === active.serverId)
      ) {
        leftInitialPath = active.currentPath ?? "";
        leftPane.serverId = active.serverId;
      } else if (servers[0]) {
        leftPane.serverId = servers[0].id;
      }
    }
  },
  { immediate: true },
);

watch(
  () => leftPane.serverId,
  () => {
    const initialPath = leftInitialPath;
    leftInitialPath = "";
    void loadPaneHome(leftPane, initialPath);
  },
  { immediate: true },
);

watch(
  () => rightPane.serverId,
  () => {
    void loadPaneHome(rightPane);
  },
  { immediate: true },
);

onMounted(() => {
  removeRemoteTransferProgressListener =
    window.orbitSSH?.sftp.onRemoteTransferProgress?.((event) => {
      void handleRemoteTransferProgress(event);
    });
});

onUnmounted(() => {
  resolveDeleteConfirm?.(false);
  removeRemoteTransferProgressListener?.();
  removeRemoteTransferProgressListener = undefined;
  pendingTransferRefreshes.clear();
  void closePaneSession(leftPane);
  void closePaneSession(rightPane);
});
</script>

<template>
  <AppDialog title="文件传输" width="large" @close="emit('close')">
    <div class="data-transfer-dialog" @keydown="onTransferKeydown">
      <section class="transfer-pane" @click="focusedPane = 'left'">
        <header class="transfer-pane-header">
          <strong>左侧</strong>
          <AppSelect
            v-model="leftPane.serverId"
            title="左侧服务器"
            ariaLabel="左侧服务器"
            placeholder="请选择连接"
            :options="leftServerOptions"
          />
        </header>
        <input
          v-model="leftPane.pathInput"
          class="transfer-path-input"
          type="text"
          spellcheck="false"
          aria-label="左侧远程路径"
          :disabled="!leftPane.serverId || leftPane.loading"
          :title="leftPane.currentPath || getServerLabel(leftPane.serverId)"
          :placeholder="getServerLabel(leftPane.serverId)"
          @keydown.enter.prevent="submitPanePathInput(leftPane)"
          @blur="leftPane.pathInput = leftPane.currentPath"
        />
        <div
          class="transfer-file-list"
          @contextmenu="openBlankTransferContextMenu($event, 'left')"
        >
          <div v-if="leftPane.loading" class="transfer-state">加载中...</div>
          <div v-else-if="leftPane.error" class="transfer-state error">
            {{ leftPane.error }}
          </div>
          <RemoteFileList
            v-else
            :nodes="getVisibleNodes(leftPane) as RemoteFileListNode[]"
            list-class="transfer-file-list-inner"
            row-class="transfer-file-row"
            :selected-paths="leftPane.selectedPaths"
            :deleting-paths="leftPane.deletingPaths"
            :drop-target-path="transferDrag.targetPath"
            :renaming-path="getPaneRenamingPath('left')"
            :renaming-value="getPaneRenamingValue('left')"
            empty-text="当前目录为空"
            @select-node="(event, node) => selectPaneNode(event, 'left', node)"
            @clear-selection="clearPaneSelection('left')"
            @marquee-select="selectPaneNodesByPaths('left', $event)"
            @open-context-menu="
              (event, node) => openTransferContextMenu(event, 'left', node)
            "
            @open-node="openNodeByDoubleClick(leftPane, $event)"
            @drag-start-node="
              (event, node) => startTransferDrag(event, 'left', node)
            "
            @drag-over-node="
              (event, node) => dragOverTransferNode(event, 'left', node)
            "
            @drag-leave-node="dragLeaveTransferNode"
            @drop-node="(event, node) => dropTransferNode(event, 'left', node)"
            @drag-end-node="clearTransferDrag()"
            @update-rename-value="updatePaneRenameValue('left', $event)"
            @commit-rename="commitRename"
            @cancel-rename="cancelRename"
          />
        </div>
      </section>

      <section class="transfer-pane" @click="focusedPane = 'right'">
        <header class="transfer-pane-header">
          <strong>右侧</strong>
          <AppSelect
            v-model="rightPane.serverId"
            title="右侧服务器"
            ariaLabel="右侧服务器"
            placeholder="请选择连接"
            :options="rightServerOptions"
          />
        </header>
        <input
          v-model="rightPane.pathInput"
          class="transfer-path-input"
          type="text"
          spellcheck="false"
          aria-label="右侧远程路径"
          :disabled="!rightPane.serverId || rightPane.loading"
          :title="rightPane.currentPath || getServerLabel(rightPane.serverId)"
          :placeholder="getServerLabel(rightPane.serverId)"
          @keydown.enter.prevent="submitPanePathInput(rightPane)"
          @blur="rightPane.pathInput = rightPane.currentPath"
        />
        <div
          class="transfer-file-list"
          @contextmenu="openBlankTransferContextMenu($event, 'right')"
        >
          <div v-if="rightPane.loading" class="transfer-state">加载中...</div>
          <div v-else-if="rightPane.error" class="transfer-state error">
            {{ rightPane.error }}
          </div>
          <RemoteFileList
            v-else
            :nodes="getVisibleNodes(rightPane) as RemoteFileListNode[]"
            list-class="transfer-file-list-inner"
            row-class="transfer-file-row"
            :selected-paths="rightPane.selectedPaths"
            :deleting-paths="rightPane.deletingPaths"
            :drop-target-path="transferDrag.targetPath"
            :renaming-path="getPaneRenamingPath('right')"
            :renaming-value="getPaneRenamingValue('right')"
            empty-text="当前目录为空"
            @select-node="(event, node) => selectPaneNode(event, 'right', node)"
            @clear-selection="clearPaneSelection('right')"
            @marquee-select="selectPaneNodesByPaths('right', $event)"
            @open-context-menu="
              (event, node) => openTransferContextMenu(event, 'right', node)
            "
            @open-node="openNodeByDoubleClick(rightPane, $event)"
            @drag-start-node="
              (event, node) => startTransferDrag(event, 'right', node)
            "
            @drag-over-node="
              (event, node) => dragOverTransferNode(event, 'right', node)
            "
            @drag-leave-node="dragLeaveTransferNode"
            @drop-node="(event, node) => dropTransferNode(event, 'right', node)"
            @drag-end-node="clearTransferDrag()"
            @update-rename-value="updatePaneRenameValue('right', $event)"
            @commit-rename="commitRename"
            @cancel-rename="cancelRename"
          />
        </div>
      </section>
    </div>

    <footer class="data-transfer-footer">
      <span>{{ footerText }}</span>
    </footer>

    <ContextMenu
      class="data-transfer-context-menu"
      :menu="transferContextMenu"
      :items="transferMenuItems"
      @select="selectTransferMenuItem"
      @close="closeTransferContextMenu"
    />

    <DeleteConfirmDialog
      :open="deleteConfirmDialog.open"
      :title="deleteConfirmDialog.title"
      :message="deleteConfirmDialog.message"
      :confirm-label="deleteConfirmDialog.confirmLabel"
      :danger="deleteConfirmDialog.danger"
      @cancel="closeDeleteConfirm(false)"
      @confirm="closeDeleteConfirm(true)"
    />
  </AppDialog>
</template>
