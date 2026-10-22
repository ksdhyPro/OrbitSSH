import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, reactive, ref } from "vue";

import {
  SIDEBAR_PANEL_COLLAPSED_HEADER_HEIGHT,
  SIDEBAR_PANEL_MIN_HEIGHT,
  type SidebarPanel,
  useSidebarPanels,
} from "../../src/renderer/composables/useSidebarPanels";
import { defaultAppSettings } from "../../src/shared/settings";

function setup(configure: (settings: typeof defaultAppSettings) => void, containerHeight = 800) {
  const appSettings = reactive(structuredClone(defaultAppSettings));
  appSettings.sidebar.panelOrder = ["servers", "automation", "remoteFiles"];
  configure(appSettings);
  const aiWorkspace = ref(false);
  const persist = vi.fn();
  let panels!: ReturnType<typeof useSidebarPanels>;
  mount(
    defineComponent({
      setup() {
        panels = useSidebarPanels({
          appSettings,
          isAiWorkspace: computed(() => aiWorkspace.value),
          persist,
        });
        return () => h("aside");
      },
    }),
  );
  panels.sidebarPanelsHeight.value = containerHeight;
  return { appSettings, aiWorkspace, persist, panels };
}

function pointerEvent(type: string, clientY: number) {
  const target = document.createElement("div");
  target.setPointerCapture = vi.fn();
  target.releasePointerCapture = vi.fn();
  const event = new MouseEvent(type, { clientY, bubbles: true }) as PointerEvent;
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "currentTarget", { value: target });
  return event;
}

function dragEvent(clientY: number, options: { fromHeader?: boolean; targetTop?: number } = {}) {
  const header = document.createElement("div");
  header.className = options.fromHeader === false ? "panel-body" : "panel-header";
  const currentTarget = document.createElement("section");
  Object.defineProperty(currentTarget, "clientHeight", { value: 100 });
  currentTarget.getBoundingClientRect = () => ({ top: options.targetTop ?? 0 }) as DOMRect;
  const event = new MouseEvent("drop", { clientY, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "target", { value: header });
  Object.defineProperty(event, "currentTarget", { value: currentTarget });
  Object.defineProperty(event, "dataTransfer", {
    value: { effectAllowed: "", setData: vi.fn() },
  });
  return event;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("useSidebarPanels", () => {
  it("折叠面板固定为标题高度，最后一个面板自动填满剩余空间", () => {
    const { panels } = setup(settings => {
      settings.sidebar.automation.collapsed = true;
    });

    expect(panels.getSidebarPanelStyle("automation").height).toBe(
      `${SIDEBAR_PANEL_COLLAPSED_HEADER_HEIGHT}px`,
    );
    expect(panels.getSidebarPanelStyle("remoteFiles").height).toBeUndefined();
    expect(panels.isLastSidebarPanel("remoteFiles")).toBe(true);
  });

  it("展开面板时其他展开面板收至最小高度，目标面板使用最大可用高度", () => {
    const { appSettings, panels, persist } = setup(settings => {
      settings.sidebar.servers = { collapsed: false, height: 300 };
      settings.sidebar.automation = { collapsed: true, height: 200 };
    });

    panels.toggleSidebarPanel("automation");

    expect(appSettings.sidebar.automation.collapsed).toBe(false);
    expect(appSettings.sidebar.servers.height).toBe(SIDEBAR_PANEL_MIN_HEIGHT);
    // 800 - 服务器 160 - 末尾面板最小 160 - 两条分隔线 20
    expect(appSettings.sidebar.automation.height).toBe(460);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("窗口变小时只收紧显示高度，保存的高度保持不变以便恢复", () => {
    const { appSettings, panels } = setup(settings => {
      settings.sidebar.servers = { collapsed: false, height: 400 };
      settings.sidebar.automation = { collapsed: true, height: 200 };
    }, 500);

    // 500 - 末尾最小 160 - 分隔线 20 - 下方折叠面板 28
    expect(panels.getSidebarPanelStyle("servers").height).toBe("292px");
    expect(appSettings.sidebar.servers.height).toBe(400);
  });

  it("拖动分隔线在相邻面板间转移高度，相邻面板到最小后从末尾面板取高度", () => {
    const { appSettings, panels, persist } = setup(settings => {
      settings.sidebar.servers = { collapsed: false, height: 300 };
      settings.sidebar.automation = { collapsed: false, height: 300 };
    }, 900);

    panels.startSidebarPanelResize(pointerEvent("pointerdown", 100), "servers");
    window.dispatchEvent(pointerEvent("pointermove", 150));
    expect(appSettings.sidebar.servers.height).toBe(350);
    expect(appSettings.sidebar.automation.height).toBe(250);
    expect(panels.isResizingSidebarPanel("servers")).toBe(true);

    window.dispatchEvent(pointerEvent("pointermove", 400));
    expect(appSettings.sidebar.automation.height).toBe(SIDEBAR_PANEL_MIN_HEIGHT);
    expect(appSettings.sidebar.servers.height).toBeGreaterThan(300 + 140);

    window.dispatchEvent(pointerEvent("pointerup", 400));
    expect(panels.isResizingSidebarPanel("servers")).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("折叠面板的分隔条可以直接拖拽，开始时恢复到最小高度", () => {
    const { appSettings, panels } = setup(settings => {
      settings.sidebar.servers = { collapsed: true, height: 400 };
    });

    panels.startSidebarPanelResize(pointerEvent("pointerdown", 100), "servers");

    expect(appSettings.sidebar.servers.collapsed).toBe(false);
    expect(appSettings.sidebar.servers.height).toBe(SIDEBAR_PANEL_MIN_HEIGHT);
    panels.stopSidebarPanelResize();
  });

  it("按落点在目标面板上半部或下半部插入，并持久化新的顺序", () => {
    const { appSettings, panels, persist } = setup(() => undefined);
    const drag = (source: SidebarPanel, target: SidebarPanel, clientY: number) => {
      panels.startSidebarPanelDrag(dragEvent(clientY), source);
      panels.finishSidebarPanelDrag(dragEvent(clientY), target);
    };

    drag("remoteFiles", "servers", 10);
    expect(appSettings.sidebar.panelOrder).toEqual(["remoteFiles", "servers", "automation"]);

    drag("remoteFiles", "automation", 90);
    expect(appSettings.sidebar.panelOrder).toEqual(["servers", "automation", "remoteFiles"]);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("只能从面板标题发起排序拖拽", () => {
    const { panels } = setup(() => undefined);
    const event = dragEvent(10, { fromHeader: false });

    panels.startSidebarPanelDrag(event, "servers");

    expect(event.defaultPrevented).toBe(true);
    expect(panels.draggedSidebarPanel.value).toBeNull();
  });

  it("AI 模式左侧只显示服务器面板", () => {
    const { aiWorkspace, panels } = setup(() => undefined);
    expect(panels.displayedSidebarPanels.value).toHaveLength(3);

    aiWorkspace.value = true;
    expect(panels.displayedSidebarPanels.value).toEqual(["servers"]);
  });
});
