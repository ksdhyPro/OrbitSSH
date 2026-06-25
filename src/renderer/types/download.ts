import type {
  SftpDownloadProgressEvent,
  SftpUploadProgressEvent,
} from "../../shared/sftp";

export interface DownloadTask {
  taskId: string;
  tabId: string;
  direction: "download" | "upload";
  name: string;
  path: string;
  status: SftpDownloadProgressEvent["status"] | SftpUploadProgressEvent["status"];
  transferredBytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  filePath?: string;
  localPaths?: string[];
  remoteDirectoryPath?: string;
  error?: string;
}
