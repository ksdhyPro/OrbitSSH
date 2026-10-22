import { describe, expect, it } from "vitest";

import { getStyleDeclarations, hasStyleRule } from "./helpers/styles";

// jsdom 不计算布局，这里用 PostCSS 解析样式表，校验关键布局约束的最终声明值。
describe("AI 面板布局", () => {
  it("AI 模式下对话区作为主视图，不再占用内容区右侧列", () => {
    const contentShell = getStyleDeclarations(".content-shell");
    expect(Object.entries(contentShell).join(";")).not.toContain("--ai-panel-track-width");

    const panel = getStyleDeclarations(".ai-panel");
    expect(panel.width).toBe("100%");
    expect(panel["min-width"]).toBe("0");
  });

  it("头部和模型选择允许随面板收缩", () => {
    expect(getStyleDeclarations(".ai-panel-heading")["min-width"]).toBe("0");
    const modelTrigger = getStyleDeclarations(".ai-model-trigger");
    expect(modelTrigger["min-width"]).toBe("0");
    expect(modelTrigger.flex).toBe("0 1 160px");
  });

  it("待批准的长命令限制高度并可纵向滚动", () => {
    const code = getStyleDeclarations(".ai-approval-popover code");
    expect(code["max-height"]).toMatch(/^min\(/);
    expect(code["overflow-y"]).toBe("auto");
  });

  it("头部与终端标签栏等高，当前连接以胶囊 Tag 展示并截断", () => {
    expect(getStyleDeclarations(".ai-panel-header").height).toBe("44px");
    const tag = getStyleDeclarations(".ai-context-tag");
    expect(tag["border-radius"]).toBe("var(--radius-full)");
    expect(tag["text-overflow"]).toBe("ellipsis");
  });
});

describe("左侧面板", () => {
  it("分隔条使用细线与居中强调手柄", () => {
    expect(getStyleDeclarations(".sidebar-panel-resizer").background).toBe("var(--bg-elevated-1)");
    const line = getStyleDeclarations(".sidebar-panel-resizer::before");
    expect(line.height).toBe("1px");
    expect(line.background).toBe("var(--border-default)");
    const handle = getStyleDeclarations(".sidebar-panel-resizer::after");
    expect(handle.width).toBe("48px");
    expect(handle.height).toBe("3px");
  });

  it("分组列表从顶部紧凑排列，不拉伸单个条目", () => {
    expect(getStyleDeclarations(".grouped-list")["align-content"]).toBe("start");
  });

  it("面板标题可直接拖拽排序", () => {
    expect(getStyleDeclarations('.panel-header[draggable="true"]')["-webkit-user-drag"]).toBe(
      "element",
    );
  });

  it("折叠面板标题紧凑，侧栏底部保留视觉间距", () => {
    expect(getStyleDeclarations(".sidebar").padding).toBe("8px 4px");
    expect(getStyleDeclarations(".sidebar-panel-slot.collapsed .panel-header").height).toBe("28px");
  });
});

describe("状态栏", () => {
  it("迷你折线保持紧凑，不增加状态栏高度", () => {
    const sparkline = getStyleDeclarations(".status-sparkline");
    expect(sparkline.width).toBe("38px");
    expect(sparkline.height).toBe("12px");
    expect(hasStyleRule(".status-sparkline polyline")).toBe(true);
  });
});
