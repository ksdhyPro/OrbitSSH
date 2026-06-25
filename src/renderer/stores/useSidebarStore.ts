import { defineStore } from "pinia";
import { ref } from "vue";

// 侧边栏宽度拖拽 store。拖动会改变终端区宽度，
// 由 App.vue watch(sidebarWidth) 调度终端 fit，避免反向依赖终端 store。
export const useSidebarStore = defineStore("sidebar", () => {
  const sidebarWidth = ref(320);
  const isResizingSidebar = ref(false);

  function clampSidebarWidth(width: number): number {
    return Math.min(Math.max(width, 260), 520);
  }

  function handleSidebarResizeMove(event: MouseEvent): void {
    if (!isResizingSidebar.value) {
      return;
    }

    sidebarWidth.value = clampSidebarWidth(event.clientX);
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

  function startSidebarResize(event: MouseEvent): void {
    event.preventDefault();
    isResizingSidebar.value = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleSidebarResizeMove);
    window.addEventListener("mouseup", stopSidebarResize);
  }

  return {
    sidebarWidth,
    isResizingSidebar,
    clampSidebarWidth,
    handleSidebarResizeMove,
    stopSidebarResize,
    startSidebarResize,
  };
});
