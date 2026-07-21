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

const renderedMarkdownCache = new Map<string, string>();
const renderedMarkdownCacheLimit = 256;
const renderedMarkdownCacheContentLimit = 32_000;

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

/** 将 AI Markdown 回复转换为可安全渲染的 HTML。 */
export function renderMarkdown(content: string): string {
  const cached = renderedMarkdownCache.get(content);
  if (cached !== undefined) {
    return cached;
  }

  const html = markdown.render(content);
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["img", "iframe", "script", "style"],
  });

  if (content.length <= renderedMarkdownCacheContentLimit) {
    renderedMarkdownCache.set(content, sanitized);
    if (renderedMarkdownCache.size > renderedMarkdownCacheLimit) {
      const oldestKey = renderedMarkdownCache.keys().next().value;
      if (oldestKey !== undefined) {
        renderedMarkdownCache.delete(oldestKey);
      }
    }
  }

  return sanitized;
}
