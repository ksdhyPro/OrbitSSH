import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// 选区背景色由调用方传入，便于在设置变更时通过 compartment.reconfigure 重建主题。
export function createFileEditorTheme(selectionBackground: string): Extension {
  return EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "#0b0f14",
      color: "#d8e2f0",
      caretColor: "#ffffff",
      fontSize: "13px",
    },
    ".cm-scroller": {
      fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
      lineHeight: "20px",
    },
    ".cm-content": {
      minHeight: "100%",
      padding: "12px 0",
    },
    ".cm-line": {
      padding: "0 14px",
    },
    ".cm-gutters": {
      backgroundColor: "#0b0f14",
      borderRight: "1px solid #202633",
      color: "#59677b",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(111, 182, 255, 0.08)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(111, 182, 255, 0.08)",
      color: "#9fb3cc",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: `${selectionBackground} !important`,
      },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#ffffff",
    },
    ".cm-searchMatch": {
      backgroundColor: "#324152",
      outline: "1px solid #52637A",
    },
    ".cm-searchMatch-selected": {
      backgroundColor: "#A87922",
      outline: "1px solid #F0B44C",
    },
    ".cm-panels": {
      display: "none",
    },
  });
}
