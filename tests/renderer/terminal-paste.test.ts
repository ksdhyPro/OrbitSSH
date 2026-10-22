import { describe, expect, it, vi } from "vitest";

import {
  attachMultilinePasteListener,
  createTerminalPasteController,
  shouldConfirmTerminalData,
} from "../../src/renderer/utils/terminal-paste";

function createController() {
  const options = {
    write: vi.fn(),
    paste: vi.fn(),
    focus: vi.fn(),
    hasTerminal: vi.fn(() => true),
  };
  return { options, controller: createTerminalPasteController(options) };
}

describe("多行终端粘贴确认", () => {
  it("单个回车直接发送，批量输入中的换行才需要确认", () => {
    expect(shouldConfirmTerminalData("\r")).toBe(false);
    expect(shouldConfirmTerminalData("\n")).toBe(false);
    expect(shouldConfirmTerminalData("ls")).toBe(false);
    expect(shouldConfirmTerminalData("ls\nrm -rf /tmp/x")).toBe(true);

    const { options, controller } = createController();
    controller.handleTerminalInput("tab-1", "\r");
    expect(options.write).toHaveBeenCalledWith("tab-1", "\r");
    expect(controller.pendingTerminalPaste.value).toBeNull();
  });

  it("多行内容等待确认并原样保留，确认后按粘贴语义发送", () => {
    const { options, controller } = createController();
    const text = "  echo a \r\necho b\n\n";

    controller.requestTerminalPaste("tab-1", text);
    expect(options.write).not.toHaveBeenCalled();
    expect(controller.pendingTerminalPaste.value).toMatchObject({
      tabId: "tab-1",
      text,
      lineCount: 4,
    });

    controller.confirmTerminalPaste();
    expect(options.paste).toHaveBeenCalledWith("tab-1", text);
    expect(options.focus).toHaveBeenCalledWith("tab-1");
    expect(controller.pendingTerminalPaste.value).toBeNull();
  });

  it("确认粘贴时 xterm 同步回调的输入不会再次弹出确认", () => {
    const { options, controller } = createController();
    options.paste.mockImplementation((tabId: string, text: string) => {
      controller.handleTerminalInput(tabId, text);
    });

    controller.requestTerminalPaste("tab-1", "a\nb");
    controller.confirmTerminalPaste();

    expect(options.write).toHaveBeenCalledWith("tab-1", "a\nb");
    expect(controller.pendingTerminalPaste.value).toBeNull();
  });

  it("取消粘贴只清空待确认内容并恢复焦点", () => {
    const { options, controller } = createController();

    controller.requestTerminalPaste("tab-1", "a\nb");
    controller.cancelTerminalPaste();

    expect(options.paste).not.toHaveBeenCalled();
    expect(options.focus).toHaveBeenCalledWith("tab-1");
    expect(controller.pendingTerminalPaste.value).toBeNull();
  });

  it("捕获阶段拦截多行粘贴，单行粘贴交给 xterm 默认处理", () => {
    const host = document.createElement("div");
    const requestPaste = vi.fn();
    const listener = attachMultilinePasteListener(host, "tab-1", requestPaste);

    const createPasteEvent = (text: string) => {
      const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
      return event;
    };

    const singleLine = createPasteEvent("ls -la");
    host.dispatchEvent(singleLine);
    expect(singleLine.defaultPrevented).toBe(false);
    expect(requestPaste).not.toHaveBeenCalled();

    const multiLine = createPasteEvent("ls\npwd");
    host.dispatchEvent(multiLine);
    expect(multiLine.defaultPrevented).toBe(true);
    expect(requestPaste).toHaveBeenCalledWith("tab-1", "ls\npwd");

    listener.dispose();
    host.dispatchEvent(createPasteEvent("a\nb"));
    expect(requestPaste).toHaveBeenCalledTimes(1);
  });
});
