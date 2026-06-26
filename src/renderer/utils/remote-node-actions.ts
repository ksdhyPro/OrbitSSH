import type { RemoteFileNode } from "../../shared/sftp";
import { getRemoteParentPath } from "./path";

type SftpApi = Window["orbitSSH"]["sftp"];

export interface DeleteRemoteNodesCallbacks {
  onDeleted?: (node: RemoteFileNode) => void;
  onError?: (node: RemoteFileNode, error: unknown) => void;
}

export interface DeleteRemoteNodesResult {
  deletedNodes: RemoteFileNode[];
  firstError: string;
}

/**
 * 根据旧路径和新文件名生成远程重命名目标路径。
 * 只接收文件名，不允许调用方传入带尾部斜杠的路径片段。
 */
export function buildRemoteRenamePath(path: string, nextName: string): string {
  const parentPath = getRemoteParentPath(path);
  const normalizedName = nextName.trim().replace(/\/+$/g, "");

  return parentPath === "/" ? `/${normalizedName}` : `${parentPath}/${normalizedName}`;
}

/**
 * 生成删除确认文案，保持主 SFTP 与数据传输弹窗的删除提示一致。
 */
export function getRemoteDeleteConfirmMessage(nodes: RemoteFileNode[]): string {
  if (nodes.length === 1) {
    const node = nodes[0];

    return node.type === "directory"
      ? `删除文件夹 '${node.name}'？将同时删除其中内容。`
      : `删除文件 '${node.name}'？`;
  }

  return `删除选中的 ${nodes.length} 项？`;
}

/**
 * 删除时深层路径优先，避免先删父目录导致子路径操作报错。
 */
export function sortRemoteNodesForDelete(nodes: RemoteFileNode[]): RemoteFileNode[] {
  return [...nodes].sort(
    (a, b) => (b.path.match(/\//g)?.length ?? 0) - (a.path.match(/\//g)?.length ?? 0),
  );
}

/**
 * 执行远程节点删除，返回首个错误并继续删除后续节点。
 */
export async function deleteRemoteNodes(
  sftp: SftpApi,
  tabId: string,
  nodes: RemoteFileNode[],
  callbacks: DeleteRemoteNodesCallbacks = {},
): Promise<DeleteRemoteNodesResult> {
  const deletedNodes: RemoteFileNode[] = [];
  let firstError = "";

  for (const node of sortRemoteNodesForDelete(nodes)) {
    try {
      await sftp.delete({
        tabId,
        path: node.path,
        type: node.type,
      });
      deletedNodes.push(node);
      callbacks.onDeleted?.(node);
    } catch (error) {
      firstError =
        firstError ||
        (error instanceof Error ? error.message : `删除'${node.name}'失败`);
      callbacks.onError?.(node, error);
    }
  }

  return { deletedNodes, firstError };
}

/**
 * 刷新远程目录并返回最新子节点。
 */
export async function refreshRemoteDirectory(
  sftp: SftpApi,
  tabId: string,
  path: string,
): Promise<RemoteFileNode[]> {
  return sftp.list({ tabId, path });
}

/**
 * 按文件名执行远程重命名，返回父路径和新路径，方便调用方刷新目录与清理缓存。
 */
export async function renameRemoteNodeByName(
  sftp: SftpApi,
  tabId: string,
  path: string,
  nextName: string,
): Promise<{ parentPath: string; newPath: string; renamed: boolean }> {
  const parentPath = getRemoteParentPath(path);
  const newPath = buildRemoteRenamePath(path, nextName);

  if (newPath === path) {
    return { parentPath, newPath, renamed: false };
  }

  await sftp.rename({ tabId, path, newPath });
  return { parentPath, newPath, renamed: true };
}
