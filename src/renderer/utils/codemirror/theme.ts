import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { AppThemeMode } from "../../../shared/settings";
import { getEditorThemePalette } from "../theme";

// 选区背景色由调用方传入，便于在设置变更时通过 compartment.reconfigure 重建主题。
export function createFileEditorTheme(
  selectionBackground: string,
  themeMode: AppThemeMode,
): Extension {
  const palette = getEditorThemePalette(themeMode);

  return EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: palette.background,
      color: palette.foreground,
      caretColor: palette.cursor,
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
      backgroundColor: palette.gutterBackground,
      borderRight: `1px solid ${palette.gutterBorder}`,
      color: palette.gutterForeground,
    },
    ".cm-activeLine": {
      backgroundColor: palette.activeLineBackground,
    },
    ".cm-activeLineGutter": {
      backgroundColor: palette.activeLineBackground,
      color: palette.activeLineForeground,
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: `${selectionBackground} !important`,
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: palette.cursor,
    },
    ".cm-searchMatch": {
      backgroundColor: palette.searchMatchBackground,
      outline: `1px solid ${palette.searchMatchBorder}`,
    },
    ".cm-searchMatch-selected": {
      backgroundColor: palette.activeSearchMatchBackground,
      outline: `1px solid ${palette.activeSearchMatchBorder}`,
    },
    ".cm-panels": {
      display: "none",
    },
  });
}
