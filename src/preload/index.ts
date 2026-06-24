import { contextBridge, ipcRenderer } from 'electron'

import type { LogPayload } from '../shared/logger.js'
import type { ServerConfig, ServerInput, ServerUpdateInput } from '../shared/server.js'
import type { AppSettings } from '../shared/settings.js'
import type { RemoteFileNode, SftpInitResult, SftpListInput } from '../shared/sftp.js'
import type {
  TerminalDataEvent,
  TerminalOpenResult,
  TerminalResizeInput,
  TerminalStatusEvent
} from '../shared/terminal.js'

const dockShellApi = {
  // 暴露只读应用信息，避免 Renderer 直接访问 Electron/Node。
  getAppInfo: () => ipcRenderer.invoke('app:get-info') as Promise<{ name: string; version: string }>,
  logger: {
    write: (payload: LogPayload) => ipcRenderer.invoke('logger:write', payload) as Promise<boolean>,
    getPath: () => ipcRenderer.invoke('logger:get-path') as Promise<string>
  },
  servers: {
    list: () => ipcRenderer.invoke('server:list') as Promise<ServerConfig[]>,
    create: (input: ServerInput) => ipcRenderer.invoke('server:create', input) as Promise<ServerConfig>,
    update: (input: ServerUpdateInput) => ipcRenderer.invoke('server:update', input) as Promise<ServerConfig>,
    delete: (serverId: string) => ipcRenderer.invoke('server:delete', serverId) as Promise<boolean>
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
    save: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings) as Promise<AppSettings>
  },
  sftp: {
    open: (tabId: string, serverId: string) =>
      ipcRenderer.invoke('sftp:open', tabId, serverId) as Promise<SftpInitResult>,
    list: (input: SftpListInput) => ipcRenderer.invoke('sftp:list', input) as Promise<RemoteFileNode[]>,
    close: (tabId: string) => ipcRenderer.invoke('sftp:close', tabId) as Promise<boolean>
  },
  terminals: {
    open: (serverId: string) => ipcRenderer.invoke('terminal:open', serverId) as Promise<TerminalOpenResult>,
    write: (tabId: string, data: string) =>
      ipcRenderer.invoke('terminal:write', tabId, data) as Promise<boolean>,
    resize: (input: TerminalResizeInput) => ipcRenderer.invoke('terminal:resize', input) as Promise<boolean>,
    close: (tabId: string) => ipcRenderer.invoke('terminal:close', tabId) as Promise<boolean>,
    onData: (callback: (event: TerminalDataEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent) => callback(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onStatus: (callback: (event: TerminalStatusEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalStatusEvent) => callback(payload)
      ipcRenderer.on('terminal:status', listener)
      return () => ipcRenderer.removeListener('terminal:status', listener)
    }
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<boolean>,
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<boolean>,
    close: () => ipcRenderer.invoke('window:close') as Promise<boolean>,
    isMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>
  }
}

contextBridge.exposeInMainWorld('dockShell', dockShellApi)
