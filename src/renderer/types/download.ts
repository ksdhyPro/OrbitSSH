import type { SftpDownloadProgressEvent } from "../../shared/sftp";

export interface DownloadTask {
  taskId: string;
  tabId: string;
  name: string;
  path: string;
  status: SftpDownloadProgressEvent["status"];
  transferredBytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  filePath?: string;
  error?: string;
}
