import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import { execFileSync } from "node:child_process";

function readGitValue(args: string[]): string | null {
  try {
    // 仅执行固定参数的 Git 只读命令，获取当前构建对应的提交元数据。
    const value = execFileSync("git", args, {
      cwd: app.getAppPath(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || null;
  } catch {
    // 已打包环境通常不包含 .git，保留明确的未知状态。
    return null;
  }
}

function getAboutText(): string {
  const versions = process.versions;
  const commit = readGitValue(["rev-parse", "--short", "HEAD"]);
  const commitDate = readGitValue(["log", "-1", "--format=%cs"]);

  return [
    `版本: ${app.getVersion()}`,
    `提交: ${commit ?? "未提供"}`,
    `日期: ${commitDate ?? "未提供"}`,
    `Electron: ${versions.electron ?? "未知"}`,
    `Chrome: ${versions.chrome ?? "未知"}`,
    `Node.js: ${versions.node ?? "未知"}`,
    `V8: ${versions.v8 ?? "未知"}`,
  ].join("\n");
}

// 使用系统消息框展示版本和运行环境，保持与操作系统原生弹窗一致的交互。
export function registerAboutIpc(): void {
  ipcMain.handle("about:show", async event => {
    const detail = getAboutText();
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = ownerWindow
      ? await dialog.showMessageBox(ownerWindow, {
          type: "info",
          title: "OrbitSSH",
          message: "OrbitSSH",
          detail,
          buttons: ["复制", "确定"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
      : await dialog.showMessageBox({
          type: "info",
          title: "OrbitSSH",
          message: "OrbitSSH",
          detail,
          buttons: ["复制", "确定"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });

    if (result.response === 0) {
      clipboard.writeText(`OrbitSSH\n\n${detail}`);
    }

    return true;
  });
}
