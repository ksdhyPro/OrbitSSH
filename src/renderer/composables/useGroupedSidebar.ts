import { reactive, ref, type Ref } from "vue";
import type { ContextMenuItem, ContextMenuState } from "../types/context-menu";

interface NamedGroup {
  id: string;
  name: string;
}

/**
 * 侧栏右键菜单：记录当前操作对象及其类型（如条目 / 分组），菜单关闭时一并清空。
 */
export function useContextMenuTarget<T, K extends string>(defaultType: K) {
  const menu = reactive<ContextMenuState>({ open: false, x: 0, y: 0 });
  const menuTarget = ref(null) as Ref<T | null>;
  const menuTargetType = ref(defaultType) as Ref<K>;

  function openMenu(event: MouseEvent, target: T, type: K): void {
    event.stopPropagation();
    menuTarget.value = target;
    menuTargetType.value = type;
    menu.x = event.clientX;
    menu.y = event.clientY;
    menu.open = true;
  }

  function closeMenu(): void {
    menu.open = false;
    menuTarget.value = null;
  }

  return { menu, menuTarget, menuTargetType, openMenu, closeMenu };
}

/** 新建 / 重命名分组弹窗的状态。 */
export function useGroupNameDialog<G extends NamedGroup>() {
  const groupDialog = reactive({
    open: false,
    editing: null as G | null,
    name: "",
  });

  function openGroupDialog(group?: G): void {
    groupDialog.open = true;
    groupDialog.editing = (group ?? null) as typeof groupDialog.editing;
    groupDialog.name = group?.name ?? "";
  }

  function closeGroupDialog(): void {
    groupDialog.open = false;
    groupDialog.editing = null;
    groupDialog.name = "";
  }

  return { groupDialog, openGroupDialog, closeGroupDialog };
}

/** 删除分组使用应用内确认框，避免原生对话框残留焦点阻塞。 */
export function useGroupDeleteDialog<G extends NamedGroup>() {
  const groupDeleteDialog = reactive({
    open: false,
    group: null as G | null,
  });

  function requestGroupDelete(group: G): void {
    groupDeleteDialog.group = group as typeof groupDeleteDialog.group;
    groupDeleteDialog.open = true;
  }

  function closeGroupDeleteDialog(): void {
    groupDeleteDialog.open = false;
    groupDeleteDialog.group = null;
  }

  return { groupDeleteDialog, requestGroupDelete, closeGroupDeleteDialog };
}

/** “移动到分组”子菜单：当前所在分组打勾并禁用。 */
export function buildMoveToGroupMenuItem(
  groups: NamedGroup[],
  currentGroupId?: string,
): ContextMenuItem {
  return {
    key: "move",
    label: "移动到分组",
    group: "organize",
    children: [
      ...groups.map(group => ({
        key: `move:${group.id}`,
        label: `${currentGroupId === group.id ? "✓ " : ""}${group.name}`,
        group: "groups",
        disabled: currentGroupId === group.id,
      })),
      {
        key: "move:ungrouped",
        label: `${!currentGroupId ? "✓ " : ""}未分组`,
        group: "ungrouped",
        disabled: !currentGroupId,
      },
    ],
  };
}

/** 解析“移动到分组”菜单项的目标分组；非移动菜单项返回 null。 */
export function parseMoveToGroupKey(key: string): { groupId?: string } | null {
  if (!key.startsWith("move:")) {
    return null;
  }

  return { groupId: key === "move:ungrouped" ? undefined : key.slice(5) };
}
