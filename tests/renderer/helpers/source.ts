import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 读取源码文本，仅用于逻辑仍内嵌在超大组件中、暂时无法独立挂载的契约检查。
 * 拆分组件后应改为行为测试。路径相对仓库根目录（Vitest 根目录）。
 */
export function readSource(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}
