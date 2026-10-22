import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

import AppDialog from "../../src/renderer/components/AppDialog.vue";
import ContextMenu from "../../src/renderer/components/ContextMenu.vue";
import GroupedList from "../../src/renderer/components/GroupedList.vue";
import RemoteFileList, {
  type RemoteFileListNode,
} from "../../src/renderer/components/RemoteFileList.vue";
import { getStyleDeclarations } from "./helpers/styles";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AppDialog", () => {
  it("内容渲染在统一的 app-dialog-body 容器中，并提供默认 16px 边距", () => {
    const wrapper = mount(AppDialog, {
      props: { title: "测试弹窗" },
      slots: { default: '<p class="probe">内容</p>' },
      global: { stubs: { teleport: true } },
    });

    expect(wrapper.find(".app-dialog-body .probe").exists()).toBe(true);
    expect(getStyleDeclarations(".app-dialog-body").padding).toBe("16px");
  });

  it.each([
    ".connection-form",
    ".automation-task-form",
    ".automation-run-dialog",
    ".ai-config-dialog",
    ".update-dialog-content",
    ".data-transfer-dialog",
    ".confirm-dialog-content",
    ".delete-confirm-content",
    ".ai-config-form",
  ])("业务弹窗 %s 不再重复设置外层边距", selector => {
    expect(getStyleDeclarations(selector).padding).toBeUndefined();
  });
});

describe("ContextMenu", () => {
  it("把专用 menuClass 传给真实的浮动菜单根节点", () => {
    mount(ContextMenu, {
      props: {
        menu: { open: true, x: 10, y: 20 },
        items: [{ key: "open", label: "打开" }],
        menuClass: "data-transfer-context-menu",
      },
      attachTo: document.body,
    });

    const root = document.body.querySelector('[role="menu"]');
    expect(root?.classList.contains("context-menu")).toBe(true);
    expect(root?.classList.contains("data-transfer-context-menu")).toBe(true);
  });

  it("文件传输右键菜单使用视口固定定位", () => {
    expect(getStyleDeclarations(".data-transfer-context-menu").position).toBe("fixed");
  });
});

describe("GroupedList", () => {
  it("条目拖拽不会冒泡到外层面板排序处理器", async () => {
    const outerDragStart = vi.fn();
    const Host = defineComponent({
      setup: () => () =>
        h("div", { onDragstart: outerDragStart }, [
          h(GroupedList, {
            items: [
              { id: "server-1", name: "prod" },
              { id: "server-2", name: "db", groupId: "group-1" },
            ],
            groups: [{ id: "group-1", name: "数据库" }],
            itemNoun: "连接",
            moveItem: () => true,
          }),
        ]),
    });
    const wrapper = mount(Host);
    const items = wrapper.findAll(".grouped-item");

    expect(items).toHaveLength(2);
    for (const item of items) {
      await item.trigger("dragstart");
    }
    expect(outerDragStart).not.toHaveBeenCalled();
  });
});

describe("RemoteFileList 重命名", () => {
  const nodes: RemoteFileListNode[] = [
    { path: "/srv/a.log", name: "a.log", type: "file" },
    { path: "/srv/b.log", name: "b.log", type: "file" },
  ];

  it("只在重命名目标变化时聚焦并全选，列表刷新不会打断输入", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const focus = vi.spyOn(HTMLInputElement.prototype, "focus");
    const select = vi.spyOn(HTMLInputElement.prototype, "select");
    const wrapper = mount(RemoteFileList, {
      props: { nodes, selectedPaths: new Set<string>() },
      attachTo: document.body,
    });

    await wrapper.setProps({ renamingPath: "/srv/a.log", renamingValue: "a.log" });
    await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(1));
    expect(select).toHaveBeenCalledTimes(1);

    await wrapper.setProps({ nodes: [...nodes, { path: "/srv/c.log", name: "c.log", type: "file" }] });
    await wrapper.vm.$nextTick();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
