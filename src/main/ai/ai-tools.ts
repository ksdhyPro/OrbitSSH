/** Agent 可调用的工具定义（OpenAI 兼容格式），每轮必须且只能调用其中一个。 */
export const aiTools = [
  {
    type: "function" as const,
    function: {
      name: "run_shell_command",
      description: "在远程服务器上执行一条 Shell 命令，用于查看系统状态、日志、文件、进程等。",
      parameters: {
        type: "object" as const,
        properties: {
          command: { type: "string", description: "要执行的完整 Shell 命令" },
          reason: { type: "string", description: "为什么执行这条命令，用中文简短说明" },
          risk: {
            type: "string",
            enum: ["low", "medium", "high"],
            description:
              "命令风险级别：low=只读查询，medium=常规写入、安装或重启，high=删除、提权、凭据或不可逆操作",
          },
        },
        required: ["command", "reason", "risk"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_saved_server_command",
      description:
        "通过 OrbitSSH 已保存的 SSH 连接，在用户明确提及的服务器执行一条命令。授权模式和本地策略仍会生效。",
      parameters: {
        type: "object" as const,
        properties: {
          serverName: { type: "string", description: "用户提及的已保存服务器名称" },
          command: { type: "string", description: "要在目标服务器执行的完整 Shell 命令" },
          reason: { type: "string", description: "为什么执行这条命令，用中文简短说明" },
          risk: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "风险级别，与当前服务器命令使用相同标准",
          },
        },
        required: ["serverName", "command", "reason", "risk"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_long_shell_command",
      description:
        "在当前服务器启动一条可能长时间运行的 Shell 命令。本地会保持本次对话运行并定期把新增输出交回模型；不确定命令长短时优先使用此工具。",
      parameters: {
        type: "object" as const,
        properties: {
          command: {
            type: "string",
            description: "要执行一次的完整 Shell 命令，不能包含后台执行符号",
          },
          reason: { type: "string", description: "为什么执行这条命令，用中文简短说明" },
          risk: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "命令风险级别，与普通命令使用相同标准",
          },
        },
        required: ["command", "reason", "risk"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "report_long_command_progress",
      description:
        "仅在长命令状态为 running 时汇报当前进度，并让本地继续等待同一条命令。不得用于启动或重复执行命令。",
      parameters: {
        type: "object" as const,
        properties: {
          message: {
            type: "string",
            description: "直接展示给用户的简短进度说明；没有新增输出时说明任务仍在执行中",
          },
        },
        required: ["message"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "finish_response",
      description: "已有信息足够回答用户时结束当前 Agent 流程，并返回完整的中文最终答复。",
      parameters: {
        type: "object" as const,
        properties: {
          message: {
            type: "string",
            description: "直接展示给用户的完整最终答复，不能只描述准备执行的动作",
          },
        },
        required: ["message"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
];
