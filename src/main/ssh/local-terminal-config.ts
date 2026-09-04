import os from "node:os";

/** 返回本地终端可直接使用的默认绝对目录。 */
export function getDefaultLocalTerminalCwd(): string {
  if (process.platform === "win32") {
    return "C:\\";
  }

  return os.homedir() || process.cwd();
}

/** 统一选择本地终端 Shell，保留环境变量覆盖能力。 */
export function getLocalTerminalShellConfig(): {
  shell: string;
  args: string[];
} {
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
