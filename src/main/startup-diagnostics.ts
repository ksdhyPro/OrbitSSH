import fs from "node:fs";
import path from "node:path";

const startupLogFileName = "startup-diagnostics.log";

/**
 * 在业务模块加载前写入启动诊断日志。
 * 使用 LOCALAPPDATA，避免安装目录位于 Program Files 时因权限不足而丢失日志。
 */
export function writeStartupDiagnostic(
  stage: string,
  data?: Record<string, unknown>,
): void {
  try {
    const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA;
    const logDir = path.join(
      localAppData || process.cwd(),
      "OrbitSSH",
      "logs",
    );
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
