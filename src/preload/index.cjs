const { contextBridge, ipcRenderer } = require("electron");

console.log("[OrbitSSH preload] preload 已执行");

const orbitSSHApi = {
  // 暴露只读应用信息，避免 Renderer 直接访问 Electron/Node。
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  logger: {
    write: payload => ipcRenderer.invoke("logger:write", payload),
    getPath: () => ipcRenderer.invoke("logger:get-path"),
  },
  dialogs: {
    selectPrivateKey: () => ipcRenderer.invoke("dialog:select-private-key"),
  },
  clipboard: {
    readText: () => ipcRenderer.invoke("clipboard:read-text"),
    writeText: text => ipcRenderer.invoke("clipboard:write-text", text),
  },
  servers: {
    list: () => ipcRenderer.invoke("server:list"),
    create: input => ipcRenderer.invoke("server:create", input),
    update: input => ipcRenderer.invoke("server:update", input),
    setPinned: input => ipcRenderer.invoke("server:set-pinned", input),
    delete: serverId => ipcRenderer.invoke("server:delete", serverId),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: settings => ipcRenderer.invoke("settings:save", settings),
  },
  ai: {
    chat: input => ipcRenderer.invoke("ai:chat", input),
    runApprovedCommand: input =>
      ipcRenderer.invoke("ai:run-approved-command", input),
    rejectCommandApproval: input =>
      ipcRenderer.invoke("ai:reject-command-approval", input),
    cancel: input => ipcRenderer.invoke("ai:cancel", input),
    onStreamChunk: callback => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("ai:stream-chunk", listener);
      return () => ipcRenderer.removeListener("ai:stream-chunk", listener);
    },
    onStreamMessageStart: callback => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("ai:stream-message-start", listener);
      return () =>
        ipcRenderer.removeListener("ai:stream-message-start", listener);
    },
    onCommandCard: callback => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("ai:command-card", listener);
      return () => ipcRenderer.removeListener("ai:command-card", listener);
    },
  },
  sftp: {
    open: (tabId, serverId) => ipcRenderer.invoke("sftp:open", tabId, serverId),
    list: input => ipcRenderer.invoke("sftp:list", input),
    probeText: input => ipcRenderer.invoke("sftp:probe-text", input),
    readText: input => ipcRenderer.invoke("sftp:read-text", input),
    previewImage: input => ipcRenderer.invoke("sftp:preview-image", input),
    writeText: input => ipcRenderer.invoke("sftp:write-text", input),
    download: input => ipcRenderer.invoke("sftp:download", input),
    upload: input => ipcRenderer.invoke("sftp:upload", input),
    remoteTransfer: input => ipcRenderer.invoke("sftp:remote-transfer", input),
    controlUpload: input => ipcRenderer.invoke("sftp:upload-control", input),
    controlRemoteTransfer: input =>
      ipcRenderer.invoke("sftp:remote-transfer-control", input),
    controlDownload: input =>
      ipcRenderer.invoke("sftp:download-control", input),
    delete: input => ipcRenderer.invoke("sftp:delete", input),
    rename: input => ipcRenderer.invoke("sftp:rename", input),
    createFile: input => ipcRenderer.invoke("sftp:create-file", input),
    createDirectory: input => ipcRenderer.invoke("sftp:create-directory", input),
    onDownloadProgress: callback => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("sftp:download-progress", listener);
      return () =>
        ipcRenderer.removeListener("sftp:download-progress", listener);
    },
    onUploadProgress: callback => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("sftp:upload-progress", listener);
      return () =>
        ipcRenderer.removeListener("sftp:upload-progress", listener);
    },
    onRemoteTransferProgress: callback => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("sftp:remote-transfer-progress", listener);
      return () =>
        ipcRenderer.removeListener("sftp:remote-transfer-progress", listener);
    },
    close: tabId => ipcRenderer.invoke("sftp:close", tabId),
  },
  terminals: {
    open: serverId => ipcRenderer.invoke("terminal:open", serverId),
    openLocal: () => ipcRenderer.invoke("terminal:open-local"),
    write: (tabId, data) => ipcRenderer.invoke("terminal:write", tabId, data),
    resize: input => ipcRenderer.invoke("terminal:resize", input),
    close: tabId => ipcRenderer.invoke("terminal:close", tabId),
    reconnect: (tabId, serverId) =>
      ipcRenderer.invoke("terminal:reconnect", tabId, serverId),
    onData: callback => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("terminal:data", listener);
      return () => ipcRenderer.removeListener("terminal:data", listener);
    },
    onStatus: callback => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("terminal:status", listener);
      return () => ipcRenderer.removeListener("terminal:status", listener);
    },
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    isMinimized: () => ipcRenderer.invoke("window:is-minimized"),
    isFullScreen: () => ipcRenderer.invoke("window:is-full-screen"),
    onFullScreenChanged: callback => {
      const listener = (_event, fullScreen) => callback(fullScreen);
      ipcRenderer.on("window:fullscreen-changed", listener);
      return () =>
        ipcRenderer.removeListener("window:fullscreen-changed", listener);
    },
  },
  system: {
    getStats: (tabId) => ipcRenderer.invoke("system:get-stats", tabId),
  },
  update: {
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    getStatus: () => ipcRenderer.invoke("update:get-status"),
    onStatusChanged: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("update:status-changed", listener);
      return () =>
        ipcRenderer.removeListener("update:status-changed", listener);
    },
  },
  appMenu: {
    onAction: callback => {
      const listener = (_event, action) => callback(action);
      ipcRenderer.on("app-menu:action", listener);
      return () => ipcRenderer.removeListener("app-menu:action", listener);
    },
  },
};

contextBridge.exposeInMainWorld("orbitSSH", orbitSSHApi);
