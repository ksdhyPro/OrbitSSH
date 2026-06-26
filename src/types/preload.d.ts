export {};

import type { SystemStats } from "../main/ipc/system-ipc";
import type { LogPayload } from "../shared/logger";
import type {
  ServerConfig,
  ServerInput,
  ServerUpdateInput,
} from "../shared/server";
import type { AppSettings, UpdateStatusInfo } from "../shared/settings";
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
  SftpReadTextResult,
  SftpRemoteTransferControlInput,
  SftpRemoteTransferInput,
  SftpRemoteTransferProgressEvent,
  SftpRenameInput,
  SftpRemoteTransferResult,
  SftpUploadControlInput,
  SftpUploadInput,
  SftpUploadProgressEvent,
  SftpUploadResult,
  SftpWriteTextInput,
} from "../shared/sftp";
import type {
  TerminalDataEvent,
  TerminalOpenResult,
  TerminalResizeInput,
  TerminalStatusEvent,
} from "../shared/terminal";

declare global {
  interface Window {
    orbitSSH: {
      getAppInfo: () => Promise<{
        name: string;
        version: string;
        platform: string;
      }>;
      logger: {
        write: (payload: LogPayload) => Promise<boolean>;
        getPath: () => Promise<string>;
      };
      dialogs: {
        selectPrivateKey: () => Promise<string | null>;
      };
      clipboard: {
        readText: () => Promise<string>;
        writeText: (text: string) => Promise<boolean>;
      };
      servers: {
        list: () => Promise<ServerConfig[]>;
        create: (input: ServerInput) => Promise<ServerConfig>;
        update: (input: ServerUpdateInput) => Promise<ServerConfig>;
        delete: (serverId: string) => Promise<boolean>;
      };
      settings: {
        get: () => Promise<AppSettings>;
        save: (settings: AppSettings) => Promise<AppSettings>;
      };
      sftp: {
        open: (tabId: string, serverId: string) => Promise<SftpInitResult>;
        list: (input: SftpListInput) => Promise<RemoteFileNode[]>;
        probeText: (input: SftpProbeTextInput) => Promise<SftpProbeTextResult>;
        readText: (input: SftpReadTextInput) => Promise<SftpReadTextResult>;
        previewImage: (
          input: SftpPreviewImageInput,
        ) => Promise<SftpPreviewImageResult>;
        writeText: (input: SftpWriteTextInput) => Promise<boolean>;
        download: (input: SftpDownloadInput) => Promise<SftpDownloadResult>;
        upload: (input: SftpUploadInput) => Promise<SftpUploadResult>;
        remoteTransfer?: (
          input: SftpRemoteTransferInput,
        ) => Promise<SftpRemoteTransferResult>;
        controlUpload: (input: SftpUploadControlInput) => Promise<boolean>;
        controlRemoteTransfer?: (
          input: SftpRemoteTransferControlInput,
        ) => Promise<boolean>;
        controlDownload: (input: SftpDownloadControlInput) => Promise<boolean>;
        delete: (input: SftpDeleteInput) => Promise<boolean>;
        rename: (input: SftpRenameInput) => Promise<boolean>;
        createFile: (input: SftpCreateNodeInput) => Promise<boolean>;
        createDirectory: (input: SftpCreateNodeInput) => Promise<boolean>;
        onDownloadProgress: (
          callback: (event: SftpDownloadProgressEvent) => void,
        ) => () => void;
        onUploadProgress: (
          callback: (event: SftpUploadProgressEvent) => void,
        ) => () => void;
        onRemoteTransferProgress?: (
          callback: (event: SftpRemoteTransferProgressEvent) => void,
        ) => () => void;
        close: (tabId: string) => Promise<boolean>;
      };
      system: {
        getStats: (tabId: string) => Promise<SystemStats>;
      };
      update: {
        check: () => Promise<void>;
        download: () => Promise<void>;
        install: () => Promise<void>;
        getStatus: () => Promise<UpdateStatusInfo>;
        onStatusChanged: (
          callback: (info: UpdateStatusInfo) => void,
        ) => () => void;
      };
      terminals: {
        open: (serverId: string) => Promise<TerminalOpenResult>;
        write: (tabId: string, data: string) => Promise<boolean>;
        resize: (input: TerminalResizeInput) => Promise<boolean>;
        close: (tabId: string) => Promise<boolean>;
        onData: (callback: (event: TerminalDataEvent) => void) => () => void;
        onStatus: (
          callback: (event: TerminalStatusEvent) => void,
        ) => () => void;
      };
      windowControls: {
        minimize: () => Promise<boolean>;
        toggleMaximize: () => Promise<boolean>;
        close: () => Promise<boolean>;
        isMaximized: () => Promise<boolean>;
        isMinimized: () => Promise<boolean>;
      };
    };
  }
}
