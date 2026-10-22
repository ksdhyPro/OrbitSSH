import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HELP_CHANGELOG_URL, HELP_FEEDBACK_URL } from "../../src/shared/help-links";
import { readSource } from "./helpers/source";

/**
 * 以下逻辑仍内嵌在 App.vue、DataTransferDialog.vue、TerminalPanel.vue、StatusBar.vue 等
 * 超大组件中，暂时无法独立挂载。拆分组件后应逐条改写为行为测试并删除对应契约。
 */
const app = () => readSource("src/renderer/App.vue");
const terminalPanel = () => readSource("src/renderer/components/TerminalPanel.vue");
const dataTransferDialog = () => readSource("src/renderer/components/DataTransferDialog.vue");

describe("App 布局与工作模式", () => {
  it("普通模式不渲染 AI 对话，AI 模式只保留服务器面板并把 AI 作为主视图", () => {
    const source = app();
    expect(source).toMatch(/const isAiWorkspace = computed\(\(\) => appSettings\.ai\.enabled\)/);
    // AI 模式只保留服务器面板由 sidebar-panels.test.ts 验证。
    expect(source).toMatch(/useSidebarPanels\(\{\s*appSettings,\s*isAiWorkspace,/);
    expect(source).toMatch(/:ai-workspace="isAiWorkspace"/);
    expect(source).toMatch(/<AiPanel\s+layout="workspace"/);
    expect(source).not.toMatch(/startAiPanelResize/);
    expect(source).toMatch(/:context-usage="aiContextUsage"/);
    expect(terminalPanel()).toMatch(
      /<div v-if="aiWorkspace" class="ai-workspace-main">\s*<slot \/>/,
    );
  });

  it("AI 助手标题栏的打开 SSH 复用 AppDialog 承载终端区域", () => {
    // 打开 SSH 按钮本身的行为由 ai-panel-approval.test.ts 挂载组件验证。
    const aiPanel = readSource("src/renderer/components/AiPanel.vue");
    expect(aiPanel).toMatch(/class="ai-context-tag"/);
    expect(app()).toMatch(/@open-ssh="openTerminalDialog\(activeTabId\)"/);
    expect(terminalPanel()).toMatch(
      /<AppDialog\s+v-if="isTerminalDialogVisible"[\s\S]*?width="terminal"/,
    );
    // 终端区域整体在原位与弹窗之间移动，不重新创建 xterm 实例。
    expect(terminalPanel()).toMatch(/nextParent\.appendChild\(stage\)/);
    expect(readSource("src/renderer/stores/useTerminalsStore.ts")).toMatch(
      /async function openTerminalDialog\(tabId: string\)/,
    );
  });
});

describe("左侧面板拖拽与尺寸", () => {
  it("App 模板把拖拽排序与分隔条事件绑定到 useSidebarPanels", () => {
    // 排序、折叠、调整高度的行为由 sidebar-panels.test.ts 验证。
    const source = app();
    expect(source).toMatch(/useSidebarPanels\(\{/);
    expect(source).toMatch(/@dragstart="startSidebarPanelDrag\(\$event, panel\)"/);
    expect(source).toMatch(/@drop="finishSidebarPanelDrag\(\$event, panel\)"/);
    expect(source).toMatch(/v-if="!isAiWorkspace && !isLastSidebarPanel\(panel\)"/);
    expect(source).toMatch(/@pointerdown="startSidebarPanelResize\(\$event, panel\)"/);
    expect(source).toMatch(/ref="sidebarPanelsElement"/);
  });

  it("三个面板共用 SidebarPanel 外壳，标题行可直接拖拽", () => {
    expect(readSource("src/renderer/components/ui/SidebarPanel.vue")).toMatch(
      /class="panel-header"\s+draggable="true"/,
    );
    for (const file of ["ServerSidebar.vue", "AutomationSidebar.vue", "SftpPanel.vue"]) {
      expect(readSource(`src/renderer/components/${file}`)).toMatch(/<SidebarPanel\b/);
    }
    for (const file of ["ServerSidebar.vue", "AutomationSidebar.vue"]) {
      expect(readSource(`src/renderer/components/${file}`)).toMatch(/<GroupedList\b/);
    }
  });
});

describe("文件传输弹窗", () => {
  it("右键菜单使用鼠标视口坐标并挂载到 body", () => {
    const source = dataTransferDialog();
    expect(source).toMatch(
      /import\s*\{\s*resolveMenuPlacement\s*\}\s*from\s*"\.\.\/utils\/menu-position"/,
    );
    expect(source).toMatch(
      /return resolveMenuPlacement\(\s*\{\s*x:\s*event\.clientX,\s*y:\s*event\.clientY\s*\}/,
    );
    expect(source).toMatch(
      /<Teleport to="body">[\s\S]*?<ContextMenu[\s\S]*?menu-class="data-transfer-context-menu"[\s\S]*?<\/Teleport>/,
    );
  });

  it("左右位置下拉均提供本地选项，两侧都为本地时禁止传输", () => {
    const source = dataTransferDialog();
    const leftOptions = source.match(
      /const leftServerOptions[\s\S]*?const rightServerOptions/,
    )?.[0];
    const rightOptions = source.match(
      /const rightServerOptions[\s\S]*?const transferMenuItems/,
    )?.[0];
    expect(leftOptions).toMatch(/value:\s*LOCAL_ENDPOINT_ID/);
    expect(rightOptions).toMatch(/value:\s*LOCAL_ENDPOINT_ID/);

    const transferGuard = source.match(
      /function canTransferFromPane[\s\S]*?function isContextMultiSelection/,
    )?.[0];
    expect(transferGuard).toMatch(/hasRemoteEndpoint/);
    expect(transferGuard).toMatch(/!isLocalPane\(sourcePane\)\s*\|\|\s*!isLocalPane\(targetPane\)/);
  });

  it("左右列表可独立切换修改时间排序", () => {
    const source = dataTransferDialog();
    expect(source).toMatch(/modifyTimeSortDirection:\s*"desc"/);
    expect(source).toMatch(/compareByModifyTime\(pane\.modifyTimeSortDirection\)/);
    expect(source).toMatch(/togglePaneModifyTimeSort\(leftPane\)/);
    expect(source).toMatch(/togglePaneModifyTimeSort\(rightPane\)/);
    expect(source).toMatch(/左侧修改时间，当前/);
    expect(source).toMatch(/右侧修改时间，当前/);
  });
});

describe("SFTP 面板", () => {
  it("文件列表提供修改时间排序入口，切换后重置范围选择锚点", () => {
    const workspace = readSource("src/renderer/composables/useRemoteFileWorkspace.ts");
    expect(workspace).toMatch(/compareByModifyTime\(modifyTimeSortDirection\.value\)/);
    expect(workspace).toMatch(/lastClickedIndex = -1/);
    const panel = readSource("src/renderer/components/SftpPanel.vue");
    expect(panel).toMatch(/class="file-list-sort-trigger"/);
    expect(panel).toMatch(/sort-arrow\.svg/);
    expect(panel).toMatch(/emit\('toggleModifyTimeSort'\)/);
  });

  it("远程文件编辑器的保存快捷键接入保存流程", () => {
    expect(readSource("src/renderer/stores/useFileEditorStore.ts")).toMatch(
      /onSaveShortcut:[\s\S]{0,120}saveFileEditor\(\)/,
    );
  });
});

describe("终端", () => {
  it("多行粘贴经由确认弹窗后再发送", () => {
    expect(readSource("src/renderer/stores/useTerminalsStore.ts")).toMatch(
      /requestTerminalPaste\(tabId, clipboardText\)/,
    );
    expect(terminalPanel()).toMatch(/<AppDialog[\s\S]*?确认粘贴多行文本/);
    expect(terminalPanel()).toMatch(/terminal-paste-preview/);
  });

  it("标签右键菜单复用通用组件并提供批量关闭", () => {
    const source = terminalPanel();
    expect(source).toMatch(/@contextmenu="openTabContextMenu\(\$event, tab\.id\)"/);
    expect(source).toMatch(/label: "关闭全部"/);
    expect(source).toMatch(/label: "关闭右侧终端"/);
    expect(source).toMatch(/:menu="tabContextMenu"/);
    expect(source).toMatch(/props\.tabs\.slice\(targetIndex \+ 1\)/);
    expect(app()).toMatch(/@close-tabs="closeTerminalTabs"/);
  });
});

describe("状态栏迷你折线", () => {
  it("模板暂时隐藏但持续记录 CPU、内存和磁盘采样", () => {
    // 绘制逻辑的行为由 status-sparkline.test.ts 验证。
    const source = readSource("src/renderer/components/StatusBar.vue");
    expect(source).toMatch(/appendHistory\(tabId, "cpu", result\.cpuUsage\)/);
    expect(source).toMatch(/appendHistory\(tabId, "memory", result\.memoryUsage\)/);
    expect(source).toMatch(/appendSparklineValue\(history\[key\], value\)/);
    expect(source.match(/'status-sparkline'/g)).toHaveLength(3);
    expect(source.match(/暂时隐藏迷你折线，保留实现便于后续直接恢复。/g)).toHaveLength(3);
  });
});

describe("删除确认", () => {
  function listRendererSources(directory: string): string[] {
    return readdirSync(path.resolve(process.cwd(), directory), { withFileTypes: true }).flatMap(
      entry => {
        const relativePath = `${directory}/${entry.name}`;
        if (entry.isDirectory()) return listRendererSources(relativePath);
        return /\.(vue|ts)$/.test(entry.name) ? [relativePath] : [];
      },
    );
  }

  it("渲染层不使用原生 confirm，删除操作统一走应用内确认弹窗", () => {
    for (const file of listRendererSources("src/renderer")) {
      expect(readSource(file), file).not.toMatch(/\bwindow\.confirm\s*\(/);
    }
    const portForward = readSource("src/renderer/components/PortForwardDialog.vue");
    expect(portForward).toMatch(/DeleteConfirmDialog/);
    expect(portForward).toMatch(/@confirm="remove"/);
    expect(readSource("src/renderer/components/ServerSidebar.vue")).toMatch(/DeleteConfirmDialog/);
    expect(app()).toMatch(/requestConfirm\(/);
  });
});

describe("帮助菜单", () => {
  it("标题栏帮助菜单提供提交反馈和更新日志，preload 暴露对应通道", () => {
    const titleBar = readSource("src/renderer/components/TitleBarTabs.vue");
    expect(titleBar).toMatch(/label: "提交反馈"/);
    expect(titleBar).toMatch(/label: "更新日志"/);
    const preload = readSource("src/preload/index.cts");
    expect(preload).toMatch(/help:open-feedback/);
    expect(preload).toMatch(/help:open-changelog/);
    expect(HELP_FEEDBACK_URL).toBe("https://gitee.com/ksdhy/orbit-ssh/issues");
    expect(HELP_CHANGELOG_URL).toBe("https://gitee.com/ksdhy/orbit-ssh/blob/master/docs/update.md");
  });
});
