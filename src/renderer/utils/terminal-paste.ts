import { ref } from "vue";

export interface PendingTerminalPaste {
  tabId: string;
  text: string;
  previewText: string;
  lineCount: number;
}

interface TerminalPasteControllerOptions {
  write: (tabId: string, text: string) => void;
  paste: (tabId: string, text: string) => void;
  focus: (tabId: string) => void;
  hasTerminal: (tabId: string) => boolean;
}

export function hasTextLineBreak(text: string): boolean {
  return /\r|\n/.test(text);
}

export function shouldConfirmTerminalData(data: string): boolean {
  // 单个 CR/LF 是用户按下回车，只有批量输入中的换行才视为粘贴。
  return data.length > 1 && hasTextLineBreak(data);
}

export function attachMultilinePasteListener(
  host: HTMLElement,
  tabId: string,
  requestPaste: (tabId: string, text: string) => void,
) {
  const handlePaste = (event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!hasTextLineBreak(text)) {
      return;
    }

    // 在 xterm 处理前截获原始剪贴板文本，避免其规范化换行或附加控制序列。
    event.preventDefault();
    event.stopPropagation();
    requestPaste(tabId, text);
  };

  host.addEventListener("paste", handlePaste, true);
  return {
    dispose: () => host.removeEventListener("paste", handlePaste, true),
  };
}

export function createTerminalPasteController(
  options: TerminalPasteControllerOptions,
) {
  const pendingTerminalPaste = ref<PendingTerminalPaste | null>(null);
  const confirmedPasteTabs = new Set<string>();

  // 多行内容只暂存原文并等待用户确认，不解析或修改任何换行字符。
  function requestTerminalPaste(tabId: string, text: string): void {
    if (!hasTextLineBreak(text)) {
      options.write(tabId, text);
      options.focus(tabId);
      return;
    }

    pendingTerminalPaste.value = {
      tabId,
      text,
      previewText: text
        .replace(/^\x1b\[200~/, "")
        .replace(/\x1b\[201~$/, ""),
      lineCount: text.split(/\r\n|\r|\n/).length,
    };
  }

  function cancelTerminalPaste(): void {
    const tabId = pendingTerminalPaste.value?.tabId;
    pendingTerminalPaste.value = null;
    if (tabId) {
      options.focus(tabId);
    }
  }

  function confirmTerminalPaste(): void {
    const pendingPaste = pendingTerminalPaste.value;
    pendingTerminalPaste.value = null;

    if (!pendingPaste || !options.hasTerminal(pendingPaste.tabId)) {
      return;
    }

    // xterm.paste 会同步回调输入事件，标记该标签以避免确认后再次弹窗。
    confirmedPasteTabs.add(pendingPaste.tabId);
    try {
      options.paste(pendingPaste.tabId, pendingPaste.text);
    } finally {
      confirmedPasteTabs.delete(pendingPaste.tabId);
    }
    options.focus(pendingPaste.tabId);
  }

  function handleTerminalInput(tabId: string, data: string): void {
    if (confirmedPasteTabs.has(tabId)) {
      options.write(tabId, data);
      return;
    }

    if (shouldConfirmTerminalData(data)) {
      requestTerminalPaste(tabId, data);
      return;
    }

    options.write(tabId, data);
  }

  return {
    pendingTerminalPaste,
    requestTerminalPaste,
    cancelTerminalPaste,
    confirmTerminalPaste,
    handleTerminalInput,
  };
}
