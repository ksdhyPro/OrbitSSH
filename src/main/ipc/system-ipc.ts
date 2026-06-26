import { ipcMain } from "electron";
import { getRemoteSystemStats } from "../ssh/session-manager.js";
import type { RemoteSystemStats } from "../ssh/session-manager.js";

export type { RemoteSystemStats as SystemStats };

export function registerSystemIpc(): void {
  ipcMain.handle(
    "system:get-stats",
    (_event, tabId: string): Promise<RemoteSystemStats> => {
      return getRemoteSystemStats(tabId);
    },
  );
}
