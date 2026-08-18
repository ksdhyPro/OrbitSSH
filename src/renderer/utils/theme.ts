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
      background: "#101112",
      foreground: "#d8e2f0",
      cursor: "#ffffff",
      black: "#101112",
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
      activeLineBackground: "rgba(255, 255, 255, 0.055)",
      activeLineForeground: "#9fb3cc",
      searchMatchBackground: "#324152",
      searchMatchBorder: "#52637a",
      activeSearchMatchBackground: "#a87922",
      activeSearchMatchBorder: "#f0b44c",
    },
  },
  light: {
    terminal: {
      background: "#faf9f6",
      foreground: "#242426",
      cursor: "#1c1c1e",
      black: "#1c1c1e",
      red: "#c9342f",
      green: "#248a3d",
      yellow: "#946200",
      blue: "#2968b0",
      magenta: "#8944ab",
      cyan: "#087e8b",
      white: "#e5e5ea",
      brightBlack: "#6e6e73",
      brightRed: "#dc4c45",
      brightGreen: "#2f9b49",
      brightYellow: "#ad7400",
      brightBlue: "#3478c5",
      brightMagenta: "#9c55ba",
      brightCyan: "#15909e",
      brightWhite: "#ffffff",
    },
    terminalSearchDecorations: {
      matchBackground: "rgba(255, 214, 10, 0.28)",
      matchBorder: "rgba(148, 98, 0, 0.48)",
      matchOverviewRuler: "#ad7400",
      activeMatchBackground: "rgba(255, 159, 10, 0.38)",
      activeMatchBorder: "#ad6400",
      activeMatchColorOverviewRuler: "#ad6400",
    },
    editor: {
      background: "#ffffff",
      foreground: "#242426",
      cursor: "#1c1c1e",
      gutterBackground: "#f7f7f8",
      gutterBorder: "#d9d9de",
      gutterForeground: "#8e8e93",
      activeLineBackground: "rgba(60, 60, 67, 0.055)",
      activeLineForeground: "#48484a",
      searchMatchBackground: "rgba(255, 214, 10, 0.28)",
      searchMatchBorder: "rgba(148, 98, 0, 0.48)",
      activeSearchMatchBackground: "rgba(255, 159, 10, 0.38)",
      activeSearchMatchBorder: "#ad6400",
    },
  },
};

// 深色设置中的高饱和选区色在白底上过重，浅色模式统一降低为半透明覆盖层。
export function getThemeSelectionBackground(
  themeMode: AppThemeMode,
  selectionBackground: string,
): string {
  if (themeMode === "dark") {
    return selectionBackground;
  }

  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(
    selectionBackground,
  );
  if (!match) {
    return "rgba(99, 99, 102, 0.2)";
  }

  const [, red, green, blue] = match;
  return `rgba(${Number.parseInt(red, 16)}, ${Number.parseInt(green, 16)}, ${Number.parseInt(blue, 16)}, 0.2)`;
}

export function getTerminalTheme(
  themeMode: AppThemeMode,
  selectionBackground: string,
): ITheme {
  // xterm 的 Canvas 渲染器需要显式 ANSI 16 色，否则部分远端输出会丢失颜色。
  return {
    ...themePalettes[themeMode].terminal,
    selectionBackground: getThemeSelectionBackground(themeMode, selectionBackground),
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
