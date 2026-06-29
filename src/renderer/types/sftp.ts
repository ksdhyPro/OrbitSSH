import type { RemoteFileNode, SftpProbeTextResult } from "../../shared/sftp";

export interface VisibleRemoteFileNode extends RemoteFileNode {
  level: number;
  isVirtualParent?: boolean;
}

export interface SftpTreeState {
  homePath: string;
  root: RemoteFileNode;
  /** SFTP 会话是否已断开，用于清空文件列表并提示用户当前状态。 */
  disconnected: boolean;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  deletingPaths: Set<string>;
  selectedPaths: Set<string>;
  lastClickedIndex: number;
  error: string;
}

export interface FileContextMenuState {
  open: boolean;
  x: number;
  y: number;
  node: RemoteFileNode | null;
  selectedCount: number;
  /** 右键目标是否属于当前选区，用于区分批量操作和单个右键目标操作。 */
  contextNodeSelected: boolean;
}

export interface BlankContextMenuState {
  open: boolean;
  x: number;
  y: number;
}

export interface RenamingState {
  tabId: string;
  /** 待重命名节点的当前完整路径（旧路径） */
  path: string;
  /** 输入框中的新名称 */
  value: string;
}

export interface FileTextProbeState {
  status: "checking" | "text" | "unsupported" | "error";
  reason?: SftpProbeTextResult["reason"];
}

export interface ImagePreviewState {
  tabId: string;
  path: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  loading: boolean;
  error: string;
}
