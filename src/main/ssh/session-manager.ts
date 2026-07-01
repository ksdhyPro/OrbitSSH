import type { WebContents } from "electron";
import { exec, execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import type { IPty } from "@homebridge/node-pty-prebuilt-multiarch";
import { Client, type ClientChannel } from "ssh2";

import { writeAppLog } from "../logger.js";
import { createServerConnectOptions } from "./auth-options.js";
import {
  getIdleDisconnectMs,
  getSshKeepaliveIntervalMs,
} from "./connection-options.js";
import { getServerAuthConfig } from "../storage/server-store.js";
import type {
  TerminalSessionKind,
  TerminalOpenResult,
  TerminalResizeInput,
  TerminalStatusEvent,
} from "../../shared/terminal.js";
import { LOCAL_TERMINAL_SERVER_ID } from "../../shared/terminal.js";
import type { AiCommandResult } from "../../shared/ai.js";

interface BaseTerminalSession {
  tabId: string;
  serverId: string;
  kind: TerminalSessionKind;
  webContents: WebContents;
  status: TerminalStatusEvent["status"];
  lastActiveAt: number;
  outputBuffer: string;
}

interface SshTerminalSession extends BaseTerminalSession {
  kind: "ssh";
  sshClient: Client;
  shellStream?: ClientChannel;
}

interface LocalTerminalSession extends BaseTerminalSession {
  kind: "local";
  cwd: string;
  localPty: IPty;
}

type TerminalSession = SshTerminalSession | LocalTerminalSession;

export interface RemoteSystemStats {
  cpuUsage: number;
  memoryUsage: number;
  memoryUsed: number;
  memoryTotal: number;
  diskFree: number;
  diskTotal: number;
  osType: "linux" | "darwin" | "windows" | "";
  osName: string;
}

interface CachedOSInfo {
  type: "linux" | "darwin" | "windows";
  name: string;
}

interface CpuSample {
  idle: number;
  total: number;
}

const terminalSessions = new Map<string, TerminalSession>();
const remoteOSCache = new Map<string, CachedOSInfo>();
const pathIntegrationInstallDelayMs = 120;
const idleDisconnectCheckIntervalMs = 30_000;
const maxTerminalOutputBufferChars = 12_000;
const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
let localCpuSample: CpuSample | undefined;

// ----- 远端脚本模板 -----

const UNIX_STATS_SCRIPT = [
  "os=$(uname -s 2>/dev/null)",
  "os_name=\"$os\"",
  'if [ "$os" = "Linux" ]; then',
  '  os_name=$(cat /etc/os-release 2>/dev/null | awk -F= \'/^PRETTY_NAME=/ {gsub(/"/,""); print $2}\')',
  '  [ -z "$os_name" ] && os_name="Linux"',
  "  cpu=$(top -bn1 2>/dev/null | awk '/^%Cpu\\(s\\):/ {printf \"%.0f\", 100-$8}')",
  "  [ -z \"$cpu\" ] && cpu=$(awk '{u=$2+$4; t=u+$5} END {printf \"%.0f\", u/t*100}' /proc/stat 2>/dev/null || echo 0)",
  '  mem_line=$(free 2>/dev/null | awk \'/^Mem:/ {printf "%.0f %d %d", $3/$2*100, $3*1024, $2*1024}\')',
  "  set -- $mem_line; mem_pct=${1:-0}; mem_used=${2:-0}; mem_total=${3:-0}",
  "  disk_line=$(df -B1 . 2>/dev/null | awk 'NR==2{print $4, $2}')",
  "  set -- $disk_line; disk_free=${1:-0}; disk_total=${2:-0}",
  'elif [ "$os" = "Darwin" ]; then',
  '  os_ver=$(sw_vers -productVersion 2>/dev/null)',
  '  [ -n "$os_ver" ] && os_name="macOS ${os_ver}" || os_name="macOS"',
  "  cpu=$(top -l 1 -n 0 2>/dev/null | awk '/CPU usage:/ {gsub(/%/,\"\"); printf \"%.0f\", 100-$7}')",
  "  mem_total=$(sysctl -n hw.memsize 2>/dev/null || echo 0)",
  "  pg=$(sysctl -n hw.pagesize 2>/dev/null || echo 16384)",
  "  w=$(vm_stat 2>/dev/null | awk '/wired/ {v=$NF; gsub(/\\./,\"\",v); print v}')",
  "  a=$(vm_stat 2>/dev/null | awk '/^Pages active/ {v=$NF; gsub(/\\./,\"\",v); print v}')",
  "  c=$(vm_stat 2>/dev/null | awk '/compressor/ {v=$NF; gsub(/\\./,\"\",v); print v}')",
  "  mem_used=$(( (${w:-0} + ${a:-0} + ${c:-0}) * pg ))",
  '  mem_pct=$(awk "BEGIN {printf \\"%.0f\\", $mem_used/$mem_total*100}")',
  "  disk_line=$(df -B1 . 2>/dev/null | awk 'NR==2{print $4, $2}')",
  "  set -- $disk_line; disk_free=${1:-0}; disk_total=${2:-0}",
  "fi",
  'printf \'{"cpu":%s,"mem_pct":%s,"mem_used":%s,"mem_total":%s,"disk_free":%s,"disk_total":%s,"os_type":"%s","os_name":"%s"}\\n\' \\',
  '  "$cpu" "$mem_pct" "$mem_used" "$mem_total" "$disk_free" "$disk_total" "$os" "$os_name"',
].join("\n");

const WINDOWS_STATS_SCRIPT = [
  "$cpu=(Get-Counter '\\Processor(_Total)\\% Processor Time' -ErrorAction SilentlyContinue).CounterSamples.CookedValue",
  "$cpu=[math]::Round($cpu)",
  "$os=Get-CIMInstance Win32_OperatingSystem",
  "$osName=$os.Caption -replace 'Microsoft ','-' -replace ' (Enterprise|Pro|Home|Education|Ultimate).*$',''",
  "$memPct=[math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/$os.TotalVisibleMemorySize*100)",
  "$memUsed=($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)*1024",
  "$memTotal=$os.TotalVisibleMemorySize*1024",
  "$drive=(Get-Location).Drive.Name",
  "$disk=Get-PSDrive $drive -ErrorAction SilentlyContinue",
  "if ($disk) { $diskFree=$disk.Free; $diskTotal=$disk.Used+$disk.Free } else { $diskFree=0; $diskTotal=0 }",
  'Write-Output "{`"cpu`":$cpu,`"mem_pct`":$memPct,`"mem_used`":$memUsed,`"mem_total`":$memTotal,`"disk_free`":$diskFree,`"disk_total`":$diskTotal,`"os_type`":`"Windows`",`"os_name`":`"Windows $osName`"}"',
].join("; ");

// ----- 远端命令执行 -----

function execSshCommand(
  sshClient: Client,
  command: string,
  timeoutMs = 8000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("远端命令超时"));
      }
    }, timeoutMs);

    sshClient.exec(command, (err, stream) => {
      if (settled) return;

      if (err) {
        clearTimeout(timer);
        settled = true;
        reject(err);
        return;
      }

      let stdout = "";
      let stderrOutput = "";

      stream.on("data", (data: Buffer) => {
        stdout += data.toString("utf8");
      });

      stream.stderr.on("data", (data: Buffer) => {
        stderrOutput += data.toString("utf8");
      });

      stream.on("close", () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          // ssh2 的 stderr 有时也包含有效输出，优先用 stdout
          const output = stdout.trim() || stderrOutput.trim();
          resolve(output);
        }
      });

      stream.on("error", (streamErr: Error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(streamErr);
        }
      });
    });
  });
}

function appendTerminalOutput(session: TerminalSession, chunk: string): void {
  session.outputBuffer = `${session.outputBuffer}${chunk}`.slice(
    -maxTerminalOutputBufferChars,
  );
}

export interface TerminalContextSnapshot {
  tabId: string;
  serverId: string;
  status: TerminalStatusEvent["status"];
  recentOutput: string;
}

export function getTerminalContextSnapshot(
  tabId: string,
): TerminalContextSnapshot | null {
  const session = terminalSessions.get(tabId);

  if (!session) {
    return null;
  }

  return {
    tabId: session.tabId,
    serverId: session.serverId,
    status: session.status,
    recentOutput: session.outputBuffer,
  };
}

export function executeTerminalCommand(
  tabId: string,
  command: string,
  timeoutMs = 12_000,
): Promise<AiCommandResult> {
  const session = terminalSessions.get(tabId);

  if (!session) {
    throw new Error("Terminal session does not exist");
  }

  if (session.status !== "connected") {
    throw new Error("终端会话未连接");
  }

  if (session.kind === "local") {
    return executeLocalCommand(session.cwd, command, timeoutMs);
  }

  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (result: Omit<AiCommandResult, "durationMs">): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        ...result,
        stdout: result.stdout.slice(0, 20_000),
        stderr: result.stderr.slice(0, 10_000),
        durationMs: Date.now() - startedAt,
      });
    };

    const timer = setTimeout(() => {
      finish({
        stdout,
        stderr,
        exitCode: null,
        timedOut: true,
      });
    }, timeoutMs);

    session.sshClient.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }

      stream.on("data", (data: Buffer) => {
        stdout += data.toString("utf8");
      });

      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString("utf8");
      });

      stream.on("close", (code: number | undefined) => {
        clearTimeout(timer);
        finish({
          stdout,
          stderr,
          exitCode: typeof code === "number" ? code : null,
          timedOut: false,
        });
      });

      stream.on("error", (streamErr: Error) => {
        clearTimeout(timer);
        reject(streamErr);
      });
    });
  });
}

async function executeLocalCommand(
  cwd: string,
  command: string,
  timeoutMs: number,
): Promise<AiCommandResult> {
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 30_000,
    });

    return {
      stdout: stdout.slice(0, 20_000),
      stderr: stderr.slice(0, 10_000),
      exitCode: 0,
      timedOut: false,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const record = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };

    return {
      stdout: String(record.stdout ?? "").slice(0, 20_000),
      stderr: String(record.stderr ?? (error instanceof Error ? error.message : "")).slice(0, 10_000),
      exitCode: typeof record.code === "number" ? record.code : null,
      timedOut: Boolean(record.killed),
      durationMs: Date.now() - startedAt,
    };
  }
}

function parseStatsOutput(raw: string): RemoteSystemStats | null {
  try {
    // Windows PowerShell 输出的 JSON 带转义反引号，统一处理
    const sanitized = raw.replace(/`/g, "");
    const parsed = JSON.parse(sanitized) as Record<string, unknown>;

    return {
      cpuUsage:
        typeof parsed.cpu === "number" ? Math.max(0, Math.min(100, parsed.cpu)) : 0,
      memoryUsage:
        typeof parsed.mem_pct === "number"
          ? Math.max(0, Math.min(100, parsed.mem_pct))
          : 0,
      memoryUsed:
        typeof parsed.mem_used === "number" ? Math.max(0, parsed.mem_used) : 0,
      memoryTotal:
        typeof parsed.mem_total === "number" ? Math.max(0, parsed.mem_total) : 0,
      diskFree:
        typeof parsed.disk_free === "number" ? Math.max(0, parsed.disk_free) : 0,
      diskTotal:
        typeof parsed.disk_total === "number" ? Math.max(0, parsed.disk_total) : 0,
      osType: normalizeOsType(parsed.os_type),
      osName: typeof parsed.os_name === "string" ? parsed.os_name : "",
    };
  } catch {
    return null;
  }
}

function normalizeOsType(raw: unknown): RemoteSystemStats["osType"] {
  if (typeof raw !== "string") return "";
  const lower = raw.toLowerCase();
  if (lower === "linux") return "linux";
  if (lower === "darwin") return "darwin";
  if (lower.startsWith("windows")) return "windows";
  return "";
}

function getDefaultLocalCwd(): string {
  if (process.platform === "win32") {
    return "C:\\";
  }

  return os.homedir() || process.cwd();
}

function getLocalShellConfig(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      shell: process.env.ORBITSSH_LOCAL_SHELL || "powershell.exe",
      args: ["-NoLogo"],
    };
  }

  return {
    shell: process.env.SHELL || "/bin/sh",
    args: [],
  };
}

function createLocalPtyEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  // 明确声明终端能力，保证本地 shell 的颜色和控制序列按 xterm 处理。
  env.TERM = env.TERM || "xterm-256color";
  env.COLORTERM = env.COLORTERM || "truecolor";

  return env;
}

function getCpuSample(): CpuSample {
  return os.cpus().reduce<CpuSample>(
    (sample, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);

      return {
        idle: sample.idle + cpu.times.idle,
        total: sample.total + total,
      };
    },
    { idle: 0, total: 0 },
  );
}

function getLocalCpuUsage(): number {
  const nextSample = getCpuSample();
  const previousSample = localCpuSample;
  localCpuSample = nextSample;

  if (!previousSample) {
    return 0;
  }

  const idleDelta = nextSample.idle - previousSample.idle;
  const totalDelta = nextSample.total - previousSample.total;

  if (totalDelta <= 0) {
    return 0;
  }

  return Math.round(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)));
}

async function getLocalDiskStats(cwd: string): Promise<Pick<RemoteSystemStats, "diskFree" | "diskTotal">> {
  try {
    if (process.platform === "win32") {
      const driveName = cwd.match(/^([a-zA-Z]):\\/)?.[1] ?? "C";
      const command = [
        `$disk=Get-PSDrive -Name '${driveName}' -ErrorAction Stop`,
        'Write-Output "{`"free`":$($disk.Free),`"total`":$($disk.Free+$disk.Used)}"',
      ].join("; ");
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-Command", command],
        { windowsHide: true, timeout: 5000 },
      );
      const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;

      return {
        diskFree: typeof parsed.free === "number" ? parsed.free : 0,
        diskTotal: typeof parsed.total === "number" ? parsed.total : 0,
      };
    }

    const { stdout } = await execFileAsync("df", ["-k", cwd], { timeout: 5000 });
    const line = stdout.trim().split(/\r?\n/).at(-1);
    const parts = line?.trim().split(/\s+/) ?? [];
    const totalKb = Number(parts[1]);
    const freeKb = Number(parts[3]);

    return {
      diskFree: Number.isFinite(freeKb) ? freeKb * 1024 : 0,
      diskTotal: Number.isFinite(totalKb) ? totalKb * 1024 : 0,
    };
  } catch (error) {
    writeAppLog({
      scope: "main.ssh",
      level: "warn",
      message: "本地磁盘统计失败",
      data: { cwd, error: error instanceof Error ? error.message : String(error) },
    });

    return { diskFree: 0, diskTotal: 0 };
  }
}

async function getLocalSystemStats(session: LocalTerminalSession): Promise<RemoteSystemStats> {
  const memoryTotal = os.totalmem();
  const memoryFree = os.freemem();
  const memoryUsed = Math.max(0, memoryTotal - memoryFree);
  const disk = await getLocalDiskStats(session.cwd);
  const osType =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "darwin"
        : "linux";

  return {
    cpuUsage: getLocalCpuUsage(),
    memoryUsage: memoryTotal > 0 ? Math.round((memoryUsed / memoryTotal) * 100) : 0,
    memoryUsed,
    memoryTotal,
    diskFree: disk.diskFree,
    diskTotal: disk.diskTotal,
    osType,
    osName:
      osType === "windows"
        ? `Windows ${os.release()}`
        : osType === "darwin"
          ? `macOS ${os.release()}`
          : `${os.type()} ${os.release()}`,
  };
}

export async function getRemoteSystemStats(
  tabId: string,
): Promise<RemoteSystemStats> {
  const session = terminalSessions.get(tabId);

  if (!session) {
    throw new Error("终端会话不存在");
  }

  if (session.status !== "connected") {
    throw new Error("SSH 未连接");
  }

  if (session.kind === "local") {
    return getLocalSystemStats(session);
  }

  const cachedOS = remoteOSCache.get(tabId);

  // 已缓存 OS，直接用对应脚本
  if (cachedOS) {
    const script =
      cachedOS.type === "windows"
        ? `powershell -NoProfile -Command "${WINDOWS_STATS_SCRIPT}"`
        : UNIX_STATS_SCRIPT;

    const output = await execSshCommand(session.sshClient, script);
    const stats = parseStatsOutput(output);

    if (!stats) {
      throw new Error("远端统计解析失败");
    }

    return stats;
  }

  // 首次采集：先尝试 Unix shell 脚本（SSH exec 通道默认使用用户 shell）
  try {
    const output = await execSshCommand(
      session.sshClient,
      UNIX_STATS_SCRIPT,
    );
    const stats = parseStatsOutput(output);

    if (stats) {
      remoteOSCache.set(tabId, { type: stats.osType || "linux", name: stats.osName });
      return stats;
    }
  } catch {
    // Unix 脚本失败，尝试 Windows
  }

  try {
    const output = await execSshCommand(
      session.sshClient,
      `powershell -NoProfile -Command "${WINDOWS_STATS_SCRIPT}"`,
    );
    const stats = parseStatsOutput(output);

    if (stats) {
      remoteOSCache.set(tabId, { type: "windows", name: stats.osName });
      return stats;
    }
  } catch {
    // Windows 也失败
  }

  throw new Error("无法检测远端系统类型或采集资源信息");
}

export function clearRemoteOSCache(tabId: string): void {
  remoteOSCache.delete(tabId);
}

function sendStatus(
  session: TerminalSession,
  status: TerminalStatusEvent["status"],
  message?: string,
): void {
  session.status = status;
  writeAppLog({
    scope: "main.ssh",
    message: "终端状态变更",
    data: {
      tabId: session.tabId,
      serverId: session.serverId,
      status,
      message,
    },
  });
  session.webContents.send("terminal:status", {
    tabId: session.tabId,
    status,
    message,
  } satisfies TerminalStatusEvent);
}

function touchTerminalSession(session: TerminalSession): void {
  session.lastActiveAt = Date.now();
}

// 判断回调所属会话是否仍是当前有效会话，避免旧连接事件影响新连接。
function isCurrentTerminalSession(session: TerminalSession): boolean {
  return terminalSessions.get(session.tabId) === session;
}

export function assertTerminalSessionAccess(
  tabId: string,
  webContents: WebContents,
  options: { allowMissing?: boolean } = {},
): void {
  if (typeof tabId !== "string" || !tabId.trim()) {
    throw new Error("终端标签页 ID 无效");
  }

  const session = terminalSessions.get(tabId);

  if (!session) {
    if (options.allowMissing) {
      return;
    }

    throw new Error("终端会话不存在");
  }

  if (session.webContents !== webContents) {
    throw new Error("终端会话不属于当前窗口");
  }
}

function sendTerminalStatusToWebContents(
  webContents: WebContents,
  tabId: string,
  status: TerminalStatusEvent["status"],
  message?: string,
): void {
  // 会话不存在时也要回写状态，避免 Renderer 停留在连接中。
  webContents.send("terminal:status", {
    tabId,
    status,
    message,
  } satisfies TerminalStatusEvent);
}

function closeIdleTerminalSessions(): void {
  const idleDisconnectMs = getIdleDisconnectMs();

  if (idleDisconnectMs <= 0) {
    return;
  }

  const now = Date.now();

  for (const session of terminalSessions.values()) {
    if (session.kind !== "ssh" || session.status !== "connected") {
      continue;
    }

    if (now - session.lastActiveAt < idleDisconnectMs) {
      continue;
    }

    writeAppLog({
      scope: "main.ssh",
      message: "SSH 会话因空闲超时关闭",
      data: {
        tabId: session.tabId,
        serverId: session.serverId,
        idleMs: now - session.lastActiveAt,
      },
    });
    sendStatus(session, "disconnected", "连接因长时间未操作已断开");
    closeTerminalSession(session.tabId);
  }
}

const terminalIdleDisconnectTimer = setInterval(
  closeIdleTerminalSessions,
  idleDisconnectCheckIntervalMs,
);
terminalIdleDisconnectTimer.unref?.();

function createSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "SSH 连接失败";
}

function createShellPathIntegrationCommand(): string {
  return (
    [
      // 禁用 history 记录，避免初始化命令堆积到 .bash_history（bash: set +o history，zsh: fc -p）
      'if [ -n "$BASH_VERSION" ]; then set +o history; elif [ -n "$ZSH_VERSION" ]; then fc -p /dev/null 2>/dev/null; fi',
      // 初始化远端 shell 的 ls 颜色配置，避免不同服务器 alias 差异导致 ls 无颜色。
      "export CLICOLOR=1",
      'if command -v dircolors >/dev/null 2>&1; then eval "$(dircolors -b 2>/dev/null)" 2>/dev/null || true; fi',
      'if ls --color=auto -d . >/dev/null 2>&1; then alias ls="ls --color=auto"; elif ls -G -d . >/dev/null 2>&1; then alias ls="ls -G"; fi',
      '__orbitssh_emit_pwd(){ printf \'\\033]7;file://%s%s\\007\' "$HOSTNAME" "$PWD"; }',
      'if [ -n "$BASH_VERSION" ]; then PROMPT_COMMAND="__orbitssh_emit_pwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"; fi',
      'if [ -n "$ZSH_VERSION" ]; then case " ${precmd_functions[*]} " in *" __orbitssh_emit_pwd "*) ;; *) precmd_functions+=(__orbitssh_emit_pwd);; esac; fi',
      "__orbitssh_emit_pwd",
      // 恢复 history 记录
      'if [ -n "$BASH_VERSION" ]; then set -o history; elif [ -n "$ZSH_VERSION" ]; then fc -P 2>/dev/null; fi',
      "stty echo 2>/dev/null",
      "printf '\\r\\033[K'",
    ].join("; ") + "\n"
  );
}

function installShellPathIntegration(session: SshTerminalSession): void {
  if (!session.shellStream) {
    return;
  }

  session.shellStream.write("stty -echo 2>/dev/null\n");

  setTimeout(() => {
    if (!terminalSessions.has(session.tabId) || !session.shellStream) {
      return;
    }

    session.shellStream.write(createShellPathIntegrationCommand());
  }, pathIntegrationInstallDelayMs);

  writeAppLog({
    scope: "main.ssh",
    message: "已注入终端路径同步脚本",
    data: { tabId: session.tabId, serverId: session.serverId },
  });
}

function createLocalTerminalSession(
  webContents: WebContents,
  tabId: string = crypto.randomUUID(),
  outputBuffer = "",
): TerminalOpenResult {
  const startedAt = Date.now();
  const cwd = getDefaultLocalCwd();
  const { shell, args } = getLocalShellConfig();

  writeAppLog({
    scope: "main.ssh",
    message: "开始创建本地终端会话",
    data: { tabId, cwd, shell },
  });

  const localPty = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: createLocalPtyEnv(),
  });

  const session: LocalTerminalSession = {
    tabId,
    serverId: LOCAL_TERMINAL_SERVER_ID,
    kind: "local",
    webContents,
    cwd,
    localPty,
    status: "connecting",
    lastActiveAt: Date.now(),
    outputBuffer,
  };

  terminalSessions.set(tabId, session);
  sendStatus(session, "connecting");

  localPty.onData(data => {
    touchTerminalSession(session);
    appendTerminalOutput(session, data);
    webContents.send("terminal:data", { tabId, data });
  });

  localPty.onExit(event => {
    if (!isCurrentTerminalSession(session)) {
      return;
    }

    writeAppLog({
      scope: "main.ssh",
      message: "本地终端会话已退出",
      data: { tabId, exitCode: event.exitCode, signal: event.signal },
    });
    sendStatus(session, "disconnected");
    terminalSessions.delete(tabId);
    remoteOSCache.delete(tabId);
  });

  sendStatus(session, "connected");
  writeAppLog({
    scope: "main.ssh",
    message: "本地终端会话已创建",
    data: { tabId, cwd, shell, totalMs: Date.now() - startedAt },
  });

  return {
    tabId,
    serverId: LOCAL_TERMINAL_SERVER_ID,
    kind: "local",
    cwd,
  };
}

export function openLocalTerminalSession(webContents: WebContents): TerminalOpenResult {
  try {
    return createLocalTerminalSession(webContents);
  } catch (error) {
    const message = createSafeErrorMessage(error);
    writeAppLog({
      scope: "main.ssh",
      level: "error",
      message: "本地终端会话创建失败",
      data: { error: message },
    });
    throw new Error(`本地终端打开失败：${message}`);
  }
}

// 创建 SSH shell session，输入输出统一通过 IPC 转发给对应 Renderer。
export function openTerminalSession(
  webContents: WebContents,
  serverId: string,
): TerminalOpenResult {
  const startedAt = Date.now();
  const server = getServerAuthConfig(serverId);
  const authLoadedAt = Date.now();
  const tabId = crypto.randomUUID();
  const sshClient = new Client();
  const session: SshTerminalSession = {
    tabId,
    serverId,
    kind: "ssh",
    webContents,
    sshClient,
    status: "connecting",
    lastActiveAt: Date.now(),
    outputBuffer: "",
  };

  terminalSessions.set(tabId, session);
  writeAppLog({
    scope: "main.ssh",
    message: "开始创建 SSH 会话",
    data: {
      tabId,
      serverId,
      host: server.host,
      port: server.port,
      username: server.username,
      authType: server.authType,
      authLoadMs: authLoadedAt - startedAt,
    },
  });
  sendStatus(session, "connecting");

  sshClient
    .on("ready", () => {
      const readyAt = Date.now();
      writeAppLog({
        scope: "main.ssh",
        message: "SSH 已 ready，开始打开 shell",
        data: {
          tabId,
          serverId,
          connectReadyMs: readyAt - startedAt,
          afterConnectCallMs: readyAt - authLoadedAt,
        },
      });
      sshClient.shell(
        {
          term: "xterm-256color",
          cols: 80,
          rows: 24,
        },
        (error, stream) => {
          if (error) {
            sendStatus(session, "error", createSafeErrorMessage(error));
            closeTerminalSession(tabId);
            return;
          }

          session.shellStream = stream;
          const shellOpenedAt = Date.now();
          writeAppLog({
            scope: "main.ssh",
            message: "SSH shell 已打开",
            data: {
              tabId,
              serverId,
              shellOpenMs: shellOpenedAt - readyAt,
              totalMs: shellOpenedAt - startedAt,
            },
          });
          sendStatus(session, "connected");

          stream.on("data", (data: Buffer) => {
            touchTerminalSession(session);
            appendTerminalOutput(session, data.toString("utf8"));
            webContents.send("terminal:data", {
              tabId,
              data: data.toString("utf8"),
            });
          });

          stream.on("close", () => {
            if (!isCurrentTerminalSession(session)) {
              return;
            }

            sendStatus(session, "disconnected");
            closeTerminalSession(tabId);
          });

          installShellPathIntegration(session);
        },
      );
    })
    .on("error", error => {
      writeAppLog({
        scope: "main.ssh",
        level: "error",
        message: "SSH 会话错误",
        data: { tabId, serverId, error: createSafeErrorMessage(error) },
      });
      sendStatus(session, "error", createSafeErrorMessage(error));
      closeTerminalSession(tabId);
    })
    .on("close", () => {
      if (isCurrentTerminalSession(session)) {
        sendStatus(session, "disconnected");
        terminalSessions.delete(tabId);
        remoteOSCache.delete(tabId);
      }
    });

  writeAppLog({
    scope: "main.ssh",
    message: "SSH connect 已调度",
    data: { tabId, serverId, scheduleMs: Date.now() - startedAt },
  });

  setImmediate(() => {
    const connectStartedAt = Date.now();
    writeAppLog({
      scope: "main.ssh",
      message: "开始执行 SSH connect",
      data: {
        tabId,
        serverId,
        delayAfterScheduleMs: connectStartedAt - startedAt,
      },
    });

    sshClient.connect({
      ...createServerConnectOptions(server),
      readyTimeout: 15000,
      keepaliveInterval: getSshKeepaliveIntervalMs(),
    });
  });

  return {
    tabId,
    serverId,
    kind: "ssh",
  };
}

export function writeTerminalInput(tabId: string, data: string): void {
  const session = terminalSessions.get(tabId);

  if (!session || typeof data !== "string") {
    return;
  }

  touchTerminalSession(session);

  if (session.kind === "local") {
    session.localPty.write(data);
    return;
  }

  session.shellStream?.write(data);
}

export function resizeTerminal(input: TerminalResizeInput): void {
  const session = terminalSessions.get(input.tabId);

  if (!session) {
    return;
  }

  if (!Number.isInteger(input.cols) || !Number.isInteger(input.rows)) {
    return;
  }

  if (session.kind === "local") {
    session.localPty.resize(input.cols, input.rows);
    return;
  }

  session.shellStream?.setWindow(input.rows, input.cols, 0, 0);
}

export function closeTerminalSession(tabId: string): void {
  const session = terminalSessions.get(tabId);

  if (!session) {
    return;
  }

  terminalSessions.delete(tabId);
  remoteOSCache.delete(tabId);
  if (session.kind === "local") {
    session.localPty.kill();
  } else {
    session.shellStream?.end();
    session.sshClient.end();
  }
  writeAppLog({
    scope: "main.ssh",
    message: session.kind === "local" ? "本地终端会话已关闭" : "SSH 会话已关闭",
    data: { tabId, serverId: session.serverId, kind: session.kind },
  });
}

// 重新连接终端会话：优先复用现有会话信息；断线清理后用 Renderer 传回的 serverId 恢复连接。
export function reconnectTerminalSession(
  webContents: WebContents,
  tabId: string,
  fallbackServerId?: string,
): boolean {
  const existing = terminalSessions.get(tabId);

  const serverId = existing?.serverId ?? fallbackServerId;

  if (!serverId) {
    const message = "重连失败：终端会话不存在";
    writeAppLog({
      scope: "main.ssh",
      level: "warn",
      message,
      data: { tabId },
    });
    sendTerminalStatusToWebContents(webContents, tabId, "error", message);
    return false;
  }

  if (existing?.kind === "local" || serverId === LOCAL_TERMINAL_SERVER_ID) {
    const outputBuffer = existing?.outputBuffer ?? "";
    const sessionWebContents = existing?.webContents ?? webContents;

    if (existing?.kind === "local") {
      terminalSessions.delete(tabId);
      existing.localPty.kill();
    }

    try {
      createLocalTerminalSession(sessionWebContents, tabId, outputBuffer);
      return true;
    } catch (error) {
      const message = `本地终端重连失败：${createSafeErrorMessage(error)}`;
      writeAppLog({
        scope: "main.ssh",
        level: "error",
        message,
        data: { tabId },
      });
      sendTerminalStatusToWebContents(sessionWebContents, tabId, "error", message);
      return false;
    }
  }

  let server: ReturnType<typeof getServerAuthConfig>;

  try {
    server = getServerAuthConfig(serverId);
  } catch (error) {
    const message = `重连失败：${createSafeErrorMessage(error)}`;
    writeAppLog({
      scope: "main.ssh",
      level: "error",
      message,
      data: { tabId, serverId },
    });
    sendTerminalStatusToWebContents(webContents, tabId, "error", message);
    return false;
  }

  const startedAt = Date.now();
  const sessionWebContents = existing?.webContents ?? webContents;
  const outputBuffer = existing?.outputBuffer ?? "";

  // 清理旧连接资源；后续 close 回调通过会话身份判断，避免误删新连接。
  if (existing?.kind === "ssh") {
    existing.shellStream?.end();
    existing.sshClient.end();
  }
  remoteOSCache.delete(tabId);

  writeAppLog({
    scope: "main.ssh",
    message: "开始重连 SSH 会话",
    data: { tabId, serverId, host: server.host, port: server.port },
  });

  const sshClient = new Client();
  const session: SshTerminalSession = {
    tabId,
    serverId,
    kind: "ssh",
    webContents: sessionWebContents,
    sshClient,
    status: "connecting",
    lastActiveAt: Date.now(),
    outputBuffer,
  };

  terminalSessions.set(tabId, session);
  sendStatus(session, "connecting");

  sshClient
    .on("ready", () => {
      const readyAt = Date.now();
      writeAppLog({
        scope: "main.ssh",
        message: "SSH 重连已 ready，开始打开 shell",
        data: { tabId, serverId, connectReadyMs: readyAt - startedAt },
      });
      sshClient.shell(
        { term: "xterm-256color", cols: 80, rows: 24 },
        (error, stream) => {
          if (error) {
            sendStatus(session, "error", createSafeErrorMessage(error));
            closeTerminalSession(tabId);
            return;
          }

          session.shellStream = stream;
          writeAppLog({
            scope: "main.ssh",
            message: "SSH 重连 shell 已打开",
            data: { tabId, serverId, totalMs: Date.now() - startedAt },
          });
          sendStatus(session, "connected");

          stream.on("data", (data: Buffer) => {
            touchTerminalSession(session);
            appendTerminalOutput(session, data.toString("utf8"));
            sessionWebContents.send("terminal:data", {
              tabId,
              data: data.toString("utf8"),
            });
          });

          stream.on("close", () => {
            if (!isCurrentTerminalSession(session)) {
              return;
            }

            sendStatus(session, "disconnected");
            closeTerminalSession(tabId);
          });

          installShellPathIntegration(session);
        },
      );
    })
    .on("error", error => {
      writeAppLog({
        scope: "main.ssh",
        level: "error",
        message: "SSH 重连错误",
        data: { tabId, serverId, error: createSafeErrorMessage(error) },
      });
      sendStatus(session, "error", createSafeErrorMessage(error));
      closeTerminalSession(tabId);
    })
    .on("close", () => {
      if (isCurrentTerminalSession(session)) {
        sendStatus(session, "disconnected");
        terminalSessions.delete(tabId);
        remoteOSCache.delete(tabId);
      }
    });

  setImmediate(() => {
    try {
      sshClient.connect({
        ...createServerConnectOptions(server),
        readyTimeout: 15000,
        keepaliveInterval: getSshKeepaliveIntervalMs(),
      });
    } catch (error) {
      sendStatus(session, "error", createSafeErrorMessage(error));
      closeTerminalSession(tabId);
    }
  });

  return true;
}

export function closeAllTerminalSessions(): void {
  for (const tabId of terminalSessions.keys()) {
    closeTerminalSession(tabId);
  }
}
