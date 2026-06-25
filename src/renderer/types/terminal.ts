import type { CanvasAddon } from "@xterm/addon-canvas";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { IDisposable, Terminal } from "@xterm/xterm";

import type { TerminalStatusEvent } from "../../shared/terminal";

export interface TerminalTab {
  id: string;
  serverId: string;
  title: string;
  status: TerminalStatusEvent["status"];
  currentPath?: string;
  message?: string;
}

export interface TerminalSearchMatch {
  row: number;
  col: number;
  size: number;
}

export interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  searchResultsDisposable: IDisposable;
  canvasAddon?: CanvasAddon;
}

export type TerminalHosts = Map<string, HTMLElement>;
