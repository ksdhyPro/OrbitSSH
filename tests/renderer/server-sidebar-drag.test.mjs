import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const serverSidebarUrl = new URL('../../src/renderer/components/ServerSidebar.vue', import.meta.url)

test('连接拖拽不会冒泡到外层面板排序并被取消', async () => {
  const serverSidebar = await readFile(serverSidebarUrl, 'utf8')
  const serverDragBindings = serverSidebar.match(/@dragstart(?:\.[a-z]+)*="startServerDrag\(\$event, server\)"/g) ?? []

  // 分组内和未分组连接都必须阻止冒泡，避免外层面板排序处理器取消拖拽。
  assert.equal(serverDragBindings.length, 2)
  assert.ok(serverDragBindings.every(binding => binding.includes('.stop')))
})
