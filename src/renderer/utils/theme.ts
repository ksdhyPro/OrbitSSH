import type { ITheme } from "@xterm/xterm";
import type { AppThemeMode } from "../../shared/settings";

export interface EditorThemePalette {
  background: string;
  foreground: string;
  cursor: string;
  gutterBackground: string;
  gutterBorder: string;
  gutterForeground: string;
  activeLineBackground: string;
  activeLineForeground: string;
  searchMatchBackground: string;
  searchMatchBorder: string;
  activeSearchMatchBackground: string;
  activeSearchMatchBorder: string;
}

export interface TerminalSearchDecorations {
  matchBackground: string;
  matchBorder: string;
  matchOverviewRuler: string;
  activeMatchBackground: string;
  activeMatchBorder: string;
  activeMatchColorOverviewRuler: string;
}

interface ThemePalette {
  terminal: Omit<ITheme, "selectionBackground">;
  terminalSearchDecorations: TerminalSearchDecorations;
  editor: EditorThemePalette;
}

const themePalettes: Record<AppThemeMode, ThemePalette> = {
  dark: {
    terminal: {
      background: "#0b0f14",
      foreground: "#d8e2f0",
      cursor: "#ffffff",
      black: "#0b0f14",
      red: "#ff6b6b",
      green: "#89dcae",
      yellow: "#f0b44c",
      blue: "#6fb6ff",
      magenta: "#c891d8",
      cyan: "#5fcabe",
      white: "#d8e2f0",
      brightBlack: "#59677b",
      brightRed: "#ff9a9a",
      brightGreen: "#aeebc4",
      brightYellow: "#f5cb7d",
      brightBlue: "#9bc9ff",
      brightMagenta: "#dab0e4",
      brightCyan: "#8eecd9",
      brightWhite: "#ffffff",
    },
    terminalSearchDecorations: {
      matchBackground: "#324152",
      matchBorder: "#52637a",
      matchOverviewRuler: "#52637a",
      activeMatchBackground: "#a87922",
      activeMatchBorder: "#f0b44c",
      activeMatchColorOverviewRuler: "#f0b44c",
    },
    editor: {
      background: "#0b0f14",
      foreground: "#d8e2f0",
      cursor: "#ffffff",
      gutterBackground: "#0b0f14",
      gutterBorder: "#202633",
      gutterForeground: "#59677b",
      activeLineBackground: "rgba(111, 182, 255, 0.08)",
      activeLineForeground: "#9fb3cc",
      searchMatchBackground: "#324152",
      searchMatchBorder: "#52637a",
      activeSearchMatchBackground: "#a87922",
      activeSearchMatchBorder: "#f0b44c",
    },
  },
  light: {
    terminal: {
      background: "#f4f7fb",
      foreground: "#1f2a37",
      cursor: "#1f2a37",
      black: "#1f2a37",
      red: "#c43c32",
      green: "#16794f",
      yellow: "#a66a00",
      blue: "#2568b8",
      magenta: "#8a4ca3",
      cyan: "#197d78",
      white: "#e8eef5",
      brightBlack: "#687b90",
      brightRed: "#e05248",
      brightGreen: "#219464",
      brightYellow: "#c98500",
      brightBlue: "#347dd1",
      brightMagenta: "#a45fbd",
      brightCyan: "#229b93",
      brightWhite: "#ffffff",
    },
    terminalSearchDecorations: {
      matchBackground: "#d8e7f8",
      matchBorder: "#93b7e0",
      matchOverviewRuler: "#93b7e0",
      activeMatchBackground: "#ffe3a3",
      activeMatchBorder: "#c98500",
      activeMatchColorOverviewRuler: "#c98500",
    },
    editor: {
      background: "#f4f7fb",
      foreground: "#1f2a37",
      cursor: "#1f2a37",
      gutterBackground: "#f4f7fb",
      gutterBorder: "#c8d4e1",
      gutterForeground: "#687b90",
      activeLineBackground: "rgba(35, 104, 175, 0.09)",
      activeLineForeground: "#36516d",
      searchMatchBackground: "#d8e7f8",
      searchMatchBorder: "#93b7e0",
      activeSearchMatchBackground: "#ffe3a3",
      activeSearchMatchBorder: "#c98500",
    },
  },
};

export function getTerminalTheme(
  themeMode: AppThemeMode,
  selectionBackground: string,
): ITheme {
  // xterm 的 Canvas 渲染器需要显式 ANSI 16 色，否则部分远端输出会丢失颜色。
  return {
    ...themePalettes[themeMode].terminal,
    selectionBackground,
  };
}

export function getEditorThemePalette(themeMode: AppThemeMode): EditorThemePalette {
  return themePalettes[themeMode].editor;
}

export function getTerminalSearchDecorations(
  themeMode: AppThemeMode,
): TerminalSearchDecorations {
  return themePalettes[themeMode].terminalSearchDecorations;
}
