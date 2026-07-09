import type {
  SftpDownloadProgressEvent,
  SftpRemoteTransferProgressEvent,
  SftpUploadProgressEvent,
} from "../../shared/sftp";

export interface DownloadTask {
  taskId: string;
  tabId: string;
  direction: "download" | "upload" | "server-transfer";
  name: string;
  path: string;
  status:
    | SftpDownloadProgressEvent["status"]
    | SftpUploadProgressEvent["status"]
    | SftpRemoteTransferProgressEvent["status"];
  transferredBytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  sourceServerId?: string;
  targetServerId?: string;
  transferPhase?: SftpRemoteTransferProgressEvent["phase"];
  filePath?: string;
  localPaths?: string[];
  remoteDirectoryPath?: string;
  uploadEntryCount?: number;
  uploadedEntryCount?: number;
  currentUploadPath?: string;
  currentUploadType?: SftpUploadProgressEvent["currentUploadType"];
  targetDirectoryPath?: string;
  error?: string;
}
