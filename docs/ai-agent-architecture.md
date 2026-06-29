# OrbitSSH AI Agent 执行逻辑

## 概述

OrbitSSH 内置了一个 AI 助手，能够根据用户提问在远程 SSH 服务器上自动执行诊断命令。AI Agent 采用**多轮对话 + 命令策略审核 + 分级审批**的架构，在保证安全的前提下实现自动化服务器诊断。

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (Vue 前端)                                     │
│  ┌──────────────┐  ┌──────────────────┐                 │
│  │  AiPanel.vue  │  │  useAiStore.ts   │                 │
│  │  (UI 组件)    │◄─┤  (状态管理)       │                 │
│  └──────────────┘  └────────┬─────────┘                 │
├─────────────────────────────┼───────────────────────────┤
│  Preload (IPC 桥接)          │                            │
│  ┌──────────────────────────▼─────────────────────────┐ │
│  │  index.ts / index.cjs / preload.d.ts                │ │
│  │  orbitSSHApi.ai.chat() / runApprovedCommand() ...   │ │
│  └──────────────────────────┬─────────────────────────┘ │
├─────────────────────────────┼───────────────────────────┤
│  Main Process (Electron 后端)│                            │
│  ┌──────────────────────────▼─────────────────────────┐ │
│  │  ai-ipc.ts (IPC 路由)                               │ │
│  │  ai:chat / ai:run-approved-command / ai:reject      │ │
│  └──────┬──────────────────────────────────────────────┘ │
│         │                                                 │
│  ┌──────▼──────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  ai-agent.ts     │  │  ai-tools.ts  │  │  command-    │ │
│  │  (核心 Agent)    │  │  (工具层)     │  │  policy.ts   │ │
│  └──────┬──────────┘  └──────────────┘  └─────────────┘ │
│         │                                                 │
│  ┌──────▼──────────┐                                     │
│  │  session-        │                                     │
│  │  manager.ts      │                                     │
│  │  (SSH 命令执行)   │                                     │
│  └─────────────────┘                                     │
└─────────────────────────────────────────────────────────┘
```

## 核心文件说明

| 文件 | 作用 |
|------|------|
| [src/shared/ai.ts](../src/shared/ai.ts) | 所有 AI 相关的共享类型定义 |
| [src/main/ai/command-policy.ts](../src/main/ai/command-policy.ts) | 命令安全策略：评估命令风险等级，判断是否需要审批 |
| [src/main/ai/ai-tools.ts](../src/main/ai/ai-tools.ts) | 独立的命令审批/执行工具（用于外部调用场景） |
| [src/main/ai/ai-agent.ts](../src/main/ai/ai-agent.ts) | AI Agent 核心：多轮对话循环、系统提示词、审批状态管理 |
| [src/main/ipc/ai-ipc.ts](../src/main/ipc/ai-ipc.ts) | IPC 路由注册，将前端请求路由到 Agent |
| [src/renderer/stores/useAiStore.ts](../src/renderer/stores/useAiStore.ts) | 前端 Pinia 状态管理 |
| [src/renderer/components/AiPanel.vue](../src/renderer/components/AiPanel.vue) | AI 助手 UI 面板 |
| [src/preload/index.ts](../src/preload/index.ts) + index.cjs | Electron contextBridge API 暴露 |
| [src/types/preload.d.ts](../src/types/preload.d.ts) | Window.orbitSSH 的 TypeScript 类型声明 |

## 执行流程详解

### 1. 用户发起对话

```
用户输入问题 → AiPanel.vue 按回车
  → emit("send")
  → useAiStore.sendMessage(context)
    → 创建 user message 并加入 messages[]
    → 调用 orbitSSHApi.ai.chat(input)  // IPC 调用
      → preload: ipcRenderer.invoke("ai:chat", input)
        → ai-ipc.ts: runAiChat(input, getSettings())
```

**输入数据结构** (`AiChatInput`):

```typescript
interface AiChatInput {
  tabId: string;          // 终端标签页 ID
  mode: "ask" | "auto" | "full";  // 审批模式
  message: string;        // 用户问题
  context: AiContextInput; // 服务器上下文（路径、状态等）
  history: AiMessage[];   // 最近 10 条对话历史
}
```

### 2. Agent 多轮循环 (`runAgentLoop`)

核心函数，位于 [ai-agent.ts:514](../src/main/ai/ai-agent.ts#L514)：

```
runAgentLoop(input, settings, previousCards, executedCommands)
  │
  ├─ while (executedCommands.length < maxAgentCommandCount)  // 最多 6 条命令
  │   │
  │   ├─ requestAiTurn(input, settings, executedCommands)
  │   │   │
  │   │   ├─ getTerminalContextSnapshot(tabId)     // 获取终端上下文
  │   │   ├─ buildSystemPrompt(...)                // 构建系统提示词
  │   │   ├─ buildAiMessages(...)                  // 构建消息列表
  │   │   │
  │   │   ├─ AI 未启用? → createLocalFallback()    // 本地规则回退
  │   │   │
  │   │   └─ fetch(DeepSeek API)                   // 调用 AI 模型
  │   │       ├─ 响应 OK → parseAssistantResponse()
  │   │       ├─ 响应异常 → createAiStatusErrorResponse()
  │   │       └─ 网络错误 → createAiRequestErrorResponse()
  │   │
  │   ├─ 解析 AI 回复：reply + commands[]
  │   │
  │   ├─ 无下一条命令? → 返回最终结果
  │   │
  │   ├─ getNextParsedCommand(parsed)  // 提取并评估命令策略
  │   │
  │   ├─ shouldRequestApproval(mode, command, risk)?
  │   │   ├─ YES → 存储 PendingApprovalState，返回审批卡片，暂停循环
  │   │   │
  │   │   └─ NO  → 自动执行命令
  │   │       ├─ executeTerminalCommand(tabId, command)
  │   │       ├─ 记录到 executedCommands[]
  │   │       ├─ 更新 commandCards[]
  │   │       └─ 继续循环（AI 看到新结果后可能返回新命令）
  │   │
  │   └─ 执行失败? → 返回失败卡片，终止循环
  │
  └─ 达到最大命令数 → 返回结果并提示限制
```

### 3. 系统提示词 (`buildSystemPrompt`)

位于 [ai-agent.ts:98](../src/main/ai/ai-agent.ts#L98)，向 AI 注入以下上下文：

- **角色定义**：OrbitSSH 内置的 AI 助手
- **安全约束**：不泄露密码/密钥，不声称未执行的命令
- **输出格式**：严格 JSON `{"reply":"...","commands":[...]}`
- **命令限制**：每次最多返回一条命令
- **终止条件**：已有足够信息回答时 commands 返回空数组
- **风险标记**：高风险操作必须标记 risk 为 "high"
- **模式说明**：告知 AI 当前处于 ask/auto/full 模式
- **服务器上下文**：标签页 ID、服务器名、当前路径、连接状态
- **已执行命令结果**：之前各轮命令的输出
- **终端最近输出**：最多 3000 字符

### 4. 命令安全策略 (`command-policy.ts`)

三级安全评估，位于 [command-policy.ts:137](../src/main/ai/command-policy.ts#L137)：

```
evaluateAiCommand(command)
  │
  ├─ 命令为空? → deny
  │
  ├─ 命中 DENIED_PREFIXES? → requires_approval
  │   （rm, mkfs, dd, shutdown, reboot, poweroff, halt）
  │
  ├─ 包含 DANGEROUS_TOKENS? → requires_approval
  │   （sudo, >, <, |, &&, ||, ;, `, $(), &）
  │
  ├─ 命中 READONLY_PATTERNS? → allow_readonly
  │
  └─ 其他 → requires_approval
```

**只读白名单命令示例** (~30+ 正则)：

| 类别 | 示例命令 |
|------|---------|
| 系统信息 | `pwd`, `whoami`, `hostname`, `uname -a`, `uptime` |
| 磁盘/内存 | `df -h`, `free -h`, `du -sh .` |
| 进程/网络 | `ps aux`, `ss -tulpn`, `ip addr`, `netstat -lntp` |
| 文件查看 | `ls -la`, `cat`, `head -n N`, `tail -n N`, `grep`, `stat`, `file` |
| 服务状态 | `systemctl status`, `journalctl -u`, `service ... status` |
| Docker | `docker ps`, `docker images`, `docker logs --tail N`, `docker inspect` |
| Git | `git status`, `git log --oneline`, `git branch`, `git diff` |

**强制审批条件** (`requiresMandatoryApproval`)：

1. 风险等级为 `"high"`
2. 命令首词在 `MUST_APPROVE_PREFIXES` 中（apt, yum, npm, pip, chmod, chown, passwd 等）
3. 包含 `DANGEROUS_TOKENS`（管道、重定向、sudo 等）
4. 命中 Docker 危险模式（`docker rm/stop/restart/kill/exec`）
5. 命中服务管理模式（`systemctl stop/restart/enable/disable`）

### 5. 审批模式决策 (`shouldRequestApproval`)

位于 [ai-agent.ts:326](../src/main/ai/ai-agent.ts#L326)：

```
shouldRequestApproval(mode, command, risk)
  │
  ├─ mode === "ask"     → 始终需要审批
  ├─ mode === "auto"    → 只读白名单命令自动执行，其他需要审批
  └─ mode === "full"    → 仅强制审批命令需要审批，其余自动执行
```

| 模式 | 图标 | 行为 |
|------|------|------|
| `ask` | 🛡️ | 每条命令都需要用户手动批准 |
| `auto` | ⚡ | 只读白名单命令自动执行，其他命令需批准 |
| `full` | 🔓 | 除强制审批命令外全部自动执行 |

### 6. 命令审批与恢复流程

```
AI 返回需审批命令
  │
  ├─ 创建 PendingApprovalState（5 分钟 TTL）
  │   { input, command, reason, risk, cardId, previousCards, executedCommands }
  │
  ├─ 返回 AiCommandCard (status: "requires_approval") 到前端
  │
  ├─ 用户点击"批准执行"
  │   → useAiStore.runApprovedCommand(card)
  │     → IPC: "ai:run-approved-command"
  │       → runApprovedAiCommand()
  │         ├─ 验证 approvalId 存在且未过期
  │         ├─ 验证 tabId 和 command 匹配
  │         ├─ executeTerminalCommand()
  │         └─ 恢复 runAgentLoop() 继续循环
  │
  └─ 用户点击"拒绝"
      → useAiStore.rejectApproval(card)
        → IPC: "ai:reject-command-approval"
          → rejectAiCommandApproval()
            ├─ 删除 PendingApprovalState
            └─ 前端卡片状态更新为 "rejected"
```

### 7. 命令执行 (`executeTerminalCommand`)

位于 [src/main/ssh/session-manager.ts](../src/main/ssh/session-manager.ts)：

- 使用 `ssh2` 库的 `client.exec()` 在远程服务器执行命令
- 默认超时 12-20 秒（AI Agent 使用 20 秒）
- 输出截断：stdout 最大 20KB，stderr 最大 10KB
- 返回 `AiCommandResult`：`{ stdout, stderr, exitCode, timedOut, durationMs }`

### 8. 本地回退 (`createLocalFallback`)

位于 [ai-agent.ts:261](../src/main/ai/ai-agent.ts#L261)，当 AI 未启用或 API Key 为空时：

- 已有执行结果 → 提示用户自行判断
- 包含 "disk"/"磁盘" → 建议 `df -h`
- 包含 "nginx" → 建议 `systemctl status nginx` + `journalctl -u nginx`
- 其他 → 通用建议

## 数据流图

```
┌──────────┐     ┌──────────────┐     ┌───────────┐     ┌──────────────┐
│ AiPanel  │────►│ useAiStore   │────►│ Preload   │────►│ ai-ipc.ts    │
│ (输入框)  │     │ sendMessage()│     │ IPC.invoke│     │ ai:chat      │
└──────────┘     └──────────────┘     └───────────┘     └──────┬───────┘
                                                               │
                                              ┌────────────────┘
                                              ▼
┌──────────┐     ┌──────────────┐     ┌───────────┐     ┌──────────────┐
│ AiPanel  │◄────┤ useAiStore   │◄────┤ Preload   │◄────┤ runAiChat()  │
│ (消息列表)│     │ applyResult()│     │ IPC回复   │     │ runAgentLoop │
└──────────┘     └──────────────┘     └───────────┘     └──────┬───────┘
                                                               │
                                              ┌────────────────┘
                                              ▼
                                    ┌──────────────────┐
                                    │ requestAiTurn()  │
                                    │  ├─ buildPrompt  │
                                    │  ├─ fetch(API)   │
                                    │  └─ parseJSON    │
                                    └──────┬───────────┘
                                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                        ┌─────────┐  ┌─────────┐  ┌─────────┐
                        │ 自动执行 │  │ 需要审批 │  │ 无命令  │
                        │ 命令    │  │ 暂停循环 │  │ 返回结果 │
                        └────┬────┘  └────┬────┘  └─────────┘
                             │            │
                             ▼            ▼
                    ┌──────────────┐  ┌──────────────┐
                    │ SSH exec()   │  │ 用户批准/拒绝 │
                    │ 收集结果     │  │ 后恢复循环   │
                    │ 继续下一轮   │  └──────────────┘
                    └──────────────┘
```

## 关键常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `maxAgentCommandCount` | 6 | 单轮最多执行命令数 |
| `approvalTtlMs` | 5 分钟 | 审批请求有效期 |
| `execTimeoutMs` | 20 秒 | Agent 命令执行超时 |
| `historyLimit` | 最近 8 条 | 发送给 AI 的历史消息数 |
| `stdoutLimit` | 20KB | 命令输出截断上限 |
| `terminalContextLimit` | 3000 字符 | 终端上下文截断上限 |
| `commandOutputLimit` | 1800 字符 | 已执行命令输出截断上限 |

## ai-tools.ts 独立工具层

[ai-tools.ts](../src/main/ai/ai-tools.ts) 提供了一套与 Agent 循环**独立的**命令审批/执行 API，适用于工具调用场景：

- `runReadonlyAiCommand(tabId, command)` — 策略检查后直接执行只读命令
- `requestAiCommandApproval(input)` — 创建审批请求（独立于 Agent 循环的审批存储）
- `runApprovedAiCommand(input)` — 执行已批准的命令

这些工具使用独立的 `approvals` Map 存储审批状态，与 Agent 循环中的 `pendingApprovals` 不共享。

## 安全设计要点

1. **多层防御**：DENIED_PREFIXES → DANGEROUS_TOKENS → 白名单匹配 → MUST_APPROVE 匹配
2. **模式隔离**：三种模式（ask/auto/full）对应不同的自动执行权限
3. **审批时效**：所有审批请求在 5 分钟后自动失效
4. **命令验证**：执行前验证 approvalId、tabId、command 三重匹配
5. **输出截断**：防止大量输出撑爆 AI 上下文
6. **本地回退**：AI 不可用时仍可通过规则提供基础建议
