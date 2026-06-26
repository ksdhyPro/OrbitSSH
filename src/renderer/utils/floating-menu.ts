export type FloatingMenuCloseReason =
  | "outside-pointer"
  | "outside-contextmenu"
  | "outside-wheel"
  | "escape"
  | "manual";

interface FloatingMenuEntry {
  id: string;
  close: (reason: FloatingMenuCloseReason) => void;
  getElement: () => HTMLElement | null;
  isOpen: () => boolean;
}

const FLOATING_MENU_TRIGGER_SELECTOR = "[data-floating-menu-trigger]";
const floatingMenus = new Map<string, FloatingMenuEntry>();
let isGlobalListenerActive = false;

function getEventPath(event: Event): EventTarget[] {
  return event.composedPath?.() ?? [];
}

// 判断事件是否发生在已打开的浮层内部，内部点击和滚动不触发全局关闭。
function isInsideOpenMenu(event: Event): boolean {
  const path = getEventPath(event);

  for (const menu of floatingMenus.values()) {
    const element = menu.getElement();

    if (!menu.isOpen() || !element) {
      continue;
    }

    if (path.includes(element)) {
      return true;
    }

    const target = event.target;
    if (target instanceof Node && element.contains(target)) {
      return true;
    }
  }

  return false;
}

// 菜单触发器自行处理开关逻辑，全局捕获阶段不提前关闭，避免点击同一按钮无法收起。
function isFloatingMenuTrigger(event: Event): boolean {
  const path = getEventPath(event);

  return path.some(
    target =>
      target instanceof Element &&
      Boolean(target.closest(FLOATING_MENU_TRIGGER_SELECTOR)),
  );
}

function handleGlobalPointerDown(event: PointerEvent): void {
  if (isInsideOpenMenu(event) || isFloatingMenuTrigger(event)) {
    return;
  }

  closeFloatingMenus("outside-pointer");
}

function handleGlobalContextMenu(event: MouseEvent): void {
  if (isInsideOpenMenu(event)) {
    return;
  }

  closeFloatingMenus("outside-contextmenu");
}

function handleGlobalWheel(event: WheelEvent): void {
  if (isInsideOpenMenu(event)) {
    return;
  }

  closeFloatingMenus("outside-wheel");
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") {
    return;
  }

  closeFloatingMenus("escape");
}

function ensureGlobalListeners(): void {
  if (isGlobalListenerActive || typeof window === "undefined") {
    return;
  }

  window.addEventListener("pointerdown", handleGlobalPointerDown, true);
  window.addEventListener("contextmenu", handleGlobalContextMenu, true);
  window.addEventListener("wheel", handleGlobalWheel, {
    capture: true,
    passive: true,
  });
  window.addEventListener("keydown", handleGlobalKeydown, true);
  isGlobalListenerActive = true;
}

function cleanupGlobalListeners(): void {
  if (!isGlobalListenerActive || floatingMenus.size > 0) {
    return;
  }

  window.removeEventListener("pointerdown", handleGlobalPointerDown, true);
  window.removeEventListener("contextmenu", handleGlobalContextMenu, true);
  window.removeEventListener("wheel", handleGlobalWheel, true);
  window.removeEventListener("keydown", handleGlobalKeydown, true);
  isGlobalListenerActive = false;
}

export function registerFloatingMenu(menu: FloatingMenuEntry): () => void {
  floatingMenus.set(menu.id, menu);
  ensureGlobalListeners();

  return () => {
    floatingMenus.delete(menu.id);
    cleanupGlobalListeners();
  };
}

// 打开任意浮层前调用，保证全局只有当前目标菜单保持展开。
export function closeFloatingMenus(
  reason: FloatingMenuCloseReason = "manual",
  exceptId?: string,
): void {
  for (const menu of [...floatingMenus.values()]) {
    if (menu.id === exceptId || !menu.isOpen()) {
      continue;
    }

    menu.close(reason);
  }
}
