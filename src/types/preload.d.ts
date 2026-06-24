export {}

import type { LogPayload } from '../shared/logger'
import type { ServerConfig, ServerInput, ServerUpdateInput } from '../shared/server'
import type { AppSettings } from '../shared/settings'
import type { RemoteFileNode, SftpInitResult, SftpListInput } from '../shared/sftp'
import type {
  TerminalDataEvent,
  TerminalOpenResult,
  TerminalResizeInput,
  TerminalStatusEvent
} from '../shared/terminal'

declare global {
  interface Window {
    dockShell: {
      getAppInfo: () => Promise<{ name: string; version: string }>
      logger: {
        write: (payload: LogPayload) => Promise<boolean>
        getPath: () => Promise<string>
      }
      servers: {
        list: () => Promise<ServerConfig[]>
        create: (input: ServerInput) => Promise<ServerConfig>
        update: (input: ServerUpdateInput) => Promise<ServerConfig>
        delete: (serverId: string) => Promise<boolean>
      }
      settings: {
        get: () => Promise<AppSettings>
        save: (settings: AppSettings) => Promise<AppSettings>
      }
      sftp: {
        open: (tabId: string, serverId: string) => Promise<SftpInitResult>
        list: (input: SftpListInput) => Promise<RemoteFileNode[]>
        close: (tabId: string) => Promise<boolean>
      }
      terminals: {
        open: (serverId: string) => Promise<TerminalOpenResult>
        write: (tabId: string, data: string) => Promise<boolean>
        resize: (input: TerminalResizeInput) => Promise<boolean>
        close: (tabId: string) => Promise<boolean>
        onData: (callback: (event: TerminalDataEvent) => void) => () => void
        onStatus: (callback: (event: TerminalStatusEvent) => void) => () => void
      }
      windowControls: {
        minimize: () => Promise<boolean>
        toggleMaximize: () => Promise<boolean>
        close: () => Promise<boolean>
        isMaximized: () => Promise<boolean>
      }
    }
  }
}
