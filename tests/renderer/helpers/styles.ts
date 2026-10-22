import { readFileSync } from "node:fs";
import path from "node:path";

import postcss, { type Root, type Rule } from "postcss";

// jsdom 环境下 import.meta.url 不是 file 协议，统一从 Vitest 根目录（仓库根）解析。
const rendererDirectory = path.resolve(process.cwd(), "src/renderer");

let cachedRoot: Root | undefined;

/** 按 styles.css 的 @import 顺序解析全部渲染层样式，测试不依赖规则所在的具体文件。 */
function getStylesRoot(): Root {
  if (cachedRoot) return cachedRoot;
  const entry = readFileSync(path.join(rendererDirectory, "styles.css"), "utf8");
  const paths = [...entry.matchAll(/@import\s+"\.\/([^"]+)"/g)].map(match => match[1]!);
  cachedRoot = postcss.root();
  for (const file of paths) {
    const source = readFileSync(path.join(rendererDirectory, file), "utf8");
    cachedRoot.append(postcss.parse(source, { from: file }).nodes);
  }
  return cachedRoot;
}

function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, " ").trim();
}

/** 返回选择器列表中包含该选择器的全部规则（不含媒体查询等嵌套规则以外的差异）。 */
export function findStyleRules(selector: string): Rule[] {
  const target = normalizeSelector(selector);
  const rules: Rule[] = [];
  getStylesRoot().walkRules(rule => {
    if (rule.selectors.some(item => normalizeSelector(item) === target)) {
      rules.push(rule);
    }
  });
  return rules;
}

/** 按层叠顺序合并选择器的声明，后出现的同名属性覆盖先出现的。 */
export function getStyleDeclarations(selector: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const rule of findStyleRules(selector)) {
    // 只合并顶层规则，避免媒体查询或主题覆盖干扰默认值断言。
    if (rule.parent?.type !== "root") continue;
    rule.walkDecls(declaration => {
      declarations[declaration.prop] = declaration.value;
    });
  }
  return declarations;
}

export function hasStyleRule(selector: string): boolean {
  return findStyleRules(selector).length > 0;
}

/** 判断任意规则的任意声明值是否满足条件，用于检查渐变等不绑定具体选择器的能力。 */
export function someStyleValue(predicate: (value: string) => boolean): boolean {
  let matched = false;
  getStylesRoot().walkDecls(declaration => {
    if (predicate(declaration.value)) matched = true;
  });
  return matched;
}
