import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import SettingsDialog from "../../src/renderer/components/SettingsDialog.vue";
import { defaultAppSettings, type AppSettings } from "../../src/shared/settings";
import { getStyleDeclarations } from "./helpers/styles";

function mountDialog(
  section: "general" | "ai",
  configure: (settings: AppSettings) => void = () => undefined,
) {
  const appSettings = structuredClone(defaultAppSettings);
  configure(appSettings);
  return mount(SettingsDialog, {
    props: {
      open: true,
      appSettings,
      activeSettingsSection: section,
      isMac: true,
      isSelectionBackgroundDropdownOpen: false,
      selectionBackgroundOptions: [],
    },
    global: { stubs: { teleport: true } },
  });
}

describe("SettingsDialog · AI", () => {
  it.each([
    ["是否允许跨服务器执行操作", "allowCrossServerOperations"],
    ["允许第三方 AI 通过 MCP 使用 SSH", "allowMcpAccess"],
    ["允许第三方 AI 通过 MCP 使用 SFTP", "allowMcpSftpAccess"],
  ])("「%s」开关默认关闭，切换后提交 %s", async (label, key) => {
    const wrapper = mountDialog("ai");
    const toggle = wrapper.get(`input[role="switch"][aria-label="${label}"]`);

    expect((toggle.element as HTMLInputElement).checked).toBe(false);
    await toggle.setValue(true);

    expect(wrapper.emitted("updateAiSetting")).toContainEqual([key, true]);
  });

  it("跨服务器开关说明每次命令仍需单独确认", () => {
    const wrapper = mountDialog("ai");

    expect(wrapper.text()).toContain("每次跨服务器命令仍需单独确认");
  });

  it("预提示词编辑期间只更新草稿，点击保存才提交去除首尾空白的内容", async () => {
    const wrapper = mountDialog("ai");
    const textarea = wrapper.get('textarea[aria-label="AI 预提示词"]');
    const findSaveButton = () => wrapper.get(".ai-preset-prompt-actions button");

    expect(findSaveButton().attributes("disabled")).toBeDefined();
    await textarea.setValue("  先给结论再解释  ");
    expect(wrapper.emitted("updateAiSetting")).toBeUndefined();

    await findSaveButton().trigger("click");
    expect(wrapper.emitted("updateAiSetting")).toEqual([["presetPrompt", "先给结论再解释"]]);
  });

  it("预提示词区域为单列内容高度布局，拖拽文本框时撑开后续设置项", () => {
    const declarations = getStyleDeclarations(".settings-page .ai-preset-prompt-field");

    expect(declarations["grid-template-columns"]).toMatch(/^minmax\(0,\s*1fr\)$/);
    expect(declarations.height).toBe("max-content");
  });

  it("「如何安装到 Agent」生成使用主程序 MCP 入口的提示词并可复制", async () => {
    const writeText = vi.fn(async () => undefined);
    window.orbitSSH = {
      getMcpInstallInfo: vi.fn(async () => ({
        name: "orbitssh",
        transport: "stdio",
        command: "/Applications/OrbitSSH.app/Contents/MacOS/OrbitSSH",
        args: ["--mcp-stdio"],
        skillDirectory: "/Applications/OrbitSSH.app/Contents/Resources/skills/orbitssh-mcp",
      })),
      clipboard: { writeText },
    } as unknown as Window["orbitSSH"];
    const wrapper = mountDialog("ai");

    await wrapper.get('[aria-label="如何安装到 Agent"]').trigger("click");
    await flushPromises();
    const prompt = (wrapper.get('textarea[aria-label="OrbitSSH Agent 安装提示词"]').element as HTMLTextAreaElement).value;

    expect(prompt).toContain('启动参数：["--mcp-stdio"]');
    expect(prompt).toContain("Skill 目录");
    expect(prompt).toContain("不得替我开启 OrbitSSH 设置中的 SSH/SFTP MCP 授权开关");

    const copyButton = wrapper.findAll("button").find(button => button.text() === "复制提示词")!;
    await copyButton.trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(prompt);
    expect(wrapper.text()).toContain("安装提示词已复制。");
  });
});

describe("SettingsDialog · 通用", () => {
  it("SFTP 同时传输数量提供 1 到 5 个任务并提交数字", async () => {
    const wrapper = mountDialog("general");
    // AppSelect 是泛型组件，按名称查找以便读取运行时 props。
    const select = wrapper
      .findAllComponents({ name: "AppSelect" })
      .find(component => component.props("ariaLabel") === "SFTP 同时传输数量")!;
    const options = select.props("options") as Array<{ value: string }>;

    expect(options.map(option => option.value)).toEqual(["1", "2", "3", "4", "5"]);
    expect(select.props("modelValue")).toBe("3");

    select.vm.$emit("update:modelValue", "5");
    expect(wrapper.emitted("updateSftpMaxConcurrentTransfers")).toEqual([[5]]);
  });
});
