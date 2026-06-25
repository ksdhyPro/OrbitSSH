import { contextBridge, ipcRenderer } from "electron";

import type { LogPayload } from "../shared/logger.js";
import type {
  ServerConfig,
  ServerInput,
  ServerUpdateInput,
} from "../shared/server.js";
import type { AppSettings } from "../shared/settings.js";
import type {
  RemoteFileNode,
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
  SftpReadTextResult,
  SftpUploadControlInput,
  SftpUploadInput,
  SftpUploadProgressEvent,
  SftpUploadResult,
  SftpWriteTextInput,
} from "../shared/sftp.js";
import type {
  TerminalDataEvent,
  TerminalOpenResult,
  TerminalResizeInput,
  TerminalStatusEvent,
} from "../shared/terminal.js";

const orbitSSHApi = {
  // 暴露只读应用信息，避免 Renderer 直接访问 Electron/Node。
  getAppInfo: () =>
    ipcRenderer.invoke("app:get-info") as Promise<{
      name: string;
      version: string;
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
  servers: {
    list: () => ipcRenderer.invoke("server:list") as Promise<ServerConfig[]>,
    create: (input: ServerInput) =>
      ipcRenderer.invoke("server:create", input) as Promise<ServerConfig>,
    update: (input: ServerUpdateInput) =>
      ipcRenderer.invoke("server:update", input) as Promise<ServerConfig>,
    delete: (serverId: string) =>
      ipcRenderer.invoke("server:delete", serverId) as Promise<boolean>,
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
    save: (settings: AppSettings) =>
      ipcRenderer.invoke("settings:save", settings) as Promise<AppSettings>,
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
    controlUpload: (input: SftpUploadControlInput) =>
      ipcRenderer.invoke("sftp:upload-control", input) as Promise<boolean>,
    controlDownload: (input: SftpDownloadControlInput) =>
      ipcRenderer.invoke("sftp:download-control", input) as Promise<boolean>,
    delete: (input: SftpDeleteInput) =>
      ipcRenderer.invoke("sftp:delete", input) as Promise<boolean>,
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
    close: (tabId: string) =>
      ipcRenderer.invoke("sftp:close", tabId) as Promise<boolean>,
  },
  terminals: {
    open: (serverId: string) =>
      ipcRenderer.invoke(
        "terminal:open",
        serverId,
      ) as Promise<TerminalOpenResult>,
    write: (tabId: string, data: string) =>
      ipcRenderer.invoke("terminal:write", tabId, data) as Promise<boolean>,
    resize: (input: TerminalResizeInput) =>
      ipcRenderer.invoke("terminal:resize", input) as Promise<boolean>,
    close: (tabId: string) =>
      ipcRenderer.invoke("terminal:close", tabId) as Promise<boolean>,
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
  windowControls: {
    minimize: () => ipcRenderer.invoke("window:minimize") as Promise<boolean>,
    toggleMaximize: () =>
      ipcRenderer.invoke("window:toggle-maximize") as Promise<boolean>,
    close: () => ipcRenderer.invoke("window:close") as Promise<boolean>,
    isMaximized: () =>
      ipcRenderer.invoke("window:is-maximized") as Promise<boolean>,
  },
};

contextBridge.exposeInMainWorld("orbitSSH", orbitSSHApi);
