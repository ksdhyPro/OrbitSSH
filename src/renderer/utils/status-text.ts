import type { TerminalStatusEvent } from "../../shared/terminal";
import type { DownloadTask } from "../types/download";
import { formatTransferSpeed } from "./format";

export function getStatusText(status: TerminalStatusEvent["status"]): string {
  const statusTextMap: Record<TerminalStatusEvent["status"], string> = {
    connecting: "连接中",
    connected: "已连接",
    disconnected: "已断开",
    error: "错误",
  };

  return statusTextMap[status];
}

export function getDownloadProgressPercent(task: DownloadTask): number {
  if (task.totalBytes <= 0) {
    return task.status === "completed" ? 100 : 0;
  }

  return Math.min(
    Math.round((task.transferredBytes / task.totalBytes) * 100),
    100,
  );
}

export function getDownloadTaskStatusText(task: DownloadTask): string {
  if (task.status === "completed") {
    return "已完成";
  }

  if (task.status === "error") {
    return "失败";
  }

  if (task.status === "canceled") {
    return "已取消";
  }

  if (task.status === "paused") {
    return "已暂停";
  }

  return `${getDownloadProgressPercent(task)}% · ${formatTransferSpeed(task.speedBytesPerSecond)}`;
}
