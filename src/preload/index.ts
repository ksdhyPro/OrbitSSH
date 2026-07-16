import { contextBridge, ipcRenderer } from "electron";

import type { LogPayload } from "../shared/logger.js";
import type {
  LocalDirectoryInput,
  LocalDirectoryResult,
} from "../shared/local-files.js";
import type {
  ServerConfig,
  ServerInput,
  ServerPinInput,
  ServerUpdateInput,
} from "../shared/server.js";
import type { AppSettings, UpdateStatusInfo } from "../shared/settings.js";
import type { AppMenuAction } from "../shared/app-menu.js";
import type {
  RemoteFileNode,
  SftpCreateNodeInput,
  SftpDeleteInput,
  SftpDownloadControlInput,
  SftpDownloadInput,
  SftpDownloadProgressEvent,
  SftpDownloadResult,
  SftpInitResult,
  SftpListInput,
  SftpPreviewImageInput,
  SftpPreviewImageResult,
  SftpProbeTextInput,
  SftpProbeTextResult,
  SftpReadTextInput,
  SftpRenameInput,
  SftpReadTextResult,
  SftpRemoteTransferControlInput,
  SftpRemoteTransferInput,
  SftpRemoteTransferProgressEvent,
  SftpRemoteTransferResult,
  SftpUploadControlInput,
  SftpUploadInput,
  SftpUploadProgressEvent,
  SftpUploadResult,
  SftpWriteTextInput,
} from "../shared/sftp.js";
import type { SystemStats } from "../main/ipc/system-ipc.js";
import type {
  TerminalDataEvent,
  TerminalOpenResult,
  TerminalResizeInput,
  TerminalStatusEvent,
} from "../shared/terminal.js";
import type {
  AiApprovedCommandInput,
  AiCancelInput,
  AiChatInput,
  AiChatResult,
  AiCommandCardEvent,
  AiRejectedCommandInput,
  AiStreamChunkEvent,
  AiStreamMessageStartEvent,
} from "../shared/ai.js";

const orbitSSHApi = {
  // 暴露只读应用信息，避免 Renderer 直接访问 Electron/Node。
  getAppInfo: () =>
    ipcRenderer.invoke("app:get-info") as Promise<{
      name: string;
      version: string;
      platform: string;
    }>,
  logger: {
    write: (payload: LogPayload) =>
      ipcRenderer.invoke("logger:write", payload) as Promise<boolean>,
    getPath: () => ipcRenderer.invoke("logger:get-path") as Promise<string>,
  },
  dialogs: {
    selectPrivateKey: () =>
      ipcRenderer.invoke("dialog:select-private-key") as Promise<string | null>,
  },
  clipboard: {
    readText: () =>
      ipcRenderer.invoke("clipboard:read-text") as Promise<string>,
    writeText: (text: string) =>
      ipcRenderer.invoke("clipboard:write-text", text) as Promise<boolean>,
  },
  localFiles: {
    openDefault: () =>
      ipcRenderer.invoke("local-files:open-default") as Promise<LocalDirectoryResult>,
    list: (input: LocalDirectoryInput) =>
      ipcRenderer.invoke("local-files:list", input) as Promise<LocalDirectoryResult>,
  },
  servers: {
    list: () => ipcRenderer.invoke("server:list") as Promise<ServerConfig[]>,
    create: (input: ServerInput) =>
      ipcRenderer.invoke("server:create", input) as Promise<ServerConfig>,
    update: (input: ServerUpdateInput) =>
      ipcRenderer.invoke("server:update", input) as Promise<ServerConfig>,
    setPinned: (input: ServerPinInput) =>
      ipcRenderer.invoke("server:set-pinned", input) as Promise<ServerConfig>,
    delete: (serverId: string) =>
      ipcRenderer.invoke("server:delete", serverId) as Promise<boolean>,
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
    save: (settings: AppSettings) =>
      ipcRenderer.invoke("settings:save", settings) as Promise<AppSettings>,
  },
  ai: {
    chat: (input: AiChatInput) =>
      ipcRenderer.invoke("ai:chat", input) as Promise<AiChatResult>,
    runApprovedCommand: (input: AiApprovedCommandInput) =>
      ipcRenderer.invoke(
        "ai:run-approved-command",
        input,
      ) as Promise<AiChatResult>,
    rejectCommandApproval: (input: AiRejectedCommandInput) =>
      ipcRenderer.invoke("ai:reject-command-approval", input) as Promise<boolean>,
    cancel: (input: AiCancelInput) =>
      ipcRenderer.invoke("ai:cancel", input) as Promise<boolean>,
    onStreamChunk: (callback: (event: AiStreamChunkEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AiStreamChunkEvent) => callback(payload);
      ipcRenderer.on("ai:stream-chunk", listener);
      return () => ipcRenderer.removeListener("ai:stream-chunk", listener);
    },
    onStreamMessageStart: (
      callback: (event: AiStreamMessageStartEvent) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: AiStreamMessageStartEvent,
      ) => callback(payload);
      ipcRenderer.on("ai:stream-message-start", listener);
      return () =>
        ipcRenderer.removeListener("ai:stream-message-start", listener);
    },
    onCommandCard: (callback: (event: AiCommandCardEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: AiCommandCardEvent,
      ) => callback(payload);
      ipcRenderer.on("ai:command-card", listener);
      return () => ipcRenderer.removeListener("ai:command-card", listener);
    },
  },
  sftp: {
    open: (tabId: string, serverId: string) =>
      ipcRenderer.invoke(
        "sftp:open",
        tabId,
        serverId,
      ) as Promise<SftpInitResult>,
    list: (input: SftpListInput) =>
      ipcRenderer.invoke("sftp:list", input) as Promise<RemoteFileNode[]>,
    probeText: (input: SftpProbeTextInput) =>
      ipcRenderer.invoke(
        "sftp:probe-text",
        input,
      ) as Promise<SftpProbeTextResult>,
    readText: (input: SftpReadTextInput) =>
      ipcRenderer.invoke(
        "sftp:read-text",
        input,
      ) as Promise<SftpReadTextResult>,
    previewImage: (input: SftpPreviewImageInput) =>
      ipcRenderer.invoke(
        "sftp:preview-image",
        input,
      ) as Promise<SftpPreviewImageResult>,
    writeText: (input: SftpWriteTextInput) =>
      ipcRenderer.invoke("sftp:write-text", input) as Promise<boolean>,
    download: (input: SftpDownloadInput) =>
      ipcRenderer.invoke("sftp:download", input) as Promise<SftpDownloadResult>,
    upload: (input: SftpUploadInput) =>
      ipcRenderer.invoke("sftp:upload", input) as Promise<SftpUploadResult>,
    remoteTransfer: (input: SftpRemoteTransferInput) =>
      ipcRenderer.invoke(
        "sftp:remote-transfer",
        input,
      ) as Promise<SftpRemoteTransferResult>,
    controlUpload: (input: SftpUploadControlInput) =>
      ipcRenderer.invoke("sftp:upload-control", input) as Promise<boolean>,
    controlRemoteTransfer: (input: SftpRemoteTransferControlInput) =>
      ipcRenderer.invoke(
        "sftp:remote-transfer-control",
        input,
      ) as Promise<boolean>,
    controlDownload: (input: SftpDownloadControlInput) =>
      ipcRenderer.invoke("sftp:download-control", input) as Promise<boolean>,
    delete: (input: SftpDeleteInput) =>
      ipcRenderer.invoke("sftp:delete", input) as Promise<boolean>,
    rename: (input: SftpRenameInput) =>
      ipcRenderer.invoke("sftp:rename", input) as Promise<boolean>,
    createFile: (input: SftpCreateNodeInput) =>
      ipcRenderer.invoke("sftp:create-file", input) as Promise<boolean>,
    createDirectory: (input: SftpCreateNodeInput) =>
      ipcRenderer.invoke("sftp:create-directory", input) as Promise<boolean>,
    onDownloadProgress: (
      callback: (event: SftpDownloadProgressEvent) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: SftpDownloadProgressEvent,
      ) => callback(payload);
      ipcRenderer.on("sftp:download-progress", listener);
      return () =>
        ipcRenderer.removeListener("sftp:download-progress", listener);
    },
    onUploadProgress: (
      callback: (event: SftpUploadProgressEvent) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: SftpUploadProgressEvent,
      ) => callback(payload);
      ipcRenderer.on("sftp:upload-progress", listener);
      return () =>
        ipcRenderer.removeListener("sftp:upload-progress", listener);
    },
    onRemoteTransferProgress: (
      callback: (event: SftpRemoteTransferProgressEvent) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: SftpRemoteTransferProgressEvent,
      ) => callback(payload);
      ipcRenderer.on("sftp:remote-transfer-progress", listener);
      return () =>
        ipcRenderer.removeListener("sftp:remote-transfer-progress", listener);
    },
    close: (tabId: string) =>
      ipcRenderer.invoke("sftp:close", tabId) as Promise<boolean>,
  },
  terminals: {
    open: (serverId: string) =>
      ipcRenderer.invoke(
        "terminal:open",
        serverId,
      ) as Promise<TerminalOpenResult>,
    openLocal: () =>
      ipcRenderer.invoke("terminal:open-local") as Promise<TerminalOpenResult>,
    write: (tabId: string, data: string) =>
      ipcRenderer.invoke("terminal:write", tabId, data) as Promise<boolean>,
    resize: (input: TerminalResizeInput) =>
      ipcRenderer.invoke("terminal:resize", input) as Promise<boolean>,
    close: (tabId: string) =>
      ipcRenderer.invoke("terminal:close", tabId) as Promise<boolean>,
    reconnect: (tabId: string, serverId: string) =>
      ipcRenderer.invoke(
        "terminal:reconnect",
        tabId,
        serverId,
      ) as Promise<boolean>,
    onData: (callback: (event: TerminalDataEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: TerminalDataEvent,
      ) => callback(payload);
      ipcRenderer.on("terminal:data", listener);
      return () => ipcRenderer.removeListener("terminal:data", listener);
    },
    onStatus: (callback: (event: TerminalStatusEvent) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: TerminalStatusEvent,
      ) => callback(payload);
      ipcRenderer.on("terminal:status", listener);
      return () => ipcRenderer.removeListener("terminal:status", listener);
    },
  },
  system: {
    getStats: (tabId: string) =>
      ipcRenderer.invoke("system:get-stats", tabId) as Promise<SystemStats>,
  },
  update: {
    check: () => ipcRenderer.invoke("update:check") as Promise<void>,
    download: () => ipcRenderer.invoke("update:download") as Promise<void>,
    install: () => ipcRenderer.invoke("update:install") as Promise<void>,
    getStatus: () =>
      ipcRenderer.invoke("update:get-status") as Promise<UpdateStatusInfo>,
    onStatusChanged: (
      callback: (info: UpdateStatusInfo) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: UpdateStatusInfo,
      ) => callback(payload);
      ipcRenderer.on("update:status-changed", listener);
      return () =>
        ipcRenderer.removeListener("update:status-changed", listener);
    },
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke("window:minimize") as Promise<boolean>,
    toggleMaximize: () =>
      ipcRenderer.invoke("window:toggle-maximize") as Promise<boolean>,
    close: () => ipcRenderer.invoke("window:close") as Promise<boolean>,
    isMaximized: () =>
      ipcRenderer.invoke("window:is-maximized") as Promise<boolean>,
    isMinimized: () =>
      ipcRenderer.invoke("window:is-minimized") as Promise<boolean>,
    isFullScreen: () =>
      ipcRenderer.invoke("window:is-full-screen") as Promise<boolean>,
    onFullScreenChanged: (callback: (fullScreen: boolean) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        fullScreen: boolean,
      ) => callback(fullScreen);
      ipcRenderer.on("window:fullscreen-changed", listener);
      return () =>
        ipcRenderer.removeListener("window:fullscreen-changed", listener);
    },
  },
  appMenu: {
    onAction: (callback: (action: AppMenuAction) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        action: AppMenuAction,
      ) => callback(action);
      ipcRenderer.on("app-menu:action", listener);
      return () => ipcRenderer.removeListener("app-menu:action", listener);
    },
  },
};

contextBridge.exposeInMainWorld("orbitSSH", orbitSSHApi);
