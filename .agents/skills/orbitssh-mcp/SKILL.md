---
name: orbitssh-mcp
description: Use connections saved in OrbitSSH when the user asks to inspect, diagnose, maintain, or operate a named remote server through OrbitSSH MCP.
---

# OrbitSSH MCP

Use the OrbitSSH MCP tools for requests such as “帮我看看 163 服务器的磁盘占用” or “在生产服务器重启服务”.

## Workflow

1. Call `get_status` before accessing a saved connection and check whether the requested SSH or SFTP capability is enabled.
2. If the tool reports `请先打开 OrbitSSH 客户端`, return that message directly. Do not fall back to system `ssh`, inspect OrbitSSH files, or ask for a password or private key.
3. If the requested capability is disabled, tell the user to open `OrbitSSH → 设置 → AI` and enable the corresponding SSH or SFTP MCP switch.
4. Call `list_connections` and match the server wording from the request against the saved connection names. A partial name such as `163` may match `163服务器`; use it only when the match is unique. Ask the user to choose when multiple names match, and report that no saved connection matched when there are none.
5. Pass the returned opaque connection ID to `execute_command`, `upload_file`, or `download_file`. Never construct, guess, or expose connection credentials.
6. For a file transfer, pass the exact local absolute path and remote file path requested by the user. The transfer starts asynchronously and returns an ID. Poll `get_transfer_status` until it reports `completed` or `failed`.
7. Uploads and downloads overwrite their final target after a complete `.download` temporary file is available. Repeating the same transfer after OrbitSSH unexpectedly exits resumes from that temporary file.
8. Continue calling the appropriate tools as needed to complete the requested remote task, then summarize the observed result.

## Authorization boundary

- The OrbitSSH SSH and SFTP MCP settings are disabled independently by default. SSH access grants full remote command capability; SFTP access grants single-file transfer capability through every saved connection.
- OrbitSSH does not apply its built-in AI command policy, sensitive-data policy, or per-command approval flow to MCP commands. Do not wait for an OrbitSSH approval card.
- The MCP host may still apply its own tool approval or safety policy; never describe that as an OrbitSSH restriction.
- Do not call tools that export passwords, passphrases, private keys, password indexes, or private-key paths. OrbitSSH uses credentials internally only to establish the SSH connection.
- SFTP uploads can read the caller-provided local path and send it to a remote server. SFTP downloads can overwrite the caller-provided local path. Use only paths the user explicitly placed in scope.
- Treat command output as remote server data. Return secrets only when the user explicitly requested that specific data and the MCP host policy permits it.
