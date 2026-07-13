import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } from "electron";
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
import { registerAiIpc } from "./ipc/ai-ipc.js";
import { initUpdateManager } from "./update/index.js";
import { writeAppLog } from "./logger.js";
import { closeAllSftpSessions } from "./sftp/sftp-manager.js";
import { closeAllTerminalSessions } from "./ssh/session-manager.js";
import type { AppMenuAction } from "../shared/app-menu.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let hasCleanedUpConnections = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

// Windows: 确保任务栏图标正确、通知分组正确（需在 app.whenReady 之前设置）
if (process.platform === "win32") {
  app.setAppUserModelId("com.orbitssh.app");
}

// 获取托盘图标路径，优先使用 Windows ico，其他平台使用现有 png 资源兜底。
function getTrayIconPath(): string {
  const iconFile = process.platform === "win32" ? "icon.ico" : "logo.png";
  return path.join(__dirname, "../../build", iconFile);
}

// 统一清理连接资源，避免托盘退出和窗口退出重复执行。
function cleanupConnections(): void {
  if (hasCleanedUpConnections) {
    return;
  }

  hasCleanedUpConnections = true;
  writeAppLog({
    scope: "main.app",
    message: "应用退出，开始清理连接",
  });
  closeAllTerminalSessions();
  void closeAllSftpSessions();
}

// 恢复并聚焦已有主窗口，供托盘和重复启动事件复用。
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

// 创建系统托盘，单击时恢复主窗口，右键菜单保留彻底关闭入口。
function createTray(): void {
  if (tray) {
    return;
  }

  const trayIcon = nativeImage.createFromPath(getTrayIconPath());

  tray = new Tray(trayIcon);
  tray.setToolTip("OrbitSSH");

  tray.on("click", showMainWindow);

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "关闭",
        click: () => {
          isQuitting = true;
          cleanupConnections();
          app.quit();
        },
      },
    ]),
  );
}

// 拦截普通窗口关闭行为，改为隐藏到系统托盘。
function registerCloseToTray(mainWindow: BrowserWindow): void {
  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow.hide();
  });
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
          label: "文件传输",
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
  registerAiIpc();
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // 再次启动应用时不创建新实例，直接唤醒首个实例的主窗口。
  app.on("second-instance", showMainWindow);

  app.whenReady().then(() => {
    writeAppLog({
      scope: "main.app",
      message: "应用 ready",
    });
    registerBaseIpc();
    mainWindow = createMainWindow();
    registerCloseToTray(mainWindow);
    createTray();
    registerMacApplicationMenu(mainWindow);
    initUpdateManager(mainWindow);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        registerCloseToTray(mainWindow);
        registerMacApplicationMenu(mainWindow);
      } else {
        showMainWindow();
      }
    });
  });
}

app.on("before-quit", () => {
  isQuitting = true;
  cleanupConnections();
});

app.on("window-all-closed", () => {
  cleanupConnections();

  if (process.platform !== "darwin") {
    app.quit();
  }
});
