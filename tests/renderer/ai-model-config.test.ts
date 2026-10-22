import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AiModelConfigDialog from "../../src/renderer/components/settings/AiModelConfigDialog.vue";
import {
  createEmptyAiModelConfigForm,
  maskApiKey,
  toAiModelConfig,
  validateAiModelConfigForm,
} from "../../src/renderer/utils/ai-model-config-form";
import { buildMcpInstallPrompt } from "../../src/renderer/utils/mcp-install-prompt";
import { defaultAppSettings, type AiModelConfig, type AiSettings } from "../../src/shared/settings";

const validForm = {
  model: " deepseek-chat ",
  baseUrl: "https://api.example.com/v1//",
  apiKey: " sk-12345678 ",
  contextTokenLimitK: 128,
};

describe("模型配置表单", () => {
  it("逐项校验模型名、Base URL、API Key 和上下文限制", () => {
    expect(validateAiModelConfigForm(createEmptyAiModelConfigForm())).toContain("模型名");
    expect(validateAiModelConfigForm({ ...validForm, model: "deep seek" })).toContain("模型名");
    expect(validateAiModelConfigForm({ ...validForm, baseUrl: "ftp://example.com" })).toContain(
      "Base URL",
    );
    expect(validateAiModelConfigForm({ ...validForm, apiKey: "short" })).toContain("API Key");
    expect(validateAiModelConfigForm({ ...validForm, contextTokenLimitK: 1.5 })).toContain(
      "上下文",
    );
    expect(validateAiModelConfigForm(validForm)).toBe("");
  });

  it("保存时去除首尾空白和 Base URL 尾部斜杠", () => {
    expect(toAiModelConfig(validForm, "ai-1")).toEqual({
      id: "ai-1",
      name: "deepseek-chat",
      provider: "other",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-12345678",
      model: "deepseek-chat",
      contextTokenLimitK: 128,
    });
  });

  it("API Key 只显示首尾各 3 位", () => {
    expect(maskApiKey("")).toBe("-");
    expect(maskApiKey("12345678")).toBe("********");
    expect(maskApiKey("sk-abcdefghijk")).toBe("sk-********ijk");
  });
});

describe("MCP 安装提示词", () => {
  it("包含启动命令、参数和 Skill 目录，并禁止替用户开启授权", () => {
    const prompt = buildMcpInstallPrompt({
      name: "orbitssh",
      transport: "stdio",
      command: "/Applications/OrbitSSH.app/Contents/MacOS/OrbitSSH",
      args: ["--mcp-stdio"],
      skillDirectory: "/skills/orbitssh-mcp",
    });

    expect(prompt).toContain('启动命令："/Applications/OrbitSSH.app/Contents/MacOS/OrbitSSH"');
    expect(prompt).toContain('启动参数：["--mcp-stdio"]');
    expect(prompt).toContain('Skill 目录："/skills/orbitssh-mcp"');
    expect(prompt).toContain("不得替我开启 OrbitSSH 设置中的 SSH/SFTP MCP 授权开关");
  });
});

describe("模型配置弹窗", () => {
  const existing: AiModelConfig = {
    id: "ai-a",
    name: "model-a",
    provider: "other",
    baseUrl: "https://a.example.com",
    apiKey: "sk-aaaaaaaa",
    model: "model-a",
    contextTokenLimitK: 64,
  };

  function mountDialog(ai: Partial<AiSettings> = {}) {
    const aiSettings = { ...structuredClone(defaultAppSettings.ai), ...ai };
    return mount(AiModelConfigDialog, {
      props: { open: true, aiSettings },
      global: { stubs: { teleport: true } },
    });
  }

  const findButton = (wrapper: ReturnType<typeof mountDialog>, text: string) =>
    wrapper.findAll("button").find(button => button.text() === text)!;

  it("首次新增的模型自动成为当前模型", async () => {
    const wrapper = mountDialog();
    expect(wrapper.text()).toContain("暂无模型配置");

    await findButton(wrapper, "新增模型").trigger("click");
    const inputs = wrapper.findAll(".ai-config-form input");
    await inputs[0].setValue(validForm.model);
    await inputs[1].setValue(validForm.baseUrl);
    await inputs[2].setValue(validForm.apiKey);
    await inputs[3].setValue(String(validForm.contextTokenLimitK));
    await wrapper.get(".ai-config-form").trigger("submit");

    const [[saved]] = wrapper.emitted("updateAiSettings") as [[AiSettings]];
    expect(saved.configs).toHaveLength(1);
    expect(saved.configs[0]).toMatchObject({
      model: "deepseek-chat",
      baseUrl: "https://api.example.com/v1",
    });
    expect(saved.activeConfigId).toBe(saved.configs[0].id);
    expect(wrapper.find(".ai-config-form").exists()).toBe(false);
    expect(wrapper.text()).toContain("模型配置已保存。");
  });

  it("表单未填写完整时保存按钮禁用", async () => {
    const wrapper = mountDialog();
    await findButton(wrapper, "新增模型").trigger("click");

    expect(findButton(wrapper, "保存").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".ai-config-form-tip").classes()).toContain("is-error");
  });

  it("删除当前模型时改用剩余的第一个模型", async () => {
    const other = { ...existing, id: "ai-b", model: "model-b", name: "model-b" };
    const wrapper = mountDialog({ configs: [existing, other], activeConfigId: "ai-a" });

    await wrapper.findAll("tbody tr")[0].findAll("button").at(-1)!.trigger("click");

    const [[saved]] = wrapper.emitted("updateAiSettings") as [[AiSettings]];
    expect(saved.configs.map(config => config.id)).toEqual(["ai-b"]);
    expect(saved.activeConfigId).toBe("ai-b");
  });

  it("编辑已有模型只替换该条配置并保留 id", async () => {
    const wrapper = mountDialog({ configs: [existing], activeConfigId: "ai-a" });

    await findButton(wrapper, "编辑").trigger("click");
    await wrapper.findAll(".ai-config-form input")[3].setValue("256");
    await wrapper.get(".ai-config-form").trigger("submit");

    const [[saved]] = wrapper.emitted("updateAiSettings") as [[AiSettings]];
    expect(saved.configs).toEqual([{ ...existing, contextTokenLimitK: 256 }]);
  });
});
