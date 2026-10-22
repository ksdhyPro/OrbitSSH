import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AiPanel from "../../src/renderer/components/AiPanel.vue";
import type { AiCommandCard } from "../../src/shared/ai";

function createCard(overrides: Partial<AiCommandCard> = {}): AiCommandCard {
  return {
    id: "card-1",
    tabId: "tab-1",
    conversationId: "conversation-1",
    command: "[prod-db] systemctl restart postgresql",
    reason: "跨服务器命令必须由用户明确批准本次执行",
    risk: "medium",
    status: "requires_approval",
    createdAt: 1_000,
    approvalId: "approval-1",
    targetServer: { name: "prod-db", host: "10.0.0.2", port: 22, username: "postgres" },
    ...overrides,
  };
}

function mountPanel(commandCards: AiCommandCard[]) {
  return mount(AiPanel, {
    props: {
      open: true,
      enabled: true,
      mode: "auto",
      inputText: "",
      isSending: false,
      error: "",
      messages: [{ id: "user-1", role: "user", content: "重启数据库", createdAt: 900 }],
      commandCards,
      shouldSuggestNewConversation: false,
      conversations: [],
      activeConversationId: "conversation-1",
      context: { tabId: "tab-1", serverId: "server-1", serverName: "prod" },
      configs: [],
      activeConfigId: "",
      layout: "workspace",
    },
    global: { stubs: { teleport: true } },
  });
}

describe("AiPanel 跨服务器审批", () => {
  it("审批弹层醒目展示实际目标服务器，批准时提交原命令卡", async () => {
    const card = createCard();
    const wrapper = mountPanel([card]);
    const popover = wrapper.get(".ai-approval-popover");

    expect(popover.get(".ai-approval-target").text()).toBe(
      "目标服务器：prod-db（postgres@10.0.0.2:22）",
    );
    await popover.findAll("button").find(button => button.text() === "批准执行")!.trigger("click");
    expect(wrapper.emitted("runApproved")).toEqual([[card]]);
  });

  it("当前终端命令不展示目标服务器", () => {
    const wrapper = mountPanel([createCard({ command: "df -h", targetServer: undefined })]);

    expect(wrapper.find(".ai-approval-target").exists()).toBe(false);
  });
});
