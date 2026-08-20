import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const componentUrl = new URL(
  '../../src/renderer/components/StatusBar.vue',
  import.meta.url,
)
const styleUrl = new URL(
  '../../src/renderer/styles/forms-and-status.css',
  import.meta.url,
)

test('状态栏保留 CPU、内存和磁盘的迷你折线实现', async () => {
  const source = await readFile(componentUrl, 'utf8')
  const sparklineElements = source.match(/'status-sparkline'/g)

  assert.match(source, /const MAX_SPARKLINE_POINTS = 24/)
  assert.match(source, /const MIN_SPARKLINE_RANGE = 12/)
  assert.match(source, /appendHistory\(tabId, "cpu", result\.cpuUsage\)/)
  assert.match(source, /appendHistory\(tabId, "memory", result\.memoryUsage\)/)
  assert.match(source, /sparklinePoints\(currentHistory\?\.disk\)/)
  assert.equal(sparklineElements?.length, 3)
})

test('迷你折线模板暂时注释且不在状态栏显示', async () => {
  const source = await readFile(componentUrl, 'utf8')
  const hiddenMarkers = source.match(
    /暂时隐藏迷你折线，保留实现便于后续直接恢复。/g,
  )

  assert.equal(hiddenMarkers?.length, 3)
})

test('迷你折线按近期数据范围缩放并让稳定数据保持居中', async () => {
  const source = await readFile(componentUrl, 'utf8')

  assert.match(source, /Math\.min\(\.\.\.values\)/)
  assert.match(source, /Math\.max\(\.\.\.values\)/)
  assert.match(
    source,
    /Math\.max\(maximum - minimum, MIN_SPARKLINE_RANGE\)/,
  )
  assert.match(source, /const midpoint = \(minimum \+ maximum\) \/ 2/)
})

test('迷你折线保持紧凑且不会增加状态栏高度', async () => {
  const style = await readFile(styleUrl, 'utf8')
  const sparklineRule = style.match(
    /\.status-sparkline\s*\{[\s\S]*?\n\}/,
  )?.[0]

  assert.match(sparklineRule ?? '', /width:\s*38px/)
  assert.match(sparklineRule ?? '', /height:\s*12px/)
  assert.match(style, /\.status-sparkline polyline/)
})
