export interface ShortcutDefinition {
  id: string;
  title: string;
  description: string;
  keys: string[];
}

export interface ShortcutSection {
  id: string;
  title: string;
  description: string;
  shortcuts: ShortcutDefinition[];
}

// 根据当前平台生成展示文案，便于后续把展示与真实快捷键配置继续收拢到同一处。
export function getShortcutSections(isMac: boolean): ShortcutSection[] {
  const modKey = isMac ? "Cmd" : "Ctrl";

  return [
    {
      id: "global",
      title: "全局",
      description: "应用窗口内始终生效的快捷键。",
      shortcuts: [
        {
          id: "open-search",
          title: "打开搜索",
          description:
            "优先打开文件编辑器搜索；未打开编辑器时打开当前终端搜索。",
          keys: [`${modKey} + F`],
        },
        {
          id: "close-floating-layer",
          title: "关闭浮层或搜索",
          description: "关闭已展开的浮层菜单，或退出当前搜索栏。",
          keys: ["Esc"],
        },
      ],
    },
    {
      id: "terminal-edit",
      title: "终端编辑",
      description: "终端面板聚焦时可用。",
      shortcuts: [
        {
          id: "terminal-copy",
          title: "复制选区",
          description: "把当前终端选中的文本复制到剪贴板。",
          keys: [`${modKey} + Shift + C`],
        },
        {
          id: "terminal-paste",
          title: "粘贴文本",
          description: "把剪贴板中的文本粘贴到当前终端。",
          keys: [`${modKey} + Shift + V`],
        },
      ],
    },
    {
      id: "terminal",
      title: "终端搜索",
      description: "当前终端搜索栏打开后可用。",
      shortcuts: [
        {
          id: "terminal-search-next",
          title: "下一个匹配项",
          description: "在终端搜索结果中跳到下一个匹配项。",
          keys: ["Enter"],
        },
        {
          id: "terminal-search-previous",
          title: "上一个匹配项",
          description: "在终端搜索结果中跳到上一个匹配项。",
          keys: ["Shift + Enter", "Shift + Tab"],
        },
        {
          id: "terminal-search-close",
          title: "关闭终端搜索",
          description: "清空搜索词并把焦点交还给当前终端。",
          keys: ["Esc"],
        },
      ],
    },
    {
      id: "file-editor",
      title: "文件编辑器",
      description: "远程文本文件编辑窗口内可用。",
      shortcuts: [
        {
          id: "file-editor-open-search",
          title: "打开编辑器搜索",
          description: "在文件编辑器内打开搜索和替换工具栏。",
          keys: [`${modKey} + F`],
        },
        {
          id: "file-editor-search-next",
          title: "下一个匹配项",
          description: "搜索输入框内跳到下一个匹配项。",
          keys: ["Enter"],
        },
        {
          id: "file-editor-search-previous",
          title: "上一个匹配项",
          description: "搜索输入框内跳到上一个匹配项。",
          keys: ["Shift + Enter", "Shift + Tab"],
        },
        {
          id: "file-editor-replace-current",
          title: "替换当前匹配项",
          description: "替换输入框内执行当前匹配项替换。",
          keys: ["Enter"],
        },
        {
          id: "file-editor-close-search",
          title: "关闭编辑器搜索",
          description: "关闭搜索和替换工具栏，并回到编辑器正文。",
          keys: ["Esc"],
        },
      ],
    },
    {
      id: "sftp",
      title: "远程文件",
      description: "远程文件列表、路径输入和重命名状态下可用。",
      shortcuts: [
        {
          id: "sftp-select-all",
          title: "全选当前文件列表",
          description: "选中当前远程文件区域中可见的全部文件节点。",
          keys: [`${modKey} + A`],
        },
        {
          id: "sftp-range-select",
          title: "范围选择",
          description:
            "按住 Shift 点击文件节点，选择锚点到当前节点之间的范围。",
          keys: ["Shift + Click"],
        },
        {
          id: "sftp-toggle-select",
          title: "切换选择",
          description: "按住修饰键点击文件节点，加入或移出当前选择。",
          keys: [`${modKey} + Click`],
        },
        {
          id: "sftp-submit-path",
          title: "跳转远程路径",
          description: "在路径输入框内提交当前输入的远程目录。",
          keys: ["Enter"],
        },
        {
          id: "sftp-commit-rename",
          title: "确认重命名",
          description: "在重命名输入框内提交新名称。",
          keys: ["Enter"],
        },
        {
          id: "sftp-cancel-rename",
          title: "取消重命名",
          description: "在重命名输入框内放弃当前名称编辑。",
          keys: ["Esc"],
        },
      ],
    },
    {
      id: "data-transfer",
      title: "文件传输",
      description: "文件传输弹窗内，按当前焦点面板生效。",
      shortcuts: [
        {
          id: "transfer-select-all",
          title: "全选当前面板",
          description: "选中源或目标面板内当前可选的全部节点。",
          keys: [`${modKey} + A`],
        },
        {
          id: "transfer-range-select",
          title: "范围选择",
          description: "按住 Shift 点击节点，选择锚点到当前节点之间的范围。",
          keys: ["Shift + Click"],
        },
        {
          id: "transfer-toggle-select",
          title: "切换选择",
          description: "按住修饰键点击节点，加入或移出当前选择。",
          keys: [`${modKey} + Click`],
        },
      ],
    },
  ];
}
