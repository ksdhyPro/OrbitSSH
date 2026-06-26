import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { registerLoggerIpc } from "./ipc/logger-ipc.js";
import { registerClipboardIpc } from "./ipc/clipboard-ipc.js";
import { registerDialogIpc } from "./ipc/dialog-ipc.js";
import { registerServerIpc } from "./ipc/server-ipc.js";
import { registerSettingsIpc } from "./ipc/settings-ipc.js";
import { registerSftpIpc } from "./ipc/sftp-ipc.js";
import { registerTerminalIpc } from "./ipc/terminal-ipc.js";
import { registerSystemIpc } from "./ipc/system-ipc.js";
import { registerWindowIpc } from "./ipc/window-ipc.js";
import { writeAppLog } from "./logger.js";
import { closeAllSftpSessions } from "./sftp/sftp-manager.js";
import { closeAllTerminalSessions } from "./ssh/session-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

// Windows: 确保任务栏图标正确、通知分组正确（需在 app.whenReady 之前设置）
if (process.platform === "win32") {
  app.setAppUserModelId("com.orbitssh.app");
}

// 创建主窗口，并统一约束 Renderer 的系统访问能力。
function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, "../preload/index.cjs");
  writeAppLog({
    scope: "main.window",
    message: "创建主窗口",
    data: {
      isDev,
      preloadPath,
    },
  });

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    title: "OrbitSSH",
    frame: false,
    backgroundColor: "#101216",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    writeAppLog({
      scope: "main.window",
      message: "加载开发地址",
      data: { url: process.env.VITE_DEV_SERVER_URL },
    });
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    });
  } else {
    const rendererPath = path.join(__dirname, "../../dist/index.html");
    writeAppLog({
      scope: "main.window",
      message: "加载构建页面",
      data: { rendererPath },
    });
    void mainWindow.loadFile(rendererPath);
  }

  return mainWindow;
}

// 注册基础 IPC，后续 SSH/SFTP 能力只能通过这里扩展。
function registerBaseIpc(): void {
  registerLoggerIpc();
  registerClipboardIpc();
  registerDialogIpc();

  ipcMain.handle("app:get-info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
  }));

  registerServerIpc();
  registerSettingsIpc();
  registerSftpIpc();
  registerTerminalIpc();
  registerSystemIpc();
  registerWindowIpc();
}

app.whenReady().then(() => {
  writeAppLog({
    scope: "main.app",
    message: "应用 ready",
  });
  registerBaseIpc();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  writeAppLog({
    scope: "main.app",
    message: "窗口全部关闭，开始清理连接",
  });
  closeAllTerminalSessions();
  void closeAllSftpSessions();

  if (process.platform !== "darwin") {
    app.quit();
  }
});
