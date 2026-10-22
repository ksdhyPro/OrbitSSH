import { describe, expect, it } from "vitest";

import type { RemoteFileNode } from "../../src/shared/sftp";
import {
  buildEndpointOptions,
  buildTransferMenuItems,
  canTransferBetweenPanes,
  createTransferPaneState,
  getVisibleNodes,
  LOCAL_ENDPOINT_ID,
  type TransferMenuInput,
  type TransferPaneState,
} from "../../src/renderer/utils/transfer-panes";

function pane(
  serverId: string,
  currentPath: string,
  nodes: RemoteFileNode[] = [],
  selected: string[] = [],
): TransferPaneState {
  const state = createTransferPaneState("left", serverId);
  state.currentPath = currentPath;
  state.nodes = nodes;
  state.selectedPaths = new Set(selected);
  return state;
}

const file = (path: string): RemoteFileNode => ({
  path,
  name: path.split("/").at(-1)!,
  type: "file",
});
const directory = (path: string): RemoteFileNode => ({
  path,
  name: path.split("/").at(-1)!,
  type: "directory",
});

describe("文件传输两侧列表", () => {
  it("左右位置下拉都提供本地和全部服务器", () => {
    expect(
      buildEndpointOptions([
        { id: "s1", name: "prod" },
        { id: "s2", name: "db" },
      ]),
    ).toEqual([
      { value: LOCAL_ENDPOINT_ID, label: "本地" },
      { value: "s1", label: "prod" },
      { value: "s2", label: "db" },
    ]);
  });

  it("新列表默认按修改时间倒序且没有选择", () => {
    const state = createTransferPaneState("right", "s1");
    expect(state.modifyTimeSortDirection).toBe("desc");
    expect(state.selectedPaths.size).toBe(0);
    expect(state.tabId).toMatch(/^data-transfer-right-/);
  });

  it("远程目录顶部提供返回上级的虚拟节点，根目录没有", () => {
    const remote = pane("s1", "/var/log", [file("/var/log/a.log")]);
    expect(getVisibleNodes(remote)[0]).toMatchObject({ path: "/var", isVirtualParent: true });
    expect(getVisibleNodes(pane("s1", "/"))).toEqual([]);
  });

  it("两侧都是本地时不能传输", () => {
    const source = pane(
      LOCAL_ENDPOINT_ID,
      "/Users/me",
      [file("/Users/me/a.txt")],
      ["/Users/me/a.txt"],
    );
    expect(canTransferBetweenPanes(source, pane(LOCAL_ENDPOINT_ID, "/tmp"))).toBe(false);
    expect(canTransferBetweenPanes(source, pane("s1", "/srv"))).toBe(true);
  });

  it("下载到本地只支持文件，文件夹需要使用下载功能", () => {
    const source = pane("s1", "/srv", [directory("/srv/app")], ["/srv/app"]);
    expect(canTransferBetweenPanes(source, pane(LOCAL_ENDPOINT_ID, "/tmp"))).toBe(false);
    expect(canTransferBetweenPanes(source, pane("s2", "/backup"))).toBe(true);
  });

  it("同一服务器内不能传到自身或自身的子目录", () => {
    const source = pane("s1", "/srv", [directory("/srv/app"), file("/srv/a.txt")], ["/srv/app"]);
    expect(canTransferBetweenPanes(source, pane("s1", "/srv/app/sub"))).toBe(false);
    expect(canTransferBetweenPanes(source, pane("s1", "/srv"))).toBe(false);
    expect(canTransferBetweenPanes(source, pane("s1", "/backup"))).toBe(true);
  });

  it("没有选择、目标目录未知或任一侧加载中时不能传输", () => {
    const target = pane("s2", "/backup");
    expect(canTransferBetweenPanes(pane("s1", "/srv", [file("/srv/a")]), target)).toBe(false);
    expect(
      canTransferBetweenPanes(pane("s1", "/srv", [file("/srv/a")], ["/srv/a"]), pane("s2", "")),
    ).toBe(false);
    const loading = pane("s1", "/srv", [file("/srv/a")], ["/srv/a"]);
    loading.loading = true;
    expect(canTransferBetweenPanes(loading, target)).toBe(false);
  });
});

describe("文件传输右键菜单", () => {
  const icons = { transfer: "t", download: "d", edit: "e", file: "f", folder: "o", trash: "x" };
  const base: TransferMenuInput = {
    targetLabel: "右侧",
    isLocal: false,
    node: null,
    selectedCount: 0,
    multiSelection: false,
    canTransfer: true,
    canDelete: true,
    canRename: true,
    canEdit: true,
    canDownload: true,
    isPreviewImage: false,
    editLabel: "编辑",
    icons,
  };
  const keys = (input: Partial<TransferMenuInput>) =>
    buildTransferMenuItems({ ...base, ...input }).map(item => item.key);

  it("本地列表只提供传输到另一侧", () => {
    expect(keys({ isLocal: true, node: file("/a") })).toEqual(["transfer-to-other"]);
  });

  it("空白处提供新建，多选时只提供批量删除", () => {
    expect(keys({})).toEqual(["transfer-to-other", "new-file", "new-directory"]);
    const items = buildTransferMenuItems({
      ...base,
      node: file("/a"),
      multiSelection: true,
      selectedCount: 3,
    });
    expect(items.map(item => item.key)).toEqual(["transfer-to-other", "delete"]);
    expect(items[1]!.label).toBe("删除 3 项");
  });

  it("文件与文件夹提供各自的操作，图片使用预览", () => {
    expect(keys({ node: directory("/srv"), selectedCount: 1 })).toEqual([
      "transfer-to-other",
      "download",
      "rename",
      "delete",
    ]);
    expect(keys({ node: file("/a.txt"), selectedCount: 1 })).toEqual([
      "transfer-to-other",
      "edit",
      "download",
      "rename",
      "delete",
    ]);
    expect(keys({ node: file("/a.png"), selectedCount: 1, isPreviewImage: true })[1]).toBe(
      "preview",
    );
  });

  it("不可用的操作标记为禁用", () => {
    const items = buildTransferMenuItems({
      ...base,
      node: file("/a"),
      selectedCount: 1,
      canTransfer: false,
      canDownload: false,
    });
    expect(items.find(item => item.key === "transfer-to-other")!.disabled).toBe(true);
    expect(items.find(item => item.key === "download")!.disabled).toBe(true);
  });
});
