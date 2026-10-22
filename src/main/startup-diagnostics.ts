import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const startupLogFileName = "startup-diagnostics.log";

/**
 * 返回启动诊断日志目录。此时 Electron app 尚未加载，只能按平台约定自行推导。
 * Windows 使用 LOCALAPPDATA，避免安装目录位于 Program Files 时因权限不足而丢失日志。
 */
export function getStartupDiagnosticsDirectory(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = os.homedir(),
): string {
  if (platform === "win32") {
    return path.win32.join(
      env.LOCALAPPDATA || env.APPDATA || os.tmpdir(),
      "OrbitSSH",
      "logs",
    );
  }

  if (platform === "darwin") {
    return path.posix.join(homeDirectory, "Library", "Logs", "OrbitSSH");
  }

  return path.posix.join(
    env.XDG_STATE_HOME || path.posix.join(homeDirectory, ".local", "state"),
    "OrbitSSH",
    "logs",
  );
}

/** 在业务模块加载前写入启动诊断日志。 */
export function writeStartupDiagnostic(
  stage: string,
  data?: Record<string, unknown>,
): void {
  try {
    const logDir = getStartupDiagnosticsDirectory();
    const logPath = path.join(logDir, startupLogFileName);
    const payload = data ? ` ${JSON.stringify(data)}` : "";

    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      logPath,
      `${new Date().toISOString()} [startup] ${stage}${payload}\n`,
      "utf8",
    );
  } catch {
    // 启动诊断不能反过来阻断应用启动。
  }
}
