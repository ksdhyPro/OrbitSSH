/**
 * 菜单定位：基于锚点坐标计算菜单左上角位置，并在贴近视口边缘时自动翻转/钳制，
 * 避免菜单溢出屏幕外（右键菜单点在右下角、顶栏按钮靠右等场景）。
 *
 * 定位上下文为视口（菜单使用 position: fixed），因此全部使用 client 坐标。
 */

/** 菜单项固定高度（出自 .context-menu button { height: 32px }）。 */
export const CONTEXT_MENU_ITEM_HEIGHT = 32;

/** 容器边框 1px × 2 + 少量安全余量 */
const CONTAINER_OVERHEAD = 8;

/** 默认菜单尺寸（未提供 itemCount 时的回退预估，覆盖 3 项菜单）。 */
export const CONTEXT_MENU_SIZE = {
  width: 180,
  height: CONTEXT_MENU_ITEM_HEIGHT * 3 + CONTAINER_OVERHEAD,
} as const;

/** 与视口边缘保留的安全间距，避免菜单完全贴边。 */
const VIEWPORT_MARGIN = 8;

export interface MenuAnchor {
  /** 锚点视口横坐标（按钮左边或鼠标 x） */
  x: number;
  /** 锚点视口纵坐标（按钮底部或鼠标 y） */
  y: number;
}

export interface MenuPlacement {
  /** 计算后用于 left 的横坐标 */
  x: number;
  /** 计算后用于 top 的纵坐标 */
  y: number;
}

export interface MenuContainerSize {
  width: number;
  height: number;
}

/**
 * 根据菜单项数量估算高度。
 * 菜单项固定为 32px，加上容器边框与少量余量。
 */
function heightForItemCount(itemCount: number): number {
  return itemCount * CONTEXT_MENU_ITEM_HEIGHT + CONTAINER_OVERHEAD;
}

/**
 * 根据锚点计算菜单左上角坐标。
 *
 * 默认向右下展开：菜单左边对齐锚点 x、顶部对齐锚点 y。
 * - 横向：若向右放不下，则翻转为锚点对齐菜单右边（向左展开）；仍放不下则在视口内钳制。
 * - 纵向：若向下放不下，则翻转为锚点对齐菜单底边（向上展开）；仍放不下则在视口内钳制。
 *
 * @param anchor  菜单锚点坐标
 * @param itemCountOrSize  菜单项数量（按 32px/项精确估算），或直接传入自定义尺寸
 */
export function resolveMenuPlacement(
  anchor: MenuAnchor,
  itemCountOrSize?: number | { width: number; height: number },
): MenuPlacement {
  const resolvedSize =
    typeof itemCountOrSize === "number"
      ? { width: CONTEXT_MENU_SIZE.width, height: heightForItemCount(itemCountOrSize) }
      : (itemCountOrSize ?? CONTEXT_MENU_SIZE);

  const maxWidth = window.innerWidth;
  const maxHeight = window.innerHeight;
  const { width, height } = resolvedSize;

  // 横向：默认左边对齐锚点；右边溢出则向左翻转；最终在视口内钳制。
  let x = anchor.x;
  if (x + width > maxWidth - VIEWPORT_MARGIN) {
    x = anchor.x - width;
  }
  x = Math.max(VIEWPORT_MARGIN, Math.min(x, maxWidth - width - VIEWPORT_MARGIN));

  // 纵向：默认顶部对齐锚点；底部溢出则向上翻转；最终在视口内钳制。
  let y = anchor.y;
  if (y + height > maxHeight - VIEWPORT_MARGIN) {
    y = anchor.y - height;
  }
  y = Math.max(VIEWPORT_MARGIN, Math.min(y, maxHeight - height - VIEWPORT_MARGIN));

  return { x, y };
}

/**
 * 根据局部容器坐标计算菜单位置。
 * 弹窗内部存在 transform 时，fixed 菜单会改用弹窗作为包含块；此时需使用相对弹窗的坐标。
 */
export function resolveLocalMenuPlacement(
  anchor: MenuAnchor,
  containerSize: MenuContainerSize,
  itemCountOrSize?: number | { width: number; height: number },
): MenuPlacement {
  const resolvedSize =
    typeof itemCountOrSize === "number"
      ? { width: CONTEXT_MENU_SIZE.width, height: heightForItemCount(itemCountOrSize) }
      : (itemCountOrSize ?? CONTEXT_MENU_SIZE);
  const { width, height } = resolvedSize;
  let x = anchor.x;
  let y = anchor.y;

  // 局部坐标下仍然保持右下优先，空间不足时向左/向上翻转并钳制。
  if (x + width > containerSize.width - VIEWPORT_MARGIN) {
    x = anchor.x - width;
  }
  if (y + height > containerSize.height - VIEWPORT_MARGIN) {
    y = anchor.y - height;
  }

  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(x, containerSize.width - width - VIEWPORT_MARGIN)),
    y: Math.max(VIEWPORT_MARGIN, Math.min(y, containerSize.height - height - VIEWPORT_MARGIN)),
  };
}
