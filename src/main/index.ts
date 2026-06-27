import { app, BrowserWindow, Menu, ipcMain } from "electron";
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
import { registerUpdateIpc } from "./ipc/update-ipc.js";
import { initUpdateManager } from "./update/index.js";
import { writeAppLog } from "./logger.js";
import { closeAllSftpSessions } from "./sftp/sftp-manager.js";
import { closeAllTerminalSessions } from "./ssh/session-manager.js";
import type { AppMenuAction } from "../shared/app-menu.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

// Windows: 确保任务栏图标正确、通知分组正确（需在 app.whenReady 之前设置）
if (process.platform === "win32") {
  app.setAppUserModelId("com.orbitssh.app");
}

function sendAppMenuAction(
  fallbackWindow: BrowserWindow,
  action: AppMenuAction,
): void {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? fallbackWindow;

  if (targetWindow.isDestroyed()) {
    return;
  }

  targetWindow.webContents.send("app-menu:action", action);
}

function registerMacApplicationMenu(mainWindow: BrowserWindow): void {
  if (process.platform !== "darwin") {
    return;
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.getName(),
      submenu: [
        {
          label: `关于 ${app.getName()}`,
          click: () => sendAppMenuAction(mainWindow, "open-about"),
        },
        { type: "separator" },
        {
          label: "设置...",
          accelerator: "CmdOrCtrl+,",
          click: () => sendAppMenuAction(mainWindow, "open-settings"),
        },
        { type: "separator" },
        { role: "services", label: "服务" },
        { type: "separator" },
        { role: "hide", label: `隐藏 ${app.getName()}` },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: `退出 ${app.getName()}` },
      ],
    },
    {
      label: "编辑",
      submenu: [
        {
          label: "撤销",
          accelerator: "CmdOrCtrl+Z",
          click: () => sendAppMenuAction(mainWindow, "undo"),
        },
        {
          label: "重做",
          accelerator: "Shift+CmdOrCtrl+Z",
          click: () => sendAppMenuAction(mainWindow, "redo"),
        },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "工具",
      submenu: [
        {
          label: "数据传输",
          click: () => sendAppMenuAction(mainWindow, "open-data-transfer"),
        },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        { role: "togglefullscreen", label: "进入/退出全屏幕" },
        { type: "separator" },
        { role: "front", label: "全部置于前面" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: `关于 ${app.getName()}`,
          click: () => sendAppMenuAction(mainWindow, "open-about"),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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

  mainWindow.on("enter-full-screen", () => {
    mainWindow.webContents.send("window:fullscreen-changed", true);
  });

  mainWindow.on("leave-full-screen", () => {
    mainWindow.webContents.send("window:fullscreen-changed", false);
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
  registerUpdateIpc();
}

app.whenReady().then(() => {
  writeAppLog({
    scope: "main.app",
    message: "应用 ready",
  });
  registerBaseIpc();
  const mainWindow = createMainWindow();
  registerMacApplicationMenu(mainWindow);
  initUpdateManager(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const activatedWindow = createMainWindow();
      registerMacApplicationMenu(activatedWindow);
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
