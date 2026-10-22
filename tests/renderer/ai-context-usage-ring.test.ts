import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AiContextUsageRing from "../../src/renderer/components/AiContextUsageRing.vue";
import type { AiContextUsage } from "../../src/shared/ai";
import type { AiModelConfig } from "../../src/shared/settings";
import { someStyleValue } from "./helpers/styles";

function createConfig(contextTokenLimitK: number): AiModelConfig {
  return {
    id: "config-1",
    name: "DeepSeek",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "test-key",
    model: "deepseek-chat",
    contextTokenLimitK,
  } as AiModelConfig;
}

function createUsage(overrides: Partial<AiContextUsage> = {}): AiContextUsage {
  return {
    configId: "config-1",
    usedTokens: 32_000,
    maxTokens: 64_000,
    percent: 50,
    source: "provider",
    ...overrides,
  };
}

describe("AiContextUsageRing", () => {
  it("模型未配置上下文上限时不显示", () => {
    const wrapper = mount(AiContextUsageRing, {
      props: { config: createConfig(0), usage: createUsage() },
    });

    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
  });

  it("配置上限后按当前模型的用量显示进度和来源", () => {
    const wrapper = mount(AiContextUsageRing, {
      props: { config: createConfig(64), usage: createUsage({ percent: 42.4 }) },
    });
    const ring = wrapper.get('[role="progressbar"]');

    expect(ring.attributes("aria-valuenow")).toBe("42");
    expect(ring.attributes("title")).toBe("上下文已使用 42%（接口统计）");
    expect(ring.attributes("style")).toContain("--ai-context-progress");
    expect(ring.text()).toBe("42%");
  });

  it("用量来自其他模型配置时归零，超出范围时截断到 100%", async () => {
    const wrapper = mount(AiContextUsageRing, {
      props: { config: createConfig(64), usage: createUsage({ configId: "other" }) },
    });
    expect(wrapper.get('[role="progressbar"]').text()).toBe("0%");

    await wrapper.setProps({ usage: createUsage({ percent: 180, source: "estimated" }) });
    const ring = wrapper.get('[role="progressbar"]');
    expect(ring.text()).toBe("100%");
    expect(ring.attributes("title")).toBe("上下文已使用 100%（本地估算）");
  });

  it("圆环样式使用 conic-gradient 绘制进度", () => {
    expect(someStyleValue(value => value.includes("conic-gradient("))).toBe(true);
  });
});
