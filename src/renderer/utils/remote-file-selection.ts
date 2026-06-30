import type { RemoteFileNode } from "../../shared/sftp";

export interface SelectableRemoteFileNode extends RemoteFileNode {
  isVirtualParent?: boolean;
}

export interface RemoteFileSelectionState {
  selectedPaths: Set<string>;
  lastClickedIndex: number;
}

type SelectablePredicate<T extends SelectableRemoteFileNode> = (node: T) => boolean;

function defaultSelectable<T extends SelectableRemoteFileNode>(node: T): boolean {
  return !node.isVirtualParent;
}

function isMultiSelectEvent(event: MouseEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

/**
 * 远程文件列表的单击/多选/范围选择规则，主 SFTP 与文件传输面板统一从这里更新选区。
 */
export function selectRemoteFileNode<T extends SelectableRemoteFileNode>(input: {
  current: RemoteFileSelectionState;
  node: T;
  visibleNodes: T[];
  event: MouseEvent;
  isSelectable?: SelectablePredicate<T>;
}): RemoteFileSelectionState | null {
  const isSelectable = input.isSelectable ?? defaultSelectable;

  if (!isSelectable(input.node)) {
    return null;
  }

  const currentIndex = input.visibleNodes.findIndex(
    node => node.path === input.node.path,
  );

  if (currentIndex === -1) {
    return null;
  }

  const isMultiSelect = isMultiSelectEvent(input.event);

  // Shift 范围选择沿用主 SFTP 行为：不带 Ctrl/Meta 时以范围作为新选区。
  if (input.event.shiftKey && input.current.lastClickedIndex >= 0) {
    input.event.preventDefault();

    const start = Math.min(input.current.lastClickedIndex, currentIndex);
    const end = Math.max(input.current.lastClickedIndex, currentIndex);
    const selectedPaths = isMultiSelect
      ? new Set(input.current.selectedPaths)
      : new Set<string>();

    for (let index = start; index <= end; index++) {
      const node = input.visibleNodes[index];

      if (node && isSelectable(node)) {
        selectedPaths.add(node.path);
      }
    }

    return {
      selectedPaths,
      lastClickedIndex: input.current.lastClickedIndex,
    };
  }

  if (isMultiSelect) {
    const selectedPaths = new Set(input.current.selectedPaths);

    if (selectedPaths.has(input.node.path)) {
      selectedPaths.delete(input.node.path);
    } else {
      selectedPaths.add(input.node.path);
    }

    return {
      selectedPaths,
      lastClickedIndex: currentIndex,
    };
  }

  // 普通点击保持主 SFTP 的单选语义：再次点击同一项仍保持选中，不做取消。
  return {
    selectedPaths: new Set<string>([input.node.path]),
    lastClickedIndex: currentIndex,
  };
}

/**
 * 统一全选规则，只选择当前可见且允许交互的真实节点。
 */
export function selectAllRemoteFileNodes<T extends SelectableRemoteFileNode>(
  visibleNodes: T[],
  isSelectable: SelectablePredicate<T> = defaultSelectable,
): RemoteFileSelectionState {
  const selectedPaths = new Set<string>();
  let lastClickedIndex = -1;

  visibleNodes.forEach((node, index) => {
    if (!isSelectable(node)) {
      return;
    }

    selectedPaths.add(node.path);
    lastClickedIndex = index;
  });

  return { selectedPaths, lastClickedIndex };
}

/**
 * 框选结果统一回写选区，同时同步 Shift 范围选择锚点。
 */
export function selectRemoteFileNodesByPaths<T extends SelectableRemoteFileNode>(
  visibleNodes: T[],
  paths: string[],
  isSelectable: SelectablePredicate<T> = defaultSelectable,
): RemoteFileSelectionState {
  const pathSet = new Set(paths);
  const selectedPaths = new Set<string>();
  let lastClickedIndex = -1;

  visibleNodes.forEach((node, index) => {
    if (!pathSet.has(node.path) || !isSelectable(node)) {
      return;
    }

    selectedPaths.add(node.path);
    lastClickedIndex = index;
  });

  return { selectedPaths, lastClickedIndex };
}
