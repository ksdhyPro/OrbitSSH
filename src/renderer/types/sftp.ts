import type { RemoteFileNode, SftpProbeTextResult } from "../../shared/sftp";

export interface VisibleRemoteFileNode extends RemoteFileNode {
  level: number;
  isVirtualParent?: boolean;
}

export interface SftpTreeState {
  homePath: string;
  root: RemoteFileNode;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  deletingPaths: Set<string>;
  error: string;
}

export interface FileContextMenuState {
  open: boolean;
  x: number;
  y: number;
  node: RemoteFileNode | null;
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
