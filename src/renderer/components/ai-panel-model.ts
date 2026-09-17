import type { AiCommandCard, AiCommandStatus } from "../../shared/ai";

export type AiPanelMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: number;
  completedAt?: number;
};

export type ProcessTimelineItem = {
  type: "card";
  id: string;
  createdAt: number;
  card: AiCommandCard;
};

export type DisplayTimelineItem =
  | { type: "message"; id: string; createdAt: number; message: AiPanelMessage; streaming: boolean }
  | { type: "process"; id: string; createdAt: number; items: ProcessTimelineItem[]; durationMs: number | null; running: boolean };

export const statusLabels: Record<AiCommandStatus, string> = {
  suggested: "建议命令",
  pending: "待执行",
  running: "执行中",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已终止",
  requires_approval: "等待批准",
  rejected: "已拒绝",
};

export function getCommandAuditText(card: AiCommandCard): string {
  if (card.status === "requires_approval") return "请求批准";
  if (card.status === "running") return "处理中";
  if (card.status === "rejected") return "已拒绝";
  if (card.status === "cancelled") return "已终止";
  if (card.status === "completed" || card.status === "failed") {
    return card.approvalId ? "已批准" : "自动审批";
  }
  return "待处理";
}

export function getProcessSummary(items: ProcessTimelineItem[]): string {
  const runningCount = items.filter(item => item.card.status === "running").length;
  const failedCount = items.filter(item => item.card.status === "failed").length;
  const rejectedCount = items.filter(item => item.card.status === "rejected").length;
  const cancelledCount = items.filter(item => item.card.status === "cancelled").length;
  if (runningCount > 0) return `执行过程：${items.length} 条命令，正在处理`;
  if (failedCount > 0 || rejectedCount > 0 || cancelledCount > 0) {
    return `执行过程：${items.length} 条命令，${failedCount} 条失败，${cancelledCount} 条终止，${rejectedCount} 条已拒绝`;
  }
  return items.length > 0
    ? `执行过程：${items.length} 条命令已完成`
    : "执行过程";
}

export function getProcessItemTitle(item: ProcessTimelineItem): string {
  return `${getCommandAuditText(item.card)} · ${statusLabels[item.card.status]}`;
}

export function getProcessDurationText(
  item: Extract<DisplayTimelineItem, { type: "process" }>,
): string | null {
  if (item.running) return "执行中";
  return typeof item.durationMs === "number"
    ? `用时 ${formatDuration(item.durationMs)}`
    : null;
}

/** 把毫秒格式化为便于浏览的累计耗时。 */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "未知";
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}分钟${seconds}秒` : `${totalMinutes}分钟`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0
    ? `${hours}小时${minutes}分钟${seconds}秒`
    : `${hours}小时${seconds}秒`;
}
