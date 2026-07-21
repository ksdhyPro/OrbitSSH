import { defineStore } from "pinia";
import { ref } from "vue";

// 侧边栏宽度拖拽 store。拖动会改变终端区宽度，
// 由 App.vue watch(sidebarWidth) 调度终端 fit，避免反向依赖终端 store。
export const useSidebarStore = defineStore("sidebar", () => {
  const sidebarWidth = ref(360);
  const isResizingSidebar = ref(false);
  const aiPanelWidth = ref(340);
  const isResizingAiPanel = ref(false);

  function clampSidebarWidth(width: number): number {
    return Math.min(Math.max(width, 320), 560);
  }

  function clampAiPanelWidth(width: number): number {
    // 右侧 AI 面板不能挤掉主终端区域，按当前窗口和左侧栏宽度动态收口。
    const viewportMax = Math.max(
      300,
      window.innerWidth - sidebarWidth.value - 54 - 520,
    );
    return Math.min(Math.max(width, 300), Math.min(620, viewportMax));
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

    // 右侧面板从窗口右边缘向左计算宽度，拖拽方向与左侧栏相反。
    aiPanelWidth.value = clampAiPanelWidth(window.innerWidth - event.clientX);
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

  function startAiPanelResize(event: MouseEvent): void {
    event.preventDefault();
    isResizingAiPanel.value = true;
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
