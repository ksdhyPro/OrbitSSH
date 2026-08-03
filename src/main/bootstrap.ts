import { writeStartupDiagnostic } from "./startup-diagnostics.js";

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

// 此文件是生产环境入口，必须先于主进程业务模块执行。
writeStartupDiagnostic("主进程开始启动", {
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

void import("./index.js").catch(error => {
  writeStartupDiagnostic("主进程业务模块加载失败", serializeError(error));
});
