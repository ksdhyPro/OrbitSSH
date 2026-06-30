import { app } from "electron";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { LogLevel, LogPayload } from "../shared/logger.js";

// ---------- 日志轮转配置 ----------

/** 单个日志文件最大体积（字节），默认 10 MB */
const MAX_LOG_SIZE = 10 * 1024 * 1024;

/** 保留的历史日志文件数量上限 */
const MAX_LOG_FILES = 10;

const LOG_FILE_NAME = "orbitssh.log";
let consoleEncodingConfigured = false;
const SENSITIVE_KEY_PATTERN =
  /(password|passphrase|api[_-]?key|token|secret|authorization|private[_-]?key)/i;
const MAX_LOG_REDACT_DEPTH = 6;

// ---------- 日志目录计算 ----------

/**
 * 获取日志写入目录。
 * - 生产环境（打包后）：安装目录下的 logs/
 * - 开发环境：用户数据目录下的 logs/（避免污染项目目录）
 */
function getLogDir(): string {
  if (app.isPackaged) {
    // 打包后 process.resourcesPath = <安装目录>/resources
    return path.join(path.dirname(process.resourcesPath), "logs");
  }
  // 开发环境仍沿用 userData/logs
  return path.join(app.getPath("userData"), "logs");
}

function getLogFilePath(): string {
  return path.join(getLogDir(), LOG_FILE_NAME);
}

// ---------- 日志轮转 ----------

let logDirEnsured = false;
let currentLogSize = 0;

/** 确保日志目录存在，并探测当前日志文件体积（用于后续轮转判断） */
function ensureLogDir(): string {
  if (logDirEnsured) {
    return getLogDir();
  }

  const dir = getLogDir();
  fs.mkdirSync(dir, { recursive: true });

  // 记录当前日志文件已有体积，避免启动后立刻在已超限的文件上追加
  const logPath = path.join(dir, LOG_FILE_NAME);
  try {
    const stat = fs.statSync(logPath);
    currentLogSize = stat.size;
  } catch {
    currentLogSize = 0;
  }

  logDirEnsured = true;
  return dir;
}

/**
 * 将当前日志文件重命名为带时间戳的历史文件，清空当前日志。
 */
function rotateLog(dir: string): void {
  const logPath = path.join(dir, LOG_FILE_NAME);
  const ts = formatTimestamp(new Date());
  const rotatedName = `orbitssh.${ts}.log`;
  const rotatedPath = path.join(dir, rotatedName);

  try {
    fs.renameSync(logPath, rotatedPath);
  } catch {
    // rename 失败（可能文件已被移除），忽略，直接写新文件
  }

  currentLogSize = 0;
  pruneOldLogs(dir);
}

/** 生成时间戳字符串 yyyyMMdd-HHmmss */
function formatTimestamp(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}${mo}${day}-${h}${mi}${s}`;
}

/** 删除超出数量上限的旧日志（按文件名排序，保留最近的 MAX_LOG_FILES 个） */
function pruneOldLogs(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("orbitssh.") && f.endsWith(".log"))
      .sort(); // 按时间戳排序（文件名天然有序）

    while (files.length > MAX_LOG_FILES) {
      const oldest = files.shift()!;
      fs.unlinkSync(path.join(dir, oldest));
    }
  } catch {
    // 清理失败不阻塞日志写入
  }
}

// ---------- 控制台编码 ----------

function configureConsoleEncoding(): void {
  if (consoleEncodingConfigured || process.platform !== "win32") {
    return;
  }

  consoleEncodingConfigured = true;
  process.stdout.setDefaultEncoding("utf8");
  process.stderr.setDefaultEncoding("utf8");

  try {
    execFileSync("chcp.com", ["65001"], { stdio: "ignore" });
  } catch {
    // GUI 启动时可能没有挂载控制台，忽略
  }
}

// ---------- 日志写入 ----------

function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_LOG_REDACT_DEPTH) {
    return "[MaxDepth]";
  }

  if (Array.isArray(value)) {
    return value.map(item => redactLogValue(item, depth + 1));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }

    result[key] = redactLogValue(item, depth + 1);
  }

  return result;
}

function serializeData(data?: Record<string, unknown>): string {
  if (!data) {
    return "";
  }

  try {
    return ` ${JSON.stringify(redactLogValue(data))}`;
  } catch {
    return ' {"serializeError":"日志数据序列化失败"}';
  }
}

function writeLogLine(
  level: LogLevel,
  scope: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  configureConsoleEncoding();

  const dir = ensureLogDir();
  const logPath = path.join(dir, LOG_FILE_NAME);
  const logLine = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${message}${serializeData(data)}`;
  const lineBytes = Buffer.byteLength(logLine + "\n", "utf8");

  // 超过大小限制时轮转
  if (currentLogSize + lineBytes > MAX_LOG_SIZE) {
    rotateLog(dir);
  }

  try {
    fs.appendFileSync(logPath, `${logLine}\n`, "utf8");
    currentLogSize += lineBytes;
  } catch {
    // 写入失败（权限、磁盘满等）静默丢失，不阻塞业务
  }

  // 控制台输出
  if (level === "error") {
    console.error(logLine);
  } else if (level === "warn") {
    console.warn(logLine);
  } else {
    console.log(logLine);
  }
}

/** 统一写日志入口。 */
export function writeAppLog(payload: LogPayload): void {
  writeLogLine(
    payload.level ?? "info",
    payload.scope,
    payload.message,
    payload.data,
  );
}

/** 返回当前日志文件的完整路径。 */
export function getAppLogPath(): string {
  return getLogFilePath();
}

/** 返回日志目录路径。 */
export function getAppLogDir(): string {
  return getLogDir();
}
