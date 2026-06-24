const { contextBridge, ipcRenderer } = require('electron')

console.log('[DockShell preload] preload 已执行')

const dockShellApi = {
  // 暴露只读应用信息，避免 Renderer 直接访问 Electron/Node。
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  logger: {
    write: (payload) => ipcRenderer.invoke('logger:write', payload),
    getPath: () => ipcRenderer.invoke('logger:get-path')
  },
  servers: {
    list: () => ipcRenderer.invoke('server:list'),
    create: (input) => ipcRenderer.invoke('server:create', input),
    update: (input) => ipcRenderer.invoke('server:update', input),
    delete: (serverId) => ipcRenderer.invoke('server:delete', serverId)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings)
  },
  sftp: {
    open: (tabId, serverId) => ipcRenderer.invoke('sftp:open', tabId, serverId),
    list: (input) => ipcRenderer.invoke('sftp:list', input),
    probeText: (input) => ipcRenderer.invoke('sftp:probe-text', input),
    readText: (input) => ipcRenderer.invoke('sftp:read-text', input),
    writeText: (input) => ipcRenderer.invoke('sftp:write-text', input),
    close: (tabId) => ipcRenderer.invoke('sftp:close', tabId)
  },
  terminals: {
    open: (serverId) => ipcRenderer.invoke('terminal:open', serverId),
    write: (tabId, data) => ipcRenderer.invoke('terminal:write', tabId, data),
    resize: (input) => ipcRenderer.invoke('terminal:resize', input),
    close: (tabId) => ipcRenderer.invoke('terminal:close', tabId),
    onData: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('terminal:status', listener)
      return () => ipcRenderer.removeListener('terminal:status', listener)
    }
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized')
  }
}

contextBridge.exposeInMainWorld('dockShell', dockShellApi)
