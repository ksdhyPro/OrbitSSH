import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { writeStartupDiagnostic } from "./startup-diagnostics.js";

const isMcpStdioMode = process.argv.includes("--mcp-stdio");

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { error: String(error) };
}

function startMcpStdioProcess(): void {
  const mcpEntry = fileURLToPath(new URL("../mcp/standalone.js", import.meta.url));
  // Electron 图形进程在 Windows 下不能可靠读取 STDIN，使用同一可执行文件的内置 Node 运行时承接协议管道。
  const child = spawn(process.execPath, [mcpEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "inherit",
    windowsHide: true,
  });

  child.once("error", error => {
    writeStartupDiagnostic("MCP STDIO 子进程启动失败", serializeError(error));
    process.stderr.write(`OrbitSSH MCP 启动失败：${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", code => {
    process.exit(code ?? 1);
  });
}

// 此文件是生产环境统一入口，MCP 模式必须在加载 Electron 主程序前完成分流。
writeStartupDiagnostic(isMcpStdioMode ? "MCP STDIO 开始启动" : "主进程开始启动", {
  pid: process.pid,
  platform: process.platform,
  arch: process.arch,
  versions: process.versions,
});

process.on("uncaughtException", error => {
  writeStartupDiagnostic("未捕获异常", serializeError(error));
});

process.on("unhandledRejection", reason => {
  writeStartupDiagnostic("未处理的 Promise 拒绝", serializeError(reason));
});

if (isMcpStdioMode) {
  // 复用安装包内置运行时，不创建窗口，也不依赖系统 Node.js。
  startMcpStdioProcess();
} else {
  void import("./index.js").catch(error => {
    writeStartupDiagnostic("主进程业务模块加载失败", serializeError(error));
  });
}
