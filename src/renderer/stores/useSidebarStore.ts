import { defineStore } from "pinia";
import { ref } from "vue";

// 侧边栏宽度拖拽 store。拖动会改变终端区宽度，
// 由 App.vue watch(sidebarWidth) 调度终端 fit，避免反向依赖终端 store。
export const useSidebarStore = defineStore("sidebar", () => {
  // AI 面板允许收缩到可用的阅读宽度，避免拖到最右仍占用 320px 挤压终端。
  const MIN_AI_PANEL_WIDTH = 240;
  const MAX_AI_PANEL_WIDTH = 680;
  const sidebarWidth = ref(320);
  const isResizingSidebar = ref(false);
  const aiPanelWidth = ref(360);
  const isResizingAiPanel = ref(false);
  let aiPanelRightBoundary = 0;

  function clampSidebarWidth(width: number): number {
    return Math.min(Math.max(width, 260), 520);
  }

  function clampAiPanelWidth(width: number): number {
    // 右侧 AI 面板不能挤掉主终端区域，按当前窗口和左侧栏宽度动态收口。
    const viewportMax = Math.max(
      MIN_AI_PANEL_WIDTH,
      window.innerWidth - sidebarWidth.value - 260,
    );
    return Math.min(
      Math.max(width, MIN_AI_PANEL_WIDTH),
      Math.min(MAX_AI_PANEL_WIDTH, viewportMax),
    );
  }

  function handleSidebarResizeMove(event: MouseEvent): void {
    if (!isResizingSidebar.value) {
      return;
    }

    sidebarWidth.value = clampSidebarWidth(event.clientX);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function handleAiPanelResizeMove(event: MouseEvent): void {
    if (!isResizingAiPanel.value) {
      return;
    }

    // 从内容容器的真实右边缘计算，避免缩放后窗口坐标与布局坐标不一致。
    aiPanelWidth.value = clampAiPanelWidth(aiPanelRightBoundary - event.clientX);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function stopSidebarResize(): void {
    if (!isResizingSidebar.value) {
      return;
    }

    isResizingSidebar.value = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleSidebarResizeMove);
    window.removeEventListener("mouseup", stopSidebarResize);
  }

  function stopAiPanelResize(): void {
    if (!isResizingAiPanel.value) {
      return;
    }

    isResizingAiPanel.value = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleAiPanelResizeMove);
    window.removeEventListener("mouseup", stopAiPanelResize);
  }

  function startSidebarResize(event: MouseEvent): void {
    event.preventDefault();
    isResizingSidebar.value = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleSidebarResizeMove);
    window.addEventListener("mouseup", stopSidebarResize);
  }

  function startAiPanelResize(event: MouseEvent, rightBoundary: number): void {
    event.preventDefault();
    isResizingAiPanel.value = true;
    aiPanelRightBoundary = rightBoundary;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleAiPanelResizeMove);
    window.addEventListener("mouseup", stopAiPanelResize);
  }

  return {
    sidebarWidth,
    isResizingSidebar,
    aiPanelWidth,
    isResizingAiPanel,
    clampSidebarWidth,
    clampAiPanelWidth,
    handleSidebarResizeMove,
    handleAiPanelResizeMove,
    stopSidebarResize,
    stopAiPanelResize,
    startSidebarResize,
    startAiPanelResize,
  };
});
