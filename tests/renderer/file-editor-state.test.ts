import { keymap, type EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import { createFileEditorState } from "../../src/renderer/utils/codemirror/state";

function createState(content: string) {
  const onSaveShortcut = vi.fn();
  const state = createFileEditorState({
    content,
    fileName: "nginx.conf",
    themeExtension: [],
    onSaveShortcut,
    onSearchShortcut: vi.fn(),
    shouldCloseOnEscape: () => false,
    onCloseSearch: vi.fn(),
    onDocChanged: vi.fn(),
  });
  return { state, onSaveShortcut };
}

describe("远程文件编辑器状态", () => {
  it("Mod-s 触发保存回调并阻止浏览器默认行为", () => {
    const { state, onSaveShortcut } = createState("server {}");
    const binding = state
      .facet(keymap)
      .flat()
      .find(item => item.key === "Mod-s");

    expect(binding).toBeDefined();
    // 返回 true 表示 CodeMirror 已处理按键，会对原生事件调用 preventDefault。
    expect(binding!.run!({} as EditorView)).toBe(true);
    expect(onSaveShortcut).toHaveBeenCalledTimes(1);
  });

  it("首次加载 CRLF 内容时光标定位到规范化后的文档末尾", () => {
    const { state } = createState("line1\r\nline2\rline3\r\n");

    expect(state.doc.length).toBe("line1\nline2\nline3\n".length);
    expect(state.selection.main.anchor).toBe(state.doc.length);
  });
});
