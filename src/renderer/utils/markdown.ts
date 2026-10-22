import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

// AI 回复不需要加载远程图片，避免在 SSH 工具里产生额外外链请求。
markdown.disable("image");

const wrapCodeBlock = (html: string): string => `
<div class="ai-code-block">
  <button
    type="button"
    class="ai-code-copy-btn"
    data-ai-code-copy
    title="复制代码"
    aria-label="复制代码"
  ></button>
  ${html}
</div>`;

// 为围栏代码和缩进代码统一添加复制入口，具体复制行为由 AI 面板事件委托处理。
const defaultFenceRenderer = markdown.renderer.rules.fence;
if (defaultFenceRenderer) {
  markdown.renderer.rules.fence = (tokens, idx, options, env, self) =>
    wrapCodeBlock(defaultFenceRenderer(tokens, idx, options, env, self));
}

const defaultCodeBlockRenderer = markdown.renderer.rules.code_block;
if (defaultCodeBlockRenderer) {
  markdown.renderer.rules.code_block = (tokens, idx, options, env, self) =>
    wrapCodeBlock(defaultCodeBlockRenderer(tokens, idx, options, env, self));
}

const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options));

markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];

  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");

  return defaultLinkOpen(tokens, idx, options, env, self);
};

// 流式输出时每个片段都会触发整个面板重新渲染，按内容缓存结果，
// 只有正在变化的那条消息需要重新解析和净化。
const RENDER_CACHE_LIMIT = 300;
const renderCache = new Map<string, string>();

function renderMarkdownUncached(content: string): string {
  const html = markdown.render(content);

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["img", "iframe", "script", "style"],
  });
}

/** 将 AI Markdown 回复转换为可安全渲染的 HTML，相同内容直接复用缓存结果。 */
export function renderMarkdown(content: string): string {
  const cached = renderCache.get(content);
  if (cached !== undefined) {
    // 重新插入以维护最近使用顺序。
    renderCache.delete(content);
    renderCache.set(content, cached);
    return cached;
  }

  const html = renderMarkdownUncached(content);
  renderCache.set(content, html);
  if (renderCache.size > RENDER_CACHE_LIMIT) {
    renderCache.delete(renderCache.keys().next().value!);
  }
  return html;
}
