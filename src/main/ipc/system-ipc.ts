import { ipcMain } from "electron";
import { getRemoteSystemStats } from "../ssh/session-manager.js";
import type { RemoteSystemStats } from "../ssh/session-manager.js";
import { assertTabAccess, requireNonEmptyString } from "./validation.js";

export type { RemoteSystemStats as SystemStats };

export function registerSystemIpc(): void {
  ipcMain.handle(
    "system:get-stats",
    (event, tabId: unknown): Promise<RemoteSystemStats> => {
      const normalizedTabId = requireNonEmptyString(tabId, "终端标签页 ID");
      assertTabAccess(event, normalizedTabId);

      return getRemoteSystemStats(normalizedTabId);
    },
  );
}
