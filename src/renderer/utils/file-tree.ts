import type { RemoteFileNode } from "../../shared/sftp";

export function updateNodeChildren(
  node: RemoteFileNode,
  targetPath: string,
  children: RemoteFileNode[],
): RemoteFileNode {
  if (node.path === targetPath) {
    return {
      ...node,
      children,
      loaded: true,
    };
  }

  if (!node.children) {
    return node;
  }

  return {
    ...node,
    children: node.children.map(childNode =>
      updateNodeChildren(childNode, targetPath, children),
    ),
  };
}
