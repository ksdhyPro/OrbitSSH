import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import TransferTaskDialog from "../../src/renderer/components/TransferTaskDialog.vue";
import {
  compareByModifyTime,
  toggleModifyTimeSortDirection,
} from "../../src/renderer/utils/file-sort";
import type {
  SftpManagedTaskBatch,
  SftpManagedTaskNode,
} from "../../src/shared/sftp";
import { getStyleDeclarations, hasStyleRule } from "./helpers/styles";

describe("按修改时间排序", () => {
  const files = [
    { name: "old", modifyTime: 100 },
    { name: "unknown" },
    { name: "new", modifyTime: 300 },
    { name: "middle", modifyTime: 200 },
  ];

  it("支持正序和倒序，缺少修改时间的项目始终排在末尾", () => {
    expect([...files].sort(compareByModifyTime("desc")).map(file => file.name)).toEqual([
      "new",
      "middle",
      "old",
      "unknown",
    ]);
    expect([...files].sort(compareByModifyTime("asc")).map(file => file.name)).toEqual([
      "old",
      "middle",
      "new",
      "unknown",
    ]);
  });

  it("排序方向在正序和倒序之间切换", () => {
    expect(toggleModifyTimeSortDirection("desc")).toBe("asc");
    expect(toggleModifyTimeSortDirection("asc")).toBe("desc");
  });
});

describe("TransferTaskDialog", () => {
  function createBatch(taskId: string): SftpManagedTaskBatch {
    return {
      taskId,
      direction: "upload",
      name: `批次 ${taskId}`,
      sourceLabel: "本地",
      targetLabel: "prod",
      status: "transferring",
      transferredBytes: 0,
      totalBytes: 100,
      speedBytesPerSecond: 0,
      remainingCount: 1,
    };
  }

  function createNode(taskId: string, id: string, name: string): SftpManagedTaskNode {
    return {
      id,
      taskId,
      name,
      relativePath: name,
      type: "file",
      status: "transferring",
      transferredBytes: 0,
      totalBytes: 100,
      speedBytesPerSecond: 0,
      childCount: 0,
    };
  }

  it("传输文件直接从第一层展示，不渲染批次头部", () => {
    const wrapper = mount(TransferTaskDialog, {
      props: {
        open: true,
        batches: [createBatch("task-1"), createBatch("task-2")],
        nodes: [
          createNode("task-1", "node-1", "a.tar.gz"),
          createNode("task-2", "node-2", "b.sql"),
        ],
        isOperating: () => false,
      },
      global: { stubs: { teleport: true } },
    });

    const batches = wrapper.findAll(".transfer-task-batch");
    expect(batches).toHaveLength(2);
    expect(batches[0]!.find(".transfer-task-row").text()).toContain("a.tar.gz");
    expect(batches[1]!.find(".transfer-task-row").text()).toContain("b.sql");
    expect(wrapper.find(".transfer-task-batch-header").exists()).toBe(false);
  });

  it("批次之间只用分隔线区分，批次本身不带背景和圆角", () => {
    expect(getStyleDeclarations(".transfer-task-batch + .transfer-task-batch")["border-top"]).toBeDefined();
    expect(hasStyleRule(".transfer-task-batch")).toBe(true);
    const batch = getStyleDeclarations(".transfer-task-batch");
    expect(batch.background).toBeUndefined();
    expect(batch["border-radius"]).toBeUndefined();
  });
});
