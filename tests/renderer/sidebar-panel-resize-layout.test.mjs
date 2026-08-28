import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSourceUrl = new URL('../../src/renderer/App.vue', import.meta.url)
const baseStyleUrl = new URL('../../src/renderer/styles/base.css', import.meta.url)
const serverSidebarUrl = new URL('../../src/renderer/components/ServerSidebar.vue', import.meta.url)
const automationSidebarUrl = new URL('../../src/renderer/components/AutomationSidebar.vue', import.meta.url)
const sftpPanelUrl = new URL('../../src/renderer/components/SftpPanel.vue', import.meta.url)

test('左侧面板可拖拽排序，排在最下面的面板自动填满剩余空间', async () => {
  const appSource = await readFile(appSourceUrl, 'utf8')

  assert.match(
    appSource,
    /type SidebarPanel = "servers" \| "automation" \| "remoteFiles"/,
  )
  assert.match(appSource, /appSettings\.sidebar\.panelOrder/)
  assert.match(appSource, /@dragstart="startSidebarPanelDrag\(\$event, panel\)"/)
  assert.match(appSource, /@drop="finishSidebarPanelDrag\(\$event, panel\)"/)
  assert.match(
    appSource,
    /v-if="!isLastSidebarPanel\(panel\)"/,
  )
  assert.match(appSource, /@mousedown="!appSettings\.sidebar\[panel\]\.collapsed/)
  assert.match(
    appSource,
    /isLastSidebarPanel\(panel\)/,
  )
  assert.match(
    appSource,
    /isLastSidebarPanel\(panel\)\s*\?\s*undefined/,
  )
})

test('左侧面板分隔条沿用侧边栏的细线与居中强调手柄样式', async () => {
  const baseStyle = await readFile(baseStyleUrl, 'utf8')
  const panelResizerRule = baseStyle.match(
    /\.sidebar-panel-resizer\s*\{[\s\S]*?\n\}/,
  )?.[0]
  const panelResizerBeforeRule = baseStyle.match(
    /\.sidebar-panel-resizer::before\s*\{[\s\S]*?\n\}/,
  )?.[0]
  const panelResizerAfterRule = baseStyle.match(
    /\.sidebar-panel-resizer::after\s*\{[\s\S]*?\n\}/,
  )?.[0]

  assert.match(panelResizerRule ?? '', /background:\s*var\(--bg-elevated-1\)/)
  assert.match(panelResizerBeforeRule ?? '', /height:\s*1px/)
  assert.match(panelResizerBeforeRule ?? '', /background:\s*var\(--border-window\)/)
  assert.match(panelResizerAfterRule ?? '', /width:\s*48px/)
  assert.match(panelResizerAfterRule ?? '', /height:\s*3px/)
})

test('自定义指令列表按内容从顶部紧凑排列，不拉伸单个指令卡片', async () => {
  const baseStyle = await readFile(baseStyleUrl, 'utf8')
  const automationListRule = baseStyle.match(
    /\.automation-sidebar-list\s*\{[\s\S]*?\n\}/,
  )?.[0]

  assert.match(automationListRule ?? '', /align-content:\s*start/)
})

test('面板标题区域可直接发起拖拽排序', async () => {
  const [serverSidebar, automationSidebar, sftpPanel, baseStyle] = await Promise.all([
    readFile(serverSidebarUrl, 'utf8'),
    readFile(automationSidebarUrl, 'utf8'),
    readFile(sftpPanelUrl, 'utf8'),
    readFile(baseStyleUrl, 'utf8'),
  ])

  assert.match(serverSidebar, /class="panel-header"\s+draggable="true"/)
  assert.match(automationSidebar, /class="panel-header"\s+draggable="true"/)
  assert.match(sftpPanel, /class="panel-header"\s+draggable="true"/)
  assert.match(baseStyle, /\.panel-header\[draggable="true"\][\s\S]*-webkit-user-drag:\s*element/)
})

test('展开左侧面板时自动使用当前布局下的最大可用高度', async () => {
  const appSource = await readFile(appSourceUrl, 'utf8')

  assert.match(appSource, /function toggleSidebarPanel\([\s\S]*?const isOpening = appSettings\.sidebar\[panel\]\.collapsed/)
  assert.match(appSource, /if \(candidate !== panel && !appSettings\.sidebar\[candidate\]\.collapsed\)[\s\S]*?\.height = SIDEBAR_PANEL_MIN_HEIGHT/)
  assert.match(appSource, /if \(isOpening\) \{[\s\S]*?\.height = getSidebarPanelMaxHeight\(panel\)/)
  assert.match(appSource, /sidebarPanelOrder\.value\.slice\(0, -1\)[\s\S]*?\.length\s*\* SIDEBAR_PANEL_RESIZER_HEIGHT/)
})

test('侧栏容器高度变化时重新计算面板显示高度，避免固定高度溢出', async () => {
  const appSource = await readFile(appSourceUrl, 'utf8')

  assert.match(appSource, /const sidebarPanelsHeight = ref\(0\)/)
  assert.match(appSource, /function refreshSidebarPanelsHeight\(\): void/)
  assert.match(appSource, /new ResizeObserver\(refreshSidebarPanelsHeight\)/)
  assert.match(appSource, /sidebarPanelsHeight\.value/)
})

test('折叠面板标题紧凑且侧栏底部保留视觉间距', async () => {
  const [appSource, baseStyle] = await Promise.all([
    readFile(appSourceUrl, 'utf8'),
    readFile(baseStyleUrl, 'utf8'),
  ])

  assert.match(appSource, /SIDEBAR_PANEL_COLLAPSED_HEADER_HEIGHT = 28/)
  assert.match(baseStyle, /\.sidebar\s*\{[\s\S]*?padding:\s*8px 10px 20px/)
  assert.match(baseStyle, /\.sidebar-panel-slot\.collapsed \.panel-header\s*\{[\s\S]*?height:\s*28px/)
})

test('拖动面板分隔线时在相邻展开面板之间转移高度', async () => {
  const appSource = await readFile(appSourceUrl, 'utf8')

  assert.match(appSource, /let resizingAdjacentSidebarPanel: SidebarPanel \| null = null/)
  assert.match(appSource, /function getNextSidebarPanel\(panel: SidebarPanel\): SidebarPanel \| null/)
  assert.match(appSource, /const adjacentPanel = getNextSidebarPanel\(panel\)/)
  assert.match(appSource, /appSettings\.sidebar\[adjacentPanel\]\.height = [\s\S]*?- appliedDelta/)
})
