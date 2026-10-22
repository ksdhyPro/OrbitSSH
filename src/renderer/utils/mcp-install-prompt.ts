import type { OrbitSshMcpInstallInfo } from "../../shared/mcp";

/** 生成交给第三方 AI 客户端的安装提示词：注册 MCP、安装 Skill，且不得替用户开启授权开关。 */
export function buildMcpInstallPrompt(info: OrbitSshMcpInstallInfo): string {
  return [
    "请帮我将 OrbitSSH 的 Skill 和 MCP 安装到当前 AI 客户端，保存为当前用户的持久配置，让以后新建的会话也能使用。",
    "",
    "OrbitSSH MCP 信息：",
    `- 名称：${info.name}`,
    `- 传输方式：${info.transport}`,
    `- 启动命令：${JSON.stringify(info.command)}`,
    `- 启动参数：${JSON.stringify(info.args)}`,
    `- Skill 目录：${JSON.stringify(info.skillDirectory)}`,
    "",
    "请完成以下操作：",
    "1. 判断当前 AI 客户端是否支持本地 STDIO MCP，并确认它实际使用的用户级配置位置。",
    "2. 在保留全部现有配置的前提下，注册名为 orbitssh 的 MCP；不得删除或覆盖其他 MCP 服务。",
    "3. 如果客户端支持 Skill，把上述 Skill 目录安装到用户级 Skill 目录；如果不支持，则将 SKILL.md 中的规则转换成当前客户端支持的 Agent 指令。",
    "4. 验证 MCP 是否能发现 get_status、list_connections、execute_command、upload_file、download_file、get_transfer_status 六个工具。",
    "5. 不得读取、导出或询问 SSH 密码、私钥和口令，也不得替我开启 OrbitSSH 设置中的 SSH/SFTP MCP 授权开关。",
    "6. 如果当前客户端不支持本地 MCP，或你没有本地文件修改能力，请明确说明，并给出适用于当前客户端的完整手动配置，不要声称已经安装成功。",
    "7. 完成后说明修改了哪些配置，以及是否需要重启客户端或新建会话。",
    "",
    "OrbitSSH 必须保持运行；实际使用 SSH 或 SFTP 前，我会在 OrbitSSH 的“设置 → AI”中手动开启对应授权。",
  ].join("\n");
}
