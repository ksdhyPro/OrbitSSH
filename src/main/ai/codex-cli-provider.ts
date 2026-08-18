import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CodexCliDetection } from "../../shared/settings.js";
import type { ParsedAiCommand, ParsedAssistantResponse } from "./ai-response-parser.js";

const codexOutputSchema = {
  type: "object",
  properties: {
    reply: { type: "string" },
    commands: {
      type: "array",
      maxItems: 1,
      items: {
        type: "object",
        properties: {
          command: { type: "string" },
          reason: { type: "string" },
          risk: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["command", "reason", "risk"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "commands"],
  additionalProperties: false,
} as const;

interface CodexCliOutput {
  reply?: unknown;
  commands?: unknown;
}

interface CommandResult {
  code: number | null;
  stdout: string;
}

/** 执行短生命周期的本地探测命令，并限制超时避免设置页卡住。 */
function runDetectionCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise(resolve => {
    const processHandle = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    const timer = setTimeout(() => processHandle.kill(), 3_000);

    processHandle.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    processHandle.once("error", () => {
      clearTimeout(timer);
      resolve({ code: null, stdout: "" });
    });
    processHandle.once("close", code => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });
  });
}

function getFirstPath(output: string): string | undefined {
  return output.split(/\r?\n/).map(item => item.trim()).find(Boolean);
}

/** 图形应用未继承终端 PATH 时，直接查找当前用户安装的 VS Code Codex 扩展。 */
async function findCodexInVsCodeExtensions(): Promise<string | undefined> {
  const userProfile = process.env.USERPROFILE;
  if (!userProfile) return undefined;
  const extensionsDirectory = path.join(userProfile, ".vscode", "extensions");
  try {
    const extensions = await readdir(extensionsDirectory, { withFileTypes: true });
    const extensionNames = extensions
      .filter(item => item.isDirectory() && item.name.startsWith("openai.chatgpt-"))
      .map(item => item.name)
      .sort()
      .reverse();
    for (const extensionName of extensionNames) {
      const binDirectory = path.join(extensionsDirectory, extensionName, "bin");
      const platforms = await readdir(binDirectory, { withFileTypes: true }).catch(() => []);
      const platformName = platforms.find(
        item => item.isDirectory() && item.name.startsWith("windows-"),
      )?.name;
      if (!platformName) continue;
      const executablePath = path.join(binDirectory, platformName, "codex.exe");
      try {
        await access(executablePath);
        return executablePath;
      } catch {
        // 当前扩展版本不带 CLI 时继续查找其它版本。
      }
    }
  } catch {
    // VS Code 扩展目录不存在或不可读时，由上层给出统一的未找到提示。
  }
  return undefined;
}

/**
 * 检测本机可直接启动的 Codex CLI，不读取 auth.json 等登录凭据。
 * 图形应用的 PATH 经常不包含 VS Code 扩展目录，因此 Windows 会额外检查该安装位置。
 */
export async function detectLocalCodexCli(): Promise<CodexCliDetection> {
  const lookup = await runDetectionCommand(
    process.platform === "win32" ? "where.exe" : "which",
    [process.platform === "win32" ? "codex.exe" : "codex"],
  );
  let executablePath = lookup.code === 0 ? getFirstPath(lookup.stdout) : undefined;

  if (!executablePath && process.platform === "win32") {
    executablePath = await findCodexInVsCodeExtensions();
  }

  if (!executablePath) {
    return { available: false, error: "未检测到可用的 Codex CLI。" };
  }

  const versionResult = await runDetectionCommand(executablePath, ["--version"]);
  if (versionResult.code !== 0) {
    return { available: false, error: "检测到 Codex CLI，但命令无法正常运行。" };
  }
  return {
    available: true,
    executablePath,
    version: versionResult.stdout.trim(),
  };
}

function parseCommand(value: unknown): ParsedAiCommand | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const command = typeof item.command === "string" ? item.command.trim() : "";
  const reason = typeof item.reason === "string" ? item.reason.trim() : "";
  const risk = item.risk;
  if (!command || !reason || !["low", "medium", "high"].includes(String(risk))) {
    return null;
  }
  return { command, reason, risk: risk as ParsedAiCommand["risk"] };
}

function parseCodexOutput(text: string): ParsedAssistantResponse {
  const payload = JSON.parse(text) as CodexCliOutput;
  const reply = typeof payload.reply === "string" ? payload.reply.trim() : "";
  const command = Array.isArray(payload.commands) ? parseCommand(payload.commands[0]) : null;
  return { reply, commands: command ? [command] : [] };
}

/**
 * 把 Codex CLI 约束为现有 Agent 循环的“规划提供商”。
 * CLI 不持有 SSH 连接，也不会绕过 OrbitSSH 的命令审批与执行策略。
 */
export async function requestCodexCliTurn(
  executablePath: string,
  model: string | undefined,
  reasoningEffort: string | undefined,
  prompt: string,
  signal?: AbortSignal,
  sendChunk?: (text: string) => void,
): Promise<ParsedAssistantResponse> {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "orbitssh-codex-"));
  const schemaPath = path.join(temporaryDirectory, "output-schema.json");
  await writeFile(schemaPath, JSON.stringify(codexOutputSchema), "utf8");

  try {
    return await new Promise<ParsedAssistantResponse>((resolve, reject) => {
      const child = spawn(
        executablePath,
        [
          "exec",
          "--json",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          // 模型和思考强度由 OrbitSSH 会话配置显式指定，避免受上一次 CLI 选择影响。
          ...(model ? ["--model", model] : []),
          ...(reasoningEffort ? ["--config", `model_reasoning_effort=${reasoningEffort}`] : []),
          "--output-schema",
          schemaPath,
          prompt,
        ],
        {
          windowsHide: true,
          cwd: temporaryDirectory,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      let finalMessage = "";
      const onAbort = () => child.kill();
      signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", chunk => {
        stdout += chunk.toString();
        for (const line of stdout.split(/\r?\n/).slice(0, -1)) {
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            const item = event.item as Record<string, unknown> | undefined;
            if (event.type === "item.completed" && item?.type === "agent_message") {
              finalMessage = typeof item.text === "string" ? item.text : finalMessage;
            }
          } catch {
            // 不完整或非 JSON 的事件由进程结束后的错误处理统一报告。
          }
        }
        stdout = stdout.includes("\n") ? stdout.slice(stdout.lastIndexOf("\n") + 1) : stdout;
      });
      child.stderr.on("data", chunk => {
        stderr += chunk.toString();
      });
      child.once("error", error => reject(error));
      child.once("close", code => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) {
          resolve({ reply: "[已终止]", commands: [] });
          return;
        }
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Codex CLI 已退出（${code ?? "未知"}）。`));
          return;
        }
        if (!finalMessage) {
          reject(new Error("Codex CLI 未返回有效结果。"));
          return;
        }
        try {
          const result = parseCodexOutput(finalMessage);
          if (result.reply) sendChunk?.(result.reply);
          resolve(result);
        } catch {
          reject(new Error("Codex CLI 返回格式无效。"));
        }
      });
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
