import { computed, onUnmounted, ref, type ComputedRef, type Ref } from "vue";

export const UNGROUPED_DROP_TARGET = "__ungrouped__";

interface GroupedItem {
  id: string;
  groupId?: string;
}

interface GroupedDragState<T extends GroupedItem> {
  draggedId: Ref<string | null>;
  draggedItem: ComputedRef<T | undefined>;
  hoveredTargetId: Ref<string | null>;
  recentlyDroppedTargetId: Ref<string | null>;
  showUngroupedDock: ComputedRef<boolean>;
  startDrag: (event: DragEvent, item: T) => void;
  enterDropTarget: (
    event: DragEvent,
    groupId?: string,
    onDwell?: () => void,
  ) => void;
  leaveDropTarget: (event: DragEvent, groupId?: string) => void;
  finishDrag: (groupId?: string) => Promise<void>;
  cancelDrag: () => void;
  isDropAvailable: (groupId?: string) => boolean;
  isDropHovered: (groupId?: string) => boolean;
  isRecentlyDropped: (groupId?: string) => boolean;
}

/**
 * 统一服务器与快捷指令的分组拖拽状态，确保同一时间只有真实悬停目标高亮。
 */
export function useGroupedDrag<T extends GroupedItem>(
  getItems: () => T[],
  moveItem: (item: T, groupId?: string) => Promise<boolean | void> | boolean | void,
): GroupedDragState<T> {
  const draggedId = ref<string | null>(null);
  const hoveredTargetId = ref<string | null>(null);
  const recentlyDroppedTargetId = ref<string | null>(null);
  const draggedItem = computed(() =>
    getItems().find(item => item.id === draggedId.value),
  );
  const showUngroupedDock = computed(() => Boolean(draggedItem.value?.groupId));
  let dwellTimer = 0;
  let recentDropTimer = 0;

  function targetId(groupId?: string): string {
    return groupId ?? UNGROUPED_DROP_TARGET;
  }

  function clearDwellTimer(): void {
    if (!dwellTimer) return;
    window.clearTimeout(dwellTimer);
    dwellTimer = 0;
  }

  function isDropAvailable(groupId?: string): boolean {
    return Boolean(draggedItem.value && draggedItem.value.groupId !== groupId);
  }

  function startDrag(event: DragEvent, item: T): void {
    draggedId.value = item.id;
    event.dataTransfer?.setData("text/plain", item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function enterDropTarget(
    event: DragEvent,
    groupId?: string,
    onDwell?: () => void,
  ): void {
    if (!isDropAvailable(groupId)) return;
    hoveredTargetId.value = targetId(groupId);
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

    clearDwellTimer();
    if (onDwell) dwellTimer = window.setTimeout(onDwell, 500);
  }

  function leaveDropTarget(event: DragEvent, groupId?: string): void {
    const container = event.currentTarget;
    const nextTarget = event.relatedTarget;
    if (
      container instanceof HTMLElement &&
      nextTarget instanceof Node &&
      container.contains(nextTarget)
    )
      return;

    clearDwellTimer();
    if (hoveredTargetId.value === targetId(groupId))
      hoveredTargetId.value = null;
  }

  async function finishDrag(groupId?: string): Promise<void> {
    const item = draggedItem.value;
    const canMove = isDropAvailable(groupId);
    cancelDrag();
    if (!item || !canMove) return;

    const moved = await moveItem(item, groupId);
    if (moved === false) return;
    recentlyDroppedTargetId.value = targetId(groupId);
    if (recentDropTimer) window.clearTimeout(recentDropTimer);
    recentDropTimer = window.setTimeout(() => {
      recentlyDroppedTargetId.value = null;
      recentDropTimer = 0;
    }, 520);
  }

  function cancelDrag(): void {
    clearDwellTimer();
    draggedId.value = null;
    hoveredTargetId.value = null;
  }

  function isDropHovered(groupId?: string): boolean {
    return hoveredTargetId.value === targetId(groupId);
  }

  function isRecentlyDropped(groupId?: string): boolean {
    return recentlyDroppedTargetId.value === targetId(groupId);
  }

  onUnmounted(() => {
    clearDwellTimer();
    if (recentDropTimer) window.clearTimeout(recentDropTimer);
  });

  return {
    draggedId,
    draggedItem,
    hoveredTargetId,
    recentlyDroppedTargetId,
    showUngroupedDock,
    startDrag,
    enterDropTarget,
    leaveDropTarget,
    finishDrag,
    cancelDrag,
    isDropAvailable,
    isDropHovered,
    isRecentlyDropped,
  };
}
