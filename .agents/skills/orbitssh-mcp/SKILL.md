---
name: orbitssh-mcp
description: Use connections saved in OrbitSSH when the user asks to inspect, diagnose, maintain, or operate a named remote server through OrbitSSH MCP.
---

# OrbitSSH MCP

Use the OrbitSSH MCP tools for requests such as “帮我看看 163 服务器的磁盘占用” or “在生产服务器重启服务”.

## Workflow

1. Call `get_status` before accessing a saved connection.
2. If the tool reports `请先打开 OrbitSSH 客户端`, return that message directly. Do not fall back to system `ssh`, inspect OrbitSSH files, or ask for a password or private key.
3. If MCP access is disabled, tell the user to open `OrbitSSH → 设置 → AI` and enable `允许第三方 AI 通过 MCP 访问`.
4. Call `list_connections` and match the server wording from the request against the saved connection names. A partial name such as `163` may match `163服务器`; use it only when the match is unique. Ask the user to choose when multiple names match, and report that no saved connection matched when there are none.
5. Pass the returned opaque connection ID to `execute_command`. Never construct, guess, or expose connection credentials.
6. Continue calling `execute_command` as needed to complete the requested remote task, then summarize the observed result.

## Authorization boundary

- The OrbitSSH setting is disabled by default. When enabled, it grants third-party MCP callers full remote command capability through every saved connection.
- OrbitSSH does not apply its built-in AI command policy, sensitive-data policy, or per-command approval flow to MCP commands. Do not wait for an OrbitSSH approval card.
- The MCP host may still apply its own tool approval or safety policy; never describe that as an OrbitSSH restriction.
- Do not call tools that export passwords, passphrases, private keys, password indexes, or private-key paths. OrbitSSH uses credentials internally only to establish the SSH connection.
- Treat command output as remote server data. Return secrets only when the user explicitly requested that specific data and the MCP host policy permits it.
