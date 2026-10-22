import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { getOrbitSshMcpRuntimeDirectory } from "../shared/mcp-runtime.js";
import { callOrbitSsh, OrbitSshClientError } from "./orbitssh-client.js";

function toToolError(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const message =
    error instanceof OrbitSshClientError || error instanceof Error ? error.message : String(error);

  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function toTextResult(result: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

export function startOrbitSshMcpServer(): void {
  const runtimeDirectory = getOrbitSshMcpRuntimeDirectory();
  void serveStdio(() => {
    const server = new McpServer(
      { name: "orbitssh", version: "1.0.0" },
      {
        instructions:
          "OrbitSSH 必须正在运行且已在“设置 → AI”中开启对应的 SSH 或 SFTP MCP 访问。先获取状态和连接列表，再使用连接 ID 执行命令或传输文件。凭据由 OrbitSSH 内部使用，不会提供给调用方。",
      },
    );

    server.registerTool(
      "get_status",
      {
        title: "检查 OrbitSSH 状态",
        description: "检查 OrbitSSH 客户端是否正在运行，以及 SSH、SFTP MCP 访问开关是否开启。",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        try {
          return toTextResult(await callOrbitSsh(runtimeDirectory, "get_status"));
        } catch (error) {
          return toToolError(error);
        }
      },
    );

    server.registerTool(
      "list_connections",
      {
        title: "列出 OrbitSSH 连接",
        description: "列出允许通过 OrbitSSH 使用的已保存连接，仅返回连接 ID 和显示名称。",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        try {
          return toTextResult(await callOrbitSsh(runtimeDirectory, "list_connections"));
        } catch (error) {
          return toToolError(error);
        }
      },
    );

    server.registerTool(
      "execute_command",
      {
        title: "通过 OrbitSSH 执行远程命令",
        description:
          "使用指定的已保存连接执行远程 Shell 命令。OrbitSSH 不对命令内容应用内置 AI 风险策略或逐条审批。",
        inputSchema: z.object({
          connectionId: z.string().min(1).describe("list_connections 返回的连接 ID"),
          command: z.string().min(1).max(100_000).describe("要原样执行的远程 Shell 命令"),
          workingDirectory: z.string().min(1).optional().describe("可选的远程工作目录"),
          timeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ connectionId, command, workingDirectory, timeoutMs }) => {
        try {
          const waitMs = (timeoutMs ?? 60_000) + 10_000;
          return toTextResult(
            await callOrbitSsh(
              runtimeDirectory,
              "execute_command",
              { connectionId, command, workingDirectory, timeoutMs },
              waitMs,
            ),
          );
        } catch (error) {
          return toToolError(error);
        }
      },
    );

    server.registerTool(
      "upload_file",
      {
        title: "通过 OrbitSSH 上传单文件",
        description:
          "把指定本地绝对路径的单文件上传到远程路径。工具立即返回任务 ID；目标文件默认覆盖，未完成内容保存在远程同名 .download 文件中，再次使用相同路径可断点续传。",
        inputSchema: z.object({
          connectionId: z.string().min(1).describe("list_connections 返回的连接 ID"),
          localPath: z.string().min(1).describe("上传源文件的本地绝对路径"),
          remotePath: z.string().min(1).describe("包含文件名的远程目标路径"),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ connectionId, localPath, remotePath }) => {
        try {
          return toTextResult(
            await callOrbitSsh(runtimeDirectory, "upload_file", {
              connectionId,
              localPath,
              remotePath,
            }),
          );
        } catch (error) {
          return toToolError(error);
        }
      },
    );

    server.registerTool(
      "download_file",
      {
        title: "通过 OrbitSSH 下载单文件",
        description:
          "把指定远程单文件下载到本地绝对路径。工具立即返回任务 ID；目标文件默认覆盖，未完成内容保存在本地同名 .download 文件中，再次使用相同路径可断点续传。",
        inputSchema: z.object({
          connectionId: z.string().min(1).describe("list_connections 返回的连接 ID"),
          remotePath: z.string().min(1).describe("下载源文件的远程路径"),
          localPath: z.string().min(1).describe("包含文件名的本地绝对目标路径"),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ connectionId, remotePath, localPath }) => {
        try {
          return toTextResult(
            await callOrbitSsh(runtimeDirectory, "download_file", {
              connectionId,
              remotePath,
              localPath,
            }),
          );
        } catch (error) {
          return toToolError(error);
        }
      },
    );

    server.registerTool(
      "get_transfer_status",
      {
        title: "查询 OrbitSSH SFTP 传输进度",
        description:
          "使用上传或下载工具返回的任务 ID 查询当前状态、已传输字节数、总字节数、速度和错误。",
        inputSchema: z.object({
          id: z.string().min(1).describe("upload_file 或 download_file 返回的任务 ID"),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ id }) => {
        try {
          return toTextResult(await callOrbitSsh(runtimeDirectory, "get_transfer_status", { id }));
        } catch (error) {
          return toToolError(error);
        }
      },
    );

    return server;
  });
}
