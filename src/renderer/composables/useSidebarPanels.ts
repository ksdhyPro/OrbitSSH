import { computed, onMounted, onUnmounted, ref, type Ref } from "vue";

import type { AppSettings } from "../../shared/settings";

export type SidebarPanel = "servers" | "automation" | "remoteFiles";

export const SIDEBAR_PANEL_COLLAPSED_HEADER_HEIGHT = 28;
export const SIDEBAR_PANEL_MIN_HEIGHT = 160;
export const SIDEBAR_PANEL_RESIZER_HEIGHT = 10;

interface SidebarPanelsOptions {
  /** 响应式的应用设置，面板顺序、折叠状态和高度都保存在 appSettings.sidebar 中。 */
  appSettings: AppSettings;
  /** AI 模式下以对话为主视图，左侧仅保留服务器面板。 */
  isAiWorkspace: Readonly<Ref<boolean>>;
  /** 布局变化后持久化设置。 */
  persist: () => void;
}

/**
 * 左侧面板布局：拖拽排序、折叠展开、分隔条调整高度，以及窗口尺寸变化后的显示高度。
 * 最后一个面板自动填满剩余空间，其余面板高度保存在设置中。
 */
export function useSidebarPanels(options: SidebarPanelsOptions) {
  const { appSettings, isAiWorkspace } = options;
  const persistSidebarLayout = options.persist;
  const sidebarPanelsElement = ref<HTMLElement | null>(null);
  const sidebarPanelsHeight = ref(0);
  const isResizingSidebarPanels = ref(false);
  let sidebarPanelResizeStartY = 0;
  let resizingSidebarPanel: SidebarPanel | null = null;
  let resizingPanelStartHeight = 0;
  let resizingAdjacentSidebarPanel: SidebarPanel | null = null;
  let resizingAdjacentPanelStartHeight = 0;
  let sidebarPanelResizePointerId: number | null = null;
  let sidebarPanelResizeElement: HTMLElement | null = null;
  let sidebarPanelsResizeObserver: ResizeObserver | null = null;

  const sidebarPanelOrder = computed(() => appSettings.sidebar.panelOrder);
  const displayedSidebarPanels = computed<SidebarPanel[]>(() =>
    isAiWorkspace.value ? ["servers"] : sidebarPanelOrder.value,
  );
  const draggedSidebarPanel = ref<SidebarPanel | null>(null);

  function isLastSidebarPanel(panel: SidebarPanel): boolean {
    return sidebarPanelOrder.value.at(-1) === panel;
  }

  function getSidebarPanelHeight(panel: SidebarPanel): number {
    return appSettings.sidebar[panel].collapsed
      ? SIDEBAR_PANEL_COLLAPSED_HEADER_HEIGHT
      : appSettings.sidebar[panel].height;
  }

  function getSidebarPanelMinimumHeight(panel: SidebarPanel): number {
    return appSettings.sidebar[panel].collapsed
      ? SIDEBAR_PANEL_COLLAPSED_HEADER_HEIGHT
      : SIDEBAR_PANEL_MIN_HEIGHT;
  }

  /** 返回分隔线下方紧邻的面板，用于将拖拽高度在相邻面板间转移。 */
  function getNextSidebarPanel(panel: SidebarPanel): SidebarPanel | null {
    const panelIndex = sidebarPanelOrder.value.indexOf(panel);
    return panelIndex >= 0 ? (sidebarPanelOrder.value[panelIndex + 1] ?? null) : null;
  }

  /** 将侧栏实际可用高度同步为响应式数据，供窗口缩放后的布局重新计算使用。 */
  function refreshSidebarPanelsHeight(): void {
    const sidebarElement = sidebarPanelsElement.value;
    if (!sidebarElement) {
      sidebarPanelsHeight.value = 0;
      return;
    }

    const sidebarStyle = window.getComputedStyle(sidebarElement);
    // clientHeight 包含上下内边距，需扣除后才是面板实际可分配的内容高度。
    sidebarPanelsHeight.value =
      sidebarElement.clientHeight -
      Number.parseFloat(sidebarStyle.paddingTop) -
      Number.parseFloat(sidebarStyle.paddingBottom);
  }

  function getSidebarPanelMaxHeight(panel: SidebarPanel): number {
    const containerHeight = sidebarPanelsHeight.value;
    const lastPanel = sidebarPanelOrder.value.at(-1) ?? "remoteFiles";
    const otherHeight = sidebarPanelOrder.value
      .filter(candidate => candidate !== panel && candidate !== lastPanel)
      .reduce((total, candidate) => total + getSidebarPanelHeight(candidate), 0);
    // 排在最下面的面板自动填充余下空间，因此调整其他面板时始终为其保留最小可用高度。
    const lastPanelMinimumHeight = getSidebarPanelMinimumHeight(lastPanel);
    // 非末尾面板的分隔条始终保留，折叠时同样占用布局高度。
    const resizerHeight =
      sidebarPanelOrder.value.slice(0, -1).length * SIDEBAR_PANEL_RESIZER_HEIGHT;

    return Math.max(
      SIDEBAR_PANEL_MIN_HEIGHT,
      containerHeight - otherHeight - lastPanelMinimumHeight - resizerHeight,
    );
  }

  function clampSidebarPanelHeight(height: number, panel: SidebarPanel): number {
    return Math.min(
      Math.max(Math.round(height), SIDEBAR_PANEL_MIN_HEIGHT),
      getSidebarPanelMaxHeight(panel),
    );
  }

  // 保留用户保存的高度；窗口变小时仅收紧当前显示高度，恢复窗口后可自动还原。
  function getSidebarPanelDisplayHeight(height: number, panel: SidebarPanel): number {
    const containerHeight = sidebarPanelsHeight.value;
    if (!containerHeight) return height;

    const lastPanel = sidebarPanelOrder.value.at(-1) ?? "remoteFiles";
    const fixedPanels = sidebarPanelOrder.value.slice(0, -1);
    const lastPanelMinimumHeight = getSidebarPanelMinimumHeight(lastPanel);
    const fixedPanelsHeight =
      containerHeight - lastPanelMinimumHeight - fixedPanels.length * SIDEBAR_PANEL_RESIZER_HEIGHT;
    let allocatedHeight = 0;

    for (let index = 0; index < fixedPanels.length; index += 1) {
      const candidate = fixedPanels[index];
      const candidateMinimumHeight = getSidebarPanelMinimumHeight(candidate);
      const followingMinimumHeight = fixedPanels
        .slice(index + 1)
        .reduce((total, followingPanel) => total + getSidebarPanelHeight(followingPanel), 0);
      // 优先展示保存高度；空间不足时从上到下收紧，同时为后续面板和末尾面板保留最小高度。
      const availableHeight = fixedPanelsHeight - allocatedHeight - followingMinimumHeight;
      const displayHeight = Math.max(
        candidateMinimumHeight,
        Math.min(getSidebarPanelHeight(candidate), availableHeight),
      );

      if (candidate === panel) return displayHeight;
      allocatedHeight += displayHeight;
    }

    return height;
  }

  function getSidebarPanelStyle(panel: SidebarPanel): { height: string | undefined } {
    if (appSettings.sidebar[panel].collapsed) {
      return { height: `${SIDEBAR_PANEL_COLLAPSED_HEADER_HEIGHT}px` };
    }

    return {
      height: isLastSidebarPanel(panel)
        ? undefined
        : `${getSidebarPanelDisplayHeight(appSettings.sidebar[panel].height, panel)}px`,
    };
  }

  function toggleSidebarPanel(panel: "servers" | "automation" | "remoteFiles"): void {
    const isOpening = appSettings.sidebar[panel].collapsed;
    appSettings.sidebar[panel].collapsed = !isOpening;

    if (isOpening) {
      // 展开目标面板前，先将其余展开面板收至最小高度，为目标面板腾出全部可用空间。
      sidebarPanelOrder.value.forEach(candidate => {
        if (candidate !== panel && !appSettings.sidebar[candidate].collapsed) {
          appSettings.sidebar[candidate].height = SIDEBAR_PANEL_MIN_HEIGHT;
        }
      });
      appSettings.sidebar[panel].height = getSidebarPanelMaxHeight(panel);
    }

    persistSidebarLayout();
  }

  /** 仅高亮当前正在拖动的面板分隔条，避免其他分隔条同时出现激活样式。 */
  function isResizingSidebarPanel(panel: SidebarPanel): boolean {
    return isResizingSidebarPanels.value && resizingSidebarPanel === panel;
  }

  function handleSidebarPanelResizeMove(event: PointerEvent): void {
    if (!isResizingSidebarPanels.value) {
      return;
    }

    if (!resizingSidebarPanel) return;

    const requestedDelta = event.clientY - sidebarPanelResizeStartY;
    const sourcePanel = resizingSidebarPanel;
    const adjacentPanel = resizingAdjacentSidebarPanel;

    if (adjacentPanel && !isLastSidebarPanel(adjacentPanel)) {
      // 中间分隔线优先在两侧面板间转移高度；相邻面板已到最小高度时，
      // 允许从底部自动填充面板的剩余空间取高度，避免分隔线被完全卡死。
      const adjacentSlack =
        resizingAdjacentPanelStartHeight - getSidebarPanelMinimumHeight(adjacentPanel);
      const appliedDelta = Math.min(
        Math.max(
          Math.round(requestedDelta),
          getSidebarPanelMinimumHeight(sourcePanel) - resizingPanelStartHeight,
        ),
        Math.max(adjacentSlack, getSidebarPanelMaxHeight(sourcePanel) - resizingPanelStartHeight),
      );
      const adjacentDelta = Math.min(appliedDelta, Math.max(adjacentSlack, 0));
      appSettings.sidebar[sourcePanel].height = resizingPanelStartHeight + appliedDelta;
      appSettings.sidebar[adjacentPanel].height = resizingAdjacentPanelStartHeight - adjacentDelta;
    } else {
      // 下方为自动填充的末尾面板时，由末尾面板吸收高度变化，但仍保留它的最小高度。
      appSettings.sidebar[sourcePanel].height = clampSidebarPanelHeight(
        resizingPanelStartHeight + requestedDelta,
        sourcePanel,
      );
    }
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  function stopSidebarPanelResize(): void {
    if (!isResizingSidebarPanels.value) {
      return;
    }

    isResizingSidebarPanels.value = false;
    resizingSidebarPanel = null;
    resizingAdjacentSidebarPanel = null;
    resizingAdjacentPanelStartHeight = 0;
    if (sidebarPanelResizeElement && sidebarPanelResizePointerId !== null) {
      sidebarPanelResizeElement.releasePointerCapture?.(sidebarPanelResizePointerId);
    }
    sidebarPanelResizeElement = null;
    sidebarPanelResizePointerId = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", handleSidebarPanelResizeMove, true);
    window.removeEventListener("pointerup", stopSidebarPanelResize, true);
    persistSidebarLayout();
  }

  function startSidebarPanelResize(event: PointerEvent, panel: SidebarPanel): void {
    event.preventDefault();

    // 折叠面板的分隔条仍允许拖拽；开始调整时先恢复到最小可用高度。
    if (appSettings.sidebar[panel].collapsed) {
      appSettings.sidebar[panel].collapsed = false;
      appSettings.sidebar[panel].height = SIDEBAR_PANEL_MIN_HEIGHT;
    }

    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
      // 指针捕获让分隔条在鼠标移入 SSH 终端画布后仍持续收到移动事件。
      target.setPointerCapture(event.pointerId);
      sidebarPanelResizeElement = target;
      sidebarPanelResizePointerId = event.pointerId;
    }
    sidebarPanelResizeStartY = event.clientY;
    resizingSidebarPanel = panel;
    resizingPanelStartHeight = getSidebarPanelDisplayHeight(
      appSettings.sidebar[panel].height,
      panel,
    );
    const adjacentPanel = getNextSidebarPanel(panel);
    resizingAdjacentSidebarPanel =
      adjacentPanel && !appSettings.sidebar[adjacentPanel].collapsed ? adjacentPanel : null;
    resizingAdjacentPanelStartHeight = resizingAdjacentSidebarPanel
      ? isLastSidebarPanel(resizingAdjacentSidebarPanel)
        ? appSettings.sidebar[resizingAdjacentSidebarPanel].height
        : getSidebarPanelDisplayHeight(
            appSettings.sidebar[resizingAdjacentSidebarPanel].height,
            resizingAdjacentSidebarPanel,
          )
      : 0;
    isResizingSidebarPanels.value = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    // 使用捕获阶段监听，避免 SSH 终端画布拦截指针事件后分隔条无法继续拖动。
    window.addEventListener("pointermove", handleSidebarPanelResizeMove, true);
    window.addEventListener("pointerup", stopSidebarPanelResize, true);
  }

  /** 记录被拖动的面板，拖放完成后统一写入持久化排序。 */
  function startSidebarPanelDrag(event: DragEvent, panel: SidebarPanel): void {
    // 仅允许从面板标题发起排序拖拽，避免与远程文件的拖放操作冲突。
    if (!(event.target instanceof Element) || !event.target.closest(".panel-header")) {
      event.preventDefault();
      return;
    }

    if (!event.dataTransfer) return;

    draggedSidebarPanel.value = panel;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", panel);
  }

  function finishSidebarPanelDrag(event: DragEvent, targetPanel: SidebarPanel): void {
    const sourcePanel = draggedSidebarPanel.value;
    draggedSidebarPanel.value = null;
    if (!sourcePanel || sourcePanel === targetPanel) return;

    const nextOrder = [...sidebarPanelOrder.value];
    const sourceIndex = nextOrder.indexOf(sourcePanel);
    const targetIndex = nextOrder.indexOf(targetPanel);
    if (sourceIndex < 0 || targetIndex < 0) return;

    nextOrder.splice(sourceIndex, 1);
    const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    const targetElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const targetMiddle = targetElement
      ? targetElement.getBoundingClientRect().top + targetElement.clientHeight / 2
      : Number.POSITIVE_INFINITY;
    // 按鼠标落点决定插入目标面板的上方或下方，确保可拖到列表首尾。
    const insertIndex =
      event.clientY > targetMiddle ? adjustedTargetIndex + 1 : adjustedTargetIndex;
    nextOrder.splice(insertIndex, 0, sourcePanel);
    appSettings.sidebar.panelOrder = nextOrder;
    persistSidebarLayout();
  }

  function clearSidebarPanelDrag(): void {
    draggedSidebarPanel.value = null;
  }

  onMounted(() => {
    refreshSidebarPanelsHeight();
    sidebarPanelsResizeObserver = new ResizeObserver(refreshSidebarPanelsHeight);
    if (sidebarPanelsElement.value) {
      sidebarPanelsResizeObserver.observe(sidebarPanelsElement.value);
    }
  });

  onUnmounted(() => {
    sidebarPanelsResizeObserver?.disconnect();
    sidebarPanelsResizeObserver = null;
    stopSidebarPanelResize();
  });

  return {
    sidebarPanelsElement,
    sidebarPanelsHeight,
    sidebarPanelOrder,
    displayedSidebarPanels,
    draggedSidebarPanel,
    isLastSidebarPanel,
    getSidebarPanelMaxHeight,
    getSidebarPanelDisplayHeight,
    getSidebarPanelStyle,
    refreshSidebarPanelsHeight,
    toggleSidebarPanel,
    isResizingSidebarPanel,
    startSidebarPanelResize,
    stopSidebarPanelResize,
    startSidebarPanelDrag,
    finishSidebarPanelDrag,
    clearSidebarPanelDrag,
  };
}
