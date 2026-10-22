import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const groupedListUrl = new URL('../../src/renderer/components/GroupedList.vue', import.meta.url)
const serverSidebarUrl = new URL('../../src/renderer/components/ServerSidebar.vue', import.meta.url)
const automationSidebarUrl = new URL('../../src/renderer/components/AutomationSidebar.vue', import.meta.url)

test('连接拖拽不会冒泡到外层面板排序并被取消', async () => {
  const [groupedList, serverSidebar, automationSidebar] = await Promise.all(
    [groupedListUrl, serverSidebarUrl, automationSidebarUrl].map(url => readFile(url, 'utf8')),
  )
  const dragBindings = groupedList.match(/@dragstart(?:\.[a-z]+)*="startDrag\(\$event, item\)"/g) ?? []

  // 分组内和未分组条目共用同一渲染分支，必须阻止冒泡，避免外层面板排序处理器取消拖拽。
  assert.equal(dragBindings.length, 1)
  assert.ok(dragBindings.every(binding => binding.includes('.stop')))
  assert.match(serverSidebar, /<GroupedList\b/)
  assert.match(automationSidebar, /<GroupedList\b/)
})
