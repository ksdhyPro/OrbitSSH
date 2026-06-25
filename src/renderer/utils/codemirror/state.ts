import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";

import { getFileEditorLanguageExtension } from "./language";

// 把原本内联在 keymap/updateListener 里的运行时状态改为回调注入，
// 让 createFileEditorState 保持纯函数，不依赖任何 Vue 响应式或编辑器域状态。
export interface CreateFileEditorStateOptions {
  content: string;
  fileName: string;
  themeExtension: Extension;
  onSearchShortcut: () => void;
  shouldCloseOnEscape: () => boolean;
  onCloseSearch: () => void;
  onDocChanged: (view: EditorView) => void;
}

export function createFileEditorState(
  options: CreateFileEditorStateOptions,
): EditorState {
  const {
    content,
    fileName,
    themeExtension,
    onSearchShortcut,
    shouldCloseOnEscape,
    onCloseSearch,
    onDocChanged,
  } = options;

  return EditorState.create({
    doc: content,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      getFileEditorLanguageExtension(fileName),
      keymap.of([
        {
          key: "Mod-f",
          run: () => {
            onSearchShortcut();
            return true;
          },
        },
        {
          key: "Escape",
          run: () => {
            if (!shouldCloseOnEscape()) {
              return false;
            }

            onCloseSearch();
            return true;
          },
        },
        ...searchKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      themeExtension,
      EditorView.lineWrapping,
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          onDocChanged(update.view);
        }
      }),
    ],
  });
}
