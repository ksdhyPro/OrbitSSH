import DOMPurify from "dompurify";
import { describe, expect, it, vi } from "vitest";

import { renderMarkdown } from "../../src/renderer/utils/markdown";

describe("renderMarkdown", () => {
  it("相同内容只解析和净化一次，流式重渲染时其他消息直接复用缓存", () => {
    const sanitize = vi.spyOn(DOMPurify, "sanitize");
    const content = `缓存测试 ${Math.random()}\n\n- 第一项\n- 第二项`;

    const first = renderMarkdown(content);
    for (let index = 0; index < 20; index += 1) renderMarkdown(content);

    expect(sanitize).toHaveBeenCalledTimes(1);
    expect(renderMarkdown(content)).toBe(first);
    expect(first).toContain("<li>第一项</li>");
  });

  it("仍然净化危险内容并禁用图片", () => {
    const html = renderMarkdown(
      `<script>alert(1)</script> ![x](https://example.com/a.png) [链接](https://example.com) ${Math.random()}`,
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
