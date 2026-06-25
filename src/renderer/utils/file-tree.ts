import type { RemoteFileNode } from "../../shared/sftp";
import type { VisibleRemoteFileNode } from "../types/sftp";

export function flattenRemoteTree(
  root: RemoteFileNode,
  expandedPaths: Set<string>,
): VisibleRemoteFileNode[] {
  return flattenNode(root, expandedPaths, 0);
}

function flattenNode(
  node: RemoteFileNode,
  expandedPaths: Set<string>,
  level: number,
): VisibleRemoteFileNode[] {
  const currentNode: VisibleRemoteFileNode = {
    ...node,
    level,
  };

  if (
    node.type !== "directory" ||
    !expandedPaths.has(node.path) ||
    !node.children
  ) {
    return [currentNode];
  }

  return [
    currentNode,
    ...node.children.flatMap(childNode =>
      flattenNode(childNode, expandedPaths, level + 1),
    ),
  ];
}

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
