import pkg from "electron-updater";
const { autoUpdater } = pkg;
import type { BrowserWindow } from "electron";
import { app } from "electron";

import { getSettings, saveSettings } from "../storage/settings-store.js";
import { writeAppLog } from "../logger.js";
import type { UpdateStatusInfo, UpdateStatus } from "../../shared/settings.js";

let currentStatus: UpdateStatus = "idle";
let currentVersion = app.getVersion();
let newVersion: string | undefined;
let releaseDate: string | undefined;
let releaseNotes: string | undefined;
let downloadProgress = 0;
let lastError: string | undefined;

function buildStatusInfo(): UpdateStatusInfo {
  return {
    status: currentStatus,
    currentVersion,
    newVersion,
    releaseDate,
    releaseNotes: releaseNotes
      ? typeof releaseNotes === "string"
        ? releaseNotes.slice(0, 500)
        : String(releaseNotes).slice(0, 500)
      : undefined,
    downloadProgress,
    error: lastError,
  };
}

function sendStatus(mainWindow: BrowserWindow): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:status-changed", buildStatusInfo());
  }
}

function applyFeedUrl(): void {
  const settings = getSettings();
  const customUrl = settings.update?.updateFeedUrl;
  if (customUrl && customUrl.trim().length > 0) {
    writeAppLog({
      scope: "main.update",
      message: "使用自定义更新地址",
      data: { url: customUrl },
    });
    autoUpdater.setFeedURL({ provider: "generic", url: customUrl.trim() });
  }
}

export function initUpdateManager(mainWindow: BrowserWindow): void {
  writeAppLog({
    scope: "main.update",
    message: "初始化更新管理器",
    data: { version: currentVersion },
  });

  applyFeedUrl();

  // 只检查更新，不自动下载；下载动作交给 Renderer 的“下载更新”按钮触发。
  autoUpdater.autoDownload = false;

  // 日志输出到文件但不暴露给渲染进程
  autoUpdater.logger = {
    info(message?: string): void {
      writeAppLog({ scope: "main.update", message: message ?? "" });
    },
    warn(message?: string): void {
      writeAppLog({
        scope: "main.update",
        message: message ?? "",
        level: "warn",
      });
    },
    error(message?: string): void {
      writeAppLog({
        scope: "main.update",
        message: message ?? "",
        level: "error",
      });
    },
    debug(_message?: string): void {
      // electron-updater 的 debug 日志很多，忽略以避免刷屏
    },
  };

  autoUpdater.on("checking-for-update", () => {
    currentStatus = "checking";
    lastError = undefined;
    downloadProgress = 0;
    newVersion = undefined;
    releaseDate = undefined;
    releaseNotes = undefined;
    writeAppLog({ scope: "main.update", message: "正在检查更新…" });
    sendStatus(mainWindow);
  });

  autoUpdater.on("update-available", (info) => {
    currentStatus = "update-available";
    newVersion = info.version;
    releaseDate = info.releaseDate;
    // latest.yml 中可自定义 releaseNotes 字段，直接读取
    releaseNotes = (info as unknown as Record<string, unknown>).releaseNotes as
      | string
      | undefined;

    // ---- 自定义字段（latest.yml 可扩展） ----
    // newFeedUrl：下个版本的更新地址变更时，在本版本的 latest.yml 中携带，
    // App 发现新版本后自动写入 settings，后续检查更新就用新地址。
    const rawInfo = info as unknown as Record<string, unknown>;
    const customFeedUrl = rawInfo.newFeedUrl as string | undefined;
    if (customFeedUrl && customFeedUrl.trim().length > 0) {
      try {
        const settings = getSettings();
        settings.update.updateFeedUrl = customFeedUrl.trim();
        saveSettings(settings);
        writeAppLog({
          scope: "main.update",
          message: "latest.yml 携带了新更新地址，已自动保存",
          data: { newFeedUrl: customFeedUrl },
        });
      } catch (err) {
        writeAppLog({
          scope: "main.update",
          message: "自动保存新更新地址失败",
          data: { error: err instanceof Error ? err.message : String(err) },
          level: "warn",
        });
      }
    }

    writeAppLog({
      scope: "main.update",
      message: `发现新版本 ${info.version}`,
      data: { version: info.version, releaseDate: info.releaseDate },
    });
    sendStatus(mainWindow);
  });

  autoUpdater.on("update-not-available", (info) => {
    currentStatus = "update-not-available";
    writeAppLog({
      scope: "main.update",
      message: "已是最新版本",
      data: { version: info.version },
    });
    sendStatus(mainWindow);
  });

  autoUpdater.on("download-progress", (progress) => {
    currentStatus = "downloading";
    downloadProgress = Math.round(progress.percent);
    sendStatus(mainWindow);
  });

  autoUpdater.on("update-downloaded", (info) => {
    currentStatus = "downloaded";
    downloadProgress = 100;
    newVersion = info.version;
    writeAppLog({
      scope: "main.update",
      message: `更新已下载 ${info.version}`,
    });
    sendStatus(mainWindow);
  });

  autoUpdater.on("error", (error) => {
    currentStatus = "error";
    lastError = error.message;
    writeAppLog({
      scope: "main.update",
      message: "更新出错",
      data: { error: error.message },
      level: "error",
    });
    sendStatus(mainWindow);
  });

  // 启动后自动检查一次（静默）
  setTimeout(() => {
    writeAppLog({ scope: "main.update", message: "启动后自动检查更新" });
    // 重新应用 feed URL（用户可能在设置中改了地址但未重启 App）
    applyFeedUrl();
    autoUpdater.checkForUpdates().catch((err) => {
      writeAppLog({
        scope: "main.update",
        message: "自动检查更新失败",
        data: { error: err instanceof Error ? err.message : String(err) },
        level: "warn",
      });
    });
  }, 5000);
}

export function checkForUpdates(): void {
  applyFeedUrl();
  autoUpdater.checkForUpdates().catch((err) => {
    writeAppLog({
      scope: "main.update",
      message: "检查更新失败",
      data: { error: err instanceof Error ? err.message : String(err) },
      level: "error",
    });
  });
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch((err) => {
    writeAppLog({
      scope: "main.update",
      message: "下载更新失败",
      data: { error: err instanceof Error ? err.message : String(err) },
      level: "error",
    });
  });
}

export function quitAndInstall(): void {
  writeAppLog({ scope: "main.update", message: "退出并安装更新" });
  autoUpdater.quitAndInstall();
}

export function getUpdateStatus(): UpdateStatusInfo {
  return buildStatusInfo();
}
