import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HostKeyPromptDialog from "../../src/renderer/components/HostKeyPromptDialog.vue";
import type { HostKeyPrompt } from "../../src/shared/host-key";

function createPrompt(overrides: Partial<HostKeyPrompt> = {}): HostKeyPrompt {
  return {
    requestId: "request-1",
    kind: "unknown",
    host: "10.0.0.8",
    port: 22,
    serverName: "生产服务器",
    keyType: "ssh-ed25519",
    fingerprint: "SHA256:NX3cl1iyu3EIR2jdFiIKVOcE3QNwRQw2wwKp0GOgpe0",
    ...overrides,
  };
}

describe("HostKeyPromptDialog", () => {
  let emitPrompt: (prompt: HostKeyPrompt) => void;
  let emitClosed: (requestId: string) => void;
  let pending: HostKeyPrompt[];
  const respond = vi.fn(async () => true);

  beforeEach(() => {
    pending = [];
    respond.mockClear();
    window.orbitSSH = {
      hostKeys: {
        listPending: vi.fn(async () => pending),
        respond,
        onPrompt: vi.fn((callback: (prompt: HostKeyPrompt) => void) => {
          emitPrompt = callback;
          return () => undefined;
        }),
        onPromptClosed: vi.fn((callback: (requestId: string) => void) => {
          emitClosed = callback;
          return () => undefined;
        }),
      },
    } as unknown as Window["orbitSSH"];
  });

  async function mountDialog() {
    const wrapper = mount(HostKeyPromptDialog, { global: { stubs: { teleport: true } } });
    await flushPromises();
    return wrapper;
  }

  function findButton(wrapper: Awaited<ReturnType<typeof mountDialog>>, label: string) {
    return wrapper.findAll("button").find(button => button.text() === label)!;
  }

  it("首次连接展示服务器与指纹，信任后通知主进程继续连接", async () => {
    const wrapper = await mountDialog();
    expect(wrapper.find(".host-key-dialog").exists()).toBe(false);

    emitPrompt(createPrompt());
    await flushPromises();
    expect(wrapper.text()).toContain("确认服务器主机密钥");
    expect(wrapper.text()).toContain("生产服务器（10.0.0.8:22）");
    expect(wrapper.text()).toContain("SHA256:NX3cl1iyu3EIR2jdFiIKVOcE3QNwRQw2wwKp0GOgpe0");

    await findButton(wrapper, "信任并连接").trigger("click");
    await flushPromises();
    expect(respond).toHaveBeenCalledWith({ requestId: "request-1", trust: true });
    expect(wrapper.find(".host-key-dialog").exists()).toBe(false);
  });

  it("关闭弹窗视为拒绝", async () => {
    const wrapper = await mountDialog();
    emitPrompt(createPrompt());
    await flushPromises();

    await wrapper.get('button[aria-label="关闭弹窗"]').trigger("click");
    await flushPromises();
    expect(respond).toHaveBeenCalledWith({ requestId: "request-1", trust: false });
  });

  it("密钥变化时并列展示前后指纹，默认操作为断开连接", async () => {
    const wrapper = await mountDialog();
    emitPrompt(
      createPrompt({
        kind: "changed",
        keyType: "ecdsa-sha2-nistp256",
        fingerprint: "SHA256:tt8c0+6p2BVU7KHYcCn0JlXj5aySS+/S+QzrfEmsqds",
        previousKeyType: "ssh-ed25519",
        previousFingerprint: "SHA256:NX3cl1iyu3EIR2jdFiIKVOcE3QNwRQw2wwKp0GOgpe0",
      }),
    );
    await flushPromises();

    expect(wrapper.text()).toContain("警告：服务器主机密钥已变更");
    expect(wrapper.text()).toContain("中间人攻击");
    expect(wrapper.text()).toContain("SHA256:NX3cl1iyu3EIR2jdFiIKVOcE3QNwRQw2wwKp0GOgpe0");
    expect(wrapper.text()).toContain("SHA256:tt8c0+6p2BVU7KHYcCn0JlXj5aySS+/S+QzrfEmsqds");
    expect(findButton(wrapper, "断开连接").classes()).toContain("btn-primary");
    expect(findButton(wrapper, "仍然信任新密钥").classes()).toContain("btn-danger-soft");

    await findButton(wrapper, "断开连接").trigger("click");
    await flushPromises();
    expect(respond).toHaveBeenCalledWith({ requestId: "request-1", trust: false });
  });

  it("多个确认依次展示，刷新后恢复未处理的确认，主进程关闭的确认会被移除", async () => {
    pending = [createPrompt({ requestId: "pending-1", serverName: "刷新前的服务器" })];
    const wrapper = await mountDialog();
    expect(wrapper.text()).toContain("刷新前的服务器");

    emitPrompt(createPrompt({ requestId: "request-2", serverName: "第二台服务器" }));
    emitPrompt(createPrompt({ requestId: "request-2", serverName: "第二台服务器" }));
    emitClosed("pending-1");
    await flushPromises();
    expect(wrapper.text()).toContain("第二台服务器");

    await findButton(wrapper, "取消").trigger("click");
    await flushPromises();
    expect(respond).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".host-key-dialog").exists()).toBe(false);
  });
});
