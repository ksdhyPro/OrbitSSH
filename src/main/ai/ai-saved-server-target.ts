import type { AiCommandTargetServer } from "../../shared/ai.js";
import type { ServerConfig } from "../../shared/server.js";

export interface SavedServerTarget extends AiCommandTargetServer {
  id: string;
}

type SavedServerCandidate = Pick<ServerConfig, "id" | "name" | "host" | "port" | "username">;

function normalizeServerReference(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "").replace(/服务器|server/g, "");
}

function toTarget(server: SavedServerCandidate): SavedServerTarget {
  return {
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
  };
}

export function formatSavedServerTarget(target: AiCommandTargetServer): string {
  return `${target.name}（${target.username}@${target.host}:${target.port}）`;
}

function describeCandidates(servers: SavedServerCandidate[]): string {
  return servers.map(server => formatSavedServerTarget(server)).join("、");
}

/**
 * 把模型给出的服务器名称解析为唯一的已保存连接。
 * 名称、主机或 主机:端口 完全一致时优先；没有完全匹配才按名称包含关系模糊匹配，
 * 多个候选时拒绝执行并要求使用完整名称，避免批准的目标与实际执行目标不一致。
 */
export function resolveSavedServerTarget(
  reference: string,
  servers: SavedServerCandidate[],
): SavedServerTarget {
  const normalizedReference = normalizeServerReference(reference);
  if (!normalizedReference) {
    throw new Error("服务器名称不能为空");
  }

  const exactMatches = servers.filter(server =>
    normalizeServerReference(server.name) === normalizedReference ||
    normalizeServerReference(server.host) === normalizedReference ||
    normalizeServerReference(`${server.host}:${server.port}`) === normalizedReference,
  );
  if (exactMatches.length === 1) return toTarget(exactMatches[0]!);
  if (exactMatches.length > 1) {
    throw new Error(
      `服务器“${reference}”匹配多个连接：${describeCandidates(exactMatches)}，请使用完整名称`,
    );
  }

  const fuzzyMatches = servers.filter(server =>
    normalizeServerReference(server.name).includes(normalizedReference),
  );
  if (fuzzyMatches.length === 1) return toTarget(fuzzyMatches[0]!);
  if (fuzzyMatches.length > 1) {
    throw new Error(
      `服务器“${reference}”匹配多个连接：${describeCandidates(fuzzyMatches)}，请使用完整名称`,
    );
  }
  throw new Error(`未找到已保存的服务器“${reference}”`);
}

/** 审批后服务器地址或账号被修改时不再执行，避免批准的目标与实际连接不一致。 */
export function assertSavedServerTargetUnchanged(
  target: SavedServerTarget,
  current: SavedServerCandidate,
): void {
  if (
    current.host !== target.host ||
    current.port !== target.port ||
    current.username !== target.username
  ) {
    throw new Error("目标服务器的地址或账号在审批后已被修改，请重新发起请求");
  }
}
