import { ipcMain } from "electron";

import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  quitAndInstall,
} from "../update/index.js";

export function registerUpdateIpc(): void {
  ipcMain.handle("update:get-status", () => getUpdateStatus());

  ipcMain.handle("update:check", async () => {
    checkForUpdates();
  });

  ipcMain.handle("update:download", async () => {
    downloadUpdate();
  });

  ipcMain.handle("update:install", async () => {
    quitAndInstall();
  });
}
