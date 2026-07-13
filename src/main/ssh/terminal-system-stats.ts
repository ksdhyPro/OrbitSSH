import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { type Client } from "ssh2";

import { writeAppLog } from "../logger.js";

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

type TerminalSystemStatsTarget =
  | { kind: "local"; cwd: string }
  | { kind: "ssh"; sshClient: Client };

const remoteOSCache = new Map<string, CachedOSInfo>();
const execFileAsync = promisify(execFile);
let localCpuSample: CpuSample | undefined;

// 远端统计脚本只读取系统资源，不修改服务器状态。
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
  '  [ -z "$cpu" ] && cpu=0',
  "  mem_total=$(sysctl -n hw.memsize 2>/dev/null || echo 0)",
  "  pg=$(sysctl -n hw.pagesize 2>/dev/null || echo 16384)",
  "  mem_used=$(vm_stat 2>/dev/null | awk -v pg=\"$pg\" '/Pages wired down/ {wired=$NF} /^Pages active/ {active=$NF} /^Pages occupied by compressor/ {compressed=$NF} END {gsub(/\\./,\"\",wired); gsub(/\\./,\"\",active); gsub(/\\./,\"\",compressed); printf \"%.0f\", (wired+active+compressed)*pg}')",
  '  [ -z "$mem_used" ] && mem_used=0',
  '  if [ "${mem_total:-0}" -gt 0 ] 2>/dev/null; then mem_pct=$(awk "BEGIN {printf \\"%.0f\\", $mem_used/$mem_total*100}"); else mem_pct=0; fi',
  "  disk_line=$(df -k . 2>/dev/null | awk 'NR==2{printf \"%.0f %.0f\", $4*1024, $2*1024}')",
  "  set -- $disk_line; disk_free=${1:-0}; disk_total=${2:-0}",
  "fi",
  'printf \'{"cpu":%s,"mem_pct":%s,"mem_used":%s,"mem_total":%s,"disk_free":%s,"disk_total":%s,"os_type":"%s","os_name":"%s"}\\n\' \\',
  '  "$cpu" "$mem_pct" "$mem_used" "$mem_total" "$disk_free" "$disk_total" "$os" "$os_name"',
].join("\n");

const UNIX_STATS_COMMAND = [
  "/bin/sh -s <<'ORBITSSH_STATS'",
  UNIX_STATS_SCRIPT,
  "ORBITSSH_STATS",
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

    sshClient.exec(command, (error, stream) => {
      if (settled) return;
      if (error) {
        clearTimeout(timer);
        settled = true;
        reject(error);
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
          // ssh2 的 stderr 有时也包含有效输出，优先使用 stdout。
          resolve(stdout.trim() || stderrOutput.trim());
        }
      });
      stream.on("error", (streamError: Error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(streamError);
        }
      });
    });
  });
}

function parseStatsOutput(raw: string): RemoteSystemStats | null {
  try {
    const sanitized = raw.replace(/`/g, "");
    const jsonStart = sanitized.indexOf("{");
    const jsonEnd = sanitized.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) return null;

    // 远端 shell 启动脚本可能输出欢迎语，只截取统计 JSON 解析。
    const parsed = JSON.parse(
      sanitized.slice(jsonStart, jsonEnd + 1),
    ) as Record<string, unknown>;

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
  if (!previousSample) return 0;

  const idleDelta = nextSample.idle - previousSample.idle;
  const totalDelta = nextSample.total - previousSample.total;
  if (totalDelta <= 0) return 0;

  return Math.round(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)));
}

async function getLocalDiskStats(
  cwd: string,
): Promise<Pick<RemoteSystemStats, "diskFree" | "diskTotal">> {
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
    const parts = stdout.trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/) ?? [];
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

async function getLocalSystemStats(cwd: string): Promise<RemoteSystemStats> {
  const memoryTotal = os.totalmem();
  const memoryFree = os.freemem();
  const memoryUsed = Math.max(0, memoryTotal - memoryFree);
  const disk = await getLocalDiskStats(cwd);
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

/** 根据终端类型采集本地或远端资源统计，并缓存已识别的远端系统类型。 */
export async function collectTerminalSystemStats(
  tabId: string,
  target: TerminalSystemStatsTarget,
): Promise<RemoteSystemStats> {
  if (target.kind === "local") {
    return getLocalSystemStats(target.cwd);
  }

  const cachedOS = remoteOSCache.get(tabId);
  if (cachedOS) {
    const script =
      cachedOS.type === "windows"
        ? `powershell -NoProfile -Command "${WINDOWS_STATS_SCRIPT}"`
        : UNIX_STATS_COMMAND;
    const stats = parseStatsOutput(await execSshCommand(target.sshClient, script));
    if (!stats) throw new Error("远端统计解析失败");
    return stats;
  }

  try {
    const stats = parseStatsOutput(
      await execSshCommand(target.sshClient, UNIX_STATS_COMMAND),
    );
    if (stats) {
      remoteOSCache.set(tabId, {
        type: stats.osType || "linux",
        name: stats.osName,
      });
      return stats;
    }
  } catch {
    // Unix 脚本失败后继续尝试 Windows，兼容不同 SSH 服务端。
  }

  try {
    const stats = parseStatsOutput(
      await execSshCommand(
        target.sshClient,
        `powershell -NoProfile -Command "${WINDOWS_STATS_SCRIPT}"`,
      ),
    );
    if (stats) {
      remoteOSCache.set(tabId, { type: "windows", name: stats.osName });
      return stats;
    }
  } catch {
    // 两类统计命令均失败时由下方统一返回可读错误。
  }

  throw new Error("无法检测远端系统类型或采集资源信息");
}

export function clearRemoteSystemStatsCache(tabId: string): void {
  remoteOSCache.delete(tabId);
}
