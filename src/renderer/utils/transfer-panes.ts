import type { ServerConfig } from "../../shared/server";
import type { RemoteFileNode } from "../../shared/sftp";
import type { ContextMenuItem } from "../types/context-menu";
import { compareByModifyTime, type ModifyTimeSortDirection } from "./file-sort";
import { getRemoteParentPath } from "./path";
import { buildRemoteChildPath } from "./remote-node-actions";

/** 文件传输弹窗左右两侧的列表状态与纯计算逻辑，组件只负责异步操作和交互编排。 */

export type TransferPaneKey = "left" | "right";

export const LOCAL_ENDPOINT_ID = "__local__";

export interface TransferPaneState {
  tabId: string;
  serverId: string;
  currentPath: string;
  parentPath: string;
  pathInput: string;
  nodes: RemoteFileNode[];
  selectedPaths: Set<string>;
  deletingPaths: Set<string>;
  lastClickedIndex: number;
  modifyTimeSortDirection: ModifyTimeSortDirection;
  loading: boolean;
  error: string;
}

/** 列表中的节点；“..” 返回上级目录是虚拟节点。 */
export interface TransferListNode extends RemoteFileNode {
  isVirtualParent?: boolean;
}

export function createTransferPaneState(
  side: TransferPaneKey,
  serverId: string,
): TransferPaneState {
  return {
    tabId: `data-transfer-${side}-${crypto.randomUUID()}`,
    serverId,
    currentPath: "",
    parentPath: "",
    pathInput: "",
    nodes: [],
    selectedPaths: new Set<string>(),
    deletingPaths: new Set<string>(),
    lastClickedIndex: -1,
    modifyTimeSortDirection: "desc",
    loading: false,
    error: "",
  };
}

export function isLocalPane(pane: Pick<TransferPaneState, "serverId">): boolean {
  return pane.serverId === LOCAL_ENDPOINT_ID;
}

export function getOppositePaneKey(paneKey: TransferPaneKey): TransferPaneKey {
  return paneKey === "left" ? "right" : "left";
}

export function getPaneLabel(paneKey: TransferPaneKey): string {
  return paneKey === "left" ? "左侧" : "右侧";
}

/** 左右两侧都可以选择本地或任意已保存服务器。 */
export function buildEndpointOptions(
  servers: Pick<ServerConfig, "id" | "name">[],
): Array<{ value: string; label: string }> {
  return [
    { value: LOCAL_ENDPOINT_ID, label: "本地" },
    ...servers.map(server => ({ value: server.id, label: server.name })),
  ];
}

export function getSelectedNodes(pane: TransferPaneState): RemoteFileNode[] {
  return pane.nodes.filter(node => pane.selectedPaths.has(node.path));
}

export function isRemoteNodeDeleting(pane: TransferPaneState, node: RemoteFileNode): boolean {
  return pane.deletingPaths.has(node.path);
}

/** 当前目录不是根目录时，在列表顶部提供返回上级目录的“..”。 */
export function createParentNode(pane: TransferPaneState): TransferListNode | null {
  if (isLocalPane(pane)) {
    return pane.parentPath
      ? {
          path: pane.parentPath,
          name: "..",
          type: "directory",
          loaded: true,
          isVirtualParent: true,
        }
      : null;
  }

  const normalizedPath = pane.currentPath.replace(/\/+/g, "/").replace(/\/$/, "");
  if (!normalizedPath || normalizedPath === "/") {
    return null;
  }

  return {
    path: getRemoteParentPath(pane.currentPath),
    name: "..",
    type: "directory",
    loaded: true,
    isVirtualParent: true,
  };
}

export function getVisibleNodes(pane: TransferPaneState): TransferListNode[] {
  const parentNode = createParentNode(pane);
  const sortedNodes = [...pane.nodes].sort(compareByModifyTime(pane.modifyTimeSortDirection));
  return parentNode ? [parentNode, ...sortedNodes] : sortedNodes;
}

export function normalizeComparisonPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

/**
 * 判断能否把源列表的已选项目传到目标列表：
 * 两侧不能都是本地；下载到本地只支持文件；同一服务器内不能传到自身或自身子目录。
 */
export function canTransferBetweenPanes(
  sourcePane: TransferPaneState,
  targetPane: TransferPaneState,
): boolean {
  const selectedNodes = getSelectedNodes(sourcePane);
  const hasRemoteEndpoint = !isLocalPane(sourcePane) || !isLocalPane(targetPane);
  const canDownloadToLocal =
    !isLocalPane(targetPane) || selectedNodes.every(node => node.type === "file");
  const hasUnsafeSameServerTarget =
    !isLocalPane(sourcePane) &&
    sourcePane.serverId === targetPane.serverId &&
    selectedNodes.some(node => {
      const sourcePath = normalizeComparisonPath(node.path);
      const targetDirectory = normalizeComparisonPath(targetPane.currentPath);
      const finalTarget = normalizeComparisonPath(
        buildRemoteChildPath(targetPane.currentPath, node.name),
      );
      return (
        finalTarget === sourcePath ||
        (node.type === "directory" &&
          (targetDirectory === sourcePath || targetDirectory.startsWith(`${sourcePath}/`)))
      );
    });

  return Boolean(
    sourcePane.serverId &&
    targetPane.serverId &&
    targetPane.currentPath &&
    selectedNodes.length > 0 &&
    hasRemoteEndpoint &&
    canDownloadToLocal &&
    !hasUnsafeSameServerTarget &&
    !sourcePane.loading &&
    !targetPane.loading,
  );
}

export interface TransferMenuIcons {
  transfer: string;
  download: string;
  edit: string;
  file: string;
  folder: string;
  trash: string;
}

export interface TransferMenuInput {
  targetLabel: string;
  isLocal: boolean;
  /** 右键所在节点；在空白处右键时为空。 */
  node: RemoteFileNode | null;
  selectedCount: number;
  multiSelection: boolean;
  canTransfer: boolean;
  canDelete: boolean;
  canRename: boolean;
  canEdit: boolean;
  canDownload: boolean;
  isPreviewImage: boolean;
  editLabel: string;
  icons: TransferMenuIcons;
}

/** 按右键位置和选择状态生成文件传输右键菜单。 */
export function buildTransferMenuItems(input: TransferMenuInput): ContextMenuItem[] {
  const { icons, node } = input;
  const items: ContextMenuItem[] = [
    {
      key: "transfer-to-other",
      label: `传输到${input.targetLabel}`,
      icon: icons.transfer,
      disabled: !input.canTransfer,
    },
  ];
  if (input.isLocal) return items;

  const deleteItem: ContextMenuItem = {
    key: "delete",
    label: input.multiSelection ? `删除 ${input.selectedCount} 项` : "删除",
    icon: icons.trash,
    danger: true,
    disabled: !input.canDelete,
  };
  if (input.multiSelection) {
    items.push(deleteItem);
    return items;
  }

  const createItems: ContextMenuItem[] =
    !node || input.selectedCount === 0
      ? [
          { key: "new-file", label: "新建文件", icon: icons.file },
          { key: "new-directory", label: "新建文件夹", icon: icons.folder },
        ]
      : [];
  if (!node) {
    items.push(...createItems);
    return items;
  }

  const renameItem: ContextMenuItem = {
    key: "rename",
    label: "重命名",
    icon: icons.edit,
    disabled: !input.canRename,
  };
  if (node.type === "directory") {
    items.push(
      ...createItems,
      {
        key: "download",
        label: "下载文件夹",
        icon: icons.download,
        disabled: !input.canDownload,
      },
      renameItem,
      deleteItem,
    );
    return items;
  }

  const primaryItem: ContextMenuItem = input.isPreviewImage
    ? { key: "preview", label: "预览", icon: icons.file }
    : { key: "edit", label: input.editLabel, icon: icons.edit, disabled: !input.canEdit };
  items.push(
    ...createItems,
    primaryItem,
    { key: "download", label: "下载", icon: icons.download, disabled: !input.canDownload },
    renameItem,
    deleteItem,
  );
  return items;
}
