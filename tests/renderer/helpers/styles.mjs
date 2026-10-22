import { readFile } from 'node:fs/promises'

const rendererUrl = new URL('../../../src/renderer/', import.meta.url)

/**
 * 按 styles.css 的 @import 顺序读取并拼接全部渲染层样式。
 * 样式按组件 / 功能拆分到多个文件后，测试只关心规则是否存在，不依赖具体文件位置。
 */
export async function readRendererStyles() {
  const entry = await readFile(new URL('styles.css', rendererUrl), 'utf8')
  const paths = [...entry.matchAll(/@import\s+"\.\/([^"]+)"/g)].map(match => match[1])
  const sources = await Promise.all(paths.map(path => readFile(new URL(path, rendererUrl), 'utf8')))
  return sources.join('\n')
}
