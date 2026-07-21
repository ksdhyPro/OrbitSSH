import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const storeSourceUrl = new URL(
  '../../src/renderer/stores/useAiStore.ts',
  import.meta.url,
)
const appSourceUrl = new URL('../../src/renderer/App.vue', import.meta.url)
const panelSourceUrl = new URL(
  '../../src/renderer/components/AiPanel.vue',
  import.meta.url,
)

async function readSources() {
  const [store, app, panel] = await Promise.all([
    readFile(storeSourceUrl, 'utf8'),
    readFile(appSourceUrl, 'utf8'),
    readFile(panelSourceUrl, 'utf8'),
  ])
  return { store, app, panel }
}

test('AI conversation is created on first send and then persisted', async () => {
  const { store } = await readSources()

  assert.match(
    store,
    /function getActiveConversation[\s\S]*?createConversation\(\s*"新对话",\s*activeTabServerId\.value,\s*activeTabServerName\.value/,
  )
  assert.match(store, /const conversation = getActiveConversation\(context\.tabId\)/)
  assert.match(store, /activeConversationId\.value = conversation\.id/)
  assert.match(store, /AI_CONVERSATION_STORAGE_KEY/)
  assert.match(store, /localStorage\.setItem\(AI_CONVERSATION_STORAGE_KEY/)
  assert.match(store, /compaction\?: AiConversationCompaction/)
  assert.match(store, /compaction: normalizeStoredCompaction\(value\.compaction\)/)
  assert.match(store, /getUncompactedHistory\(conversation\)\.slice\(-HISTORY_LIMIT\)/)
  assert.match(store, /updateCompaction\(context\.tabId, result\.compaction\)/)
})

test('关闭终端 Tab 后会话记录保留，但清除 Tab 绑定', async () => {
  const { store } = await readSources()

  assert.match(store, /function removeTabSession\(tabId: string\)/)
  assert.match(store, /conversation\.tabId === tabId/)
  assert.match(store, /tabId: ""/)
  assert.match(store, /conversations\.value = conversations\.value\.map/)
})

test('历史会话展示关联服务器并要求服务器上下文匹配且已连接', async () => {
  const { store, app } = await readSources()

  assert.match(store, /serverName: conversation\.serverName/)
  assert.match(store, /conversation\.tabId === activeTabId\.value/)
  assert.match(store, /conversation\.serverId === activeTabServerId\.value/)
  assert.match(store, /activeTabStatus\.value !== "connected"/)
  assert.match(app, /tab\.serverId === conversation\.serverId/)
  assert.match(app, /tab\.status === "connected"/)
})

test('opening or switching terminal tabs keeps an empty draft without creating a conversation', async () => {
  const { store, app } = await readSources()
  const tabSessionSource =
    store.match(/function getTabSession[\s\S]*?function getActiveConversation/)?.[0] ?? ''
  const setActiveTabSource =
    store.match(/function setActiveTabId[\s\S]*?function getTabSession/)?.[0] ?? ''

  assert.doesNotMatch(store, /find\(item => item\.serverId === serverId\)/)
  assert.doesNotMatch(tabSessionSource, /createConversation\(/)
  assert.match(tabSessionSource, /activeConversationId: ""/)
  assert.match(setActiveTabSource, /activeConversationId\.value = ""/)
  assert.match(store, /const nextConversation = conversations\.value\.find\(conversation =>/)
  assert.match(app, /const associatedTab = conversation\.tabId/)
  assert.match(app, /tab\.id === conversation\.tabId/)
})

test('opening history and starting a new draft do not create extra empty conversations', async () => {
  const { store } = await readSources()
  const activateSource =
    store.match(/function activateConversation[\s\S]*?function renameConversation/)?.[0] ?? ''
  const startNewSource =
    store.match(/function startNewConversation[\s\S]*?function removeTabSession/)?.[0] ?? ''

  assert.doesNotMatch(activateSource, /createConversation\(/)
  assert.doesNotMatch(startNewSource, /createConversation\(/)
  assert.match(startNewSource, /activeConversationId: ""/)
  assert.match(startNewSource, /activeConversationId\.value = ""/)
})

test('empty draft can accept the first message or attachment on a connected tab', async () => {
  const { store } = await readSources()
  const readinessSource =
    store.match(/const conversationContextReady[\s\S]*?const messages/)?.[0] ?? ''

  assert.match(readinessSource, /if \(!conversation\) return true/)
  assert.match(readinessSource, /activeTabStatus\.value !== "connected"/)
  assert.match(store, /if \(\(!content && attachments\.length === 0\)/)
})

test('legacy empty conversations are filtered from history, hydration and persistence', async () => {
  const { store } = await readSources()

  assert.match(store, /function isConversationMeaningful\(/)
  assert.match(store, /conversationHistory[\s\S]*?\.filter\(isConversationMeaningful\)/)
  assert.match(store, /const records = conversations\.value\s*\.filter\(isConversationMeaningful\)/)
  assert.match(store, /return isConversationMeaningful\(conversation\) \? \[conversation\] : \[\]/)
})

test('切换到未连接服务器会询问并打开或重连终端', async () => {
  const { app } = await readSources()

  assert.match(app, /const shouldConnect = await requestConfirm\(/)
  assert.match(app, /const existingTab = tabs\.value\.find\(/)
  assert.match(app, /terminalsStore\.reconnectTerminal\(reconnectTab\.id\)/)
  assert.match(app, /await openTerminalFromStore\(server/)
})

test('历史审批命令重新绑定 Tab 时不会继续使用旧 Tab ID', async () => {
  const { store } = await readSources()

  assert.match(store, /function bindConversationToTab\(/)
  assert.match(store, /status: "cancelled"/)
  assert.match(store, /const tabId = activeTabId\.value/)
  assert.match(store, /runApprovedCommand\(\{\s*tabId,/)
})

test('会话支持重命名且改名不会改变历史排序时间', async () => {
  const { store, panel } = await readSources()
  const renameSource =
    store.match(/function renameConversation[\s\S]*?function deleteConversation/)?.[0] ?? ''

  assert.match(store, /function renameConversation\(conversationId: string, title: string\)/)
  assert.match(store, /MAX_CONVERSATION_TITLE_LENGTH = 80/)
  assert.match(renameSource, /schedulePersistConversations\(\)/)
  assert.doesNotMatch(renameSource, /updatedAt\s*:/)
  assert.match(panel, /renameConversation: \[conversationId: string, title: string\]/)
  assert.match(panel, /修改当前会话名称/)
  assert.match(panel, /@keydown\.enter\.prevent="commitConversationRename"/)
  assert.match(panel, /@keydown\.esc\.prevent="cancelConversationRename"/)
})

test('deleting the last conversation returns the tab to an empty draft', async () => {
  const { store, app, panel } = await readSources()
  const deleteSource =
    store.match(/function deleteConversation[\s\S]*?function schedulePersistConversations/)?.[0] ?? ''

  assert.match(store, /function deleteConversation\(conversationId: string\)/)
  assert.match(store, /session\.activeConversationId !== conversationId/)
  assert.match(store, /filter\(item => item\.tabId === tabId\)/)
  assert.doesNotMatch(deleteSource, /createConversation\(/)
  assert.match(deleteSource, /nextSessions\[tabId\] = \{ activeConversationId: "" \}/)
  assert.match(store, /TRANSIENT_COMMAND_STATUSES\.has\(card\.status\)/)
  assert.match(app, /title: "删除会话"/)
  assert.match(app, /删除后无法恢复/)
  assert.match(panel, /deleteConversation: \[conversationId: string\]/)
  assert.match(panel, /@click\.stop="emit\('deleteConversation', conversation\.id\)"/)
})

test('历史会话列表点击外部时关闭并在卸载时清理监听', async () => {
  const { panel } = await readSources()

  assert.match(panel, /function handleConversationHistoryOutsidePointerDown/)
  assert.match(panel, /conversationHistoryEl\.value\?\.contains\(event\.target\)/)
  assert.match(panel, /conversationHistoryTriggerEl\.value\?\.contains\(event\.target\)/)
  assert.match(panel, /isConversationHistoryOpen\.value = false/)
  assert.match(
    panel,
    /document\.addEventListener\([\s\S]*"pointerdown",[\s\S]*handleConversationHistoryOutsidePointerDown/,
  )
  assert.match(
    panel,
    /document\.removeEventListener\([\s\S]*"pointerdown",[\s\S]*handleConversationHistoryOutsidePointerDown/,
  )
})

test('AI sending state is isolated by terminal tab and stale requests cannot clear a newer request', async () => {
  const { store } = await readSources()

  assert.doesNotMatch(store, /const isSending = ref\(false\)/)
  assert.match(store, /const sendingTabIds = ref<Set<string>>\(new Set\(\)\)/)
  assert.match(
    store,
    /const isSending = computed\(\(\) => isTabSending\(activeTabId\.value\)\)/,
  )
  assert.match(
    store,
    /if \(requestTokensByTabId\.get\(tabId\) !== requestToken\) return/,
  )
  assert.match(
    store,
    /if \(!tabId \|\| isTabSending\(tabId\) \|\| hasBlockingCommandProcess\(tabId\)\)/,
  )
  assert.match(store, /finishTabRequest\(context\.tabId, requestToken\)/)
  assert.match(
    store,
    /if \(!context\.tabId \|\| !isTabSending\(context\.tabId\)\) return/,
  )
  assert.match(store, /cancelTabRequest\(context\.tabId\)/)
})
