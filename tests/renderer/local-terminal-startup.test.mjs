import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sharedSettingsUrl = new URL(
  '../../src/shared/settings.ts',
  import.meta.url,
)
const settingsStoreUrl = new URL(
  '../../src/main/storage/settings-store.ts',
  import.meta.url,
)
const rendererSettingsStoreUrl = new URL(
  '../../src/renderer/stores/useSettingsStore.ts',
  import.meta.url,
)
const settingsDialogUrl = new URL(
  '../../src/renderer/components/SettingsDialog.vue',
  import.meta.url,
)
const appUrl = new URL('../../src/renderer/App.vue', import.meta.url)

test('local terminal startup defaults to enabled and old settings inherit it', async () => {
  const [sharedSource, mainStoreSource] = await Promise.all([
    readFile(sharedSettingsUrl, 'utf8'),
    readFile(settingsStoreUrl, 'utf8'),
  ])

  assert.match(sharedSource, /openLocalTerminalOnStartup: boolean/)
  assert.match(sharedSource, /openLocalTerminalOnStartup: true/)
  assert.match(
    mainStoreSource,
    /openLocalTerminalOnStartup:\s*terminalSettings\.openLocalTerminalOnStartup !== false/,
  )
})

test('local terminal startup preference is editable and persisted', async () => {
  const [rendererStoreSource, dialogSource] = await Promise.all([
    readFile(rendererSettingsStoreUrl, 'utf8'),
    readFile(settingsDialogUrl, 'utf8'),
  ])

  assert.match(
    rendererStoreSource,
    /openLocalTerminalOnStartup:\s*appSettings\.terminal\.openLocalTerminalOnStartup/,
  )
  assert.match(rendererStoreSource, /updateOpenLocalTerminalOnStartup/)
  assert.match(dialogSource, /启动时打开本地终端/)
  assert.match(
    dialogSource,
    /:checked="appSettings\.terminal\.openLocalTerminalOnStartup"/,
  )
  assert.match(dialogSource, /updateOpenLocalTerminalOnStartup/)
})

test('application loads settings before deciding whether to open a local terminal', async () => {
  const source = await readFile(appUrl, 'utf8')
  const initializer = source.match(
    /async function initializeSettingsAndLocalTerminal\(\): Promise<void> \{[\s\S]*?\n\}/,
  )?.[0]

  assert.ok(initializer)
  assert.match(initializer, /await settingsStore\.loadAppSettings\(\)/)
  assert.match(initializer, /!appSettings\.terminal\.openLocalTerminalOnStartup/)
  assert.match(initializer, /!orbitSSHApi\.value/)
  assert.match(initializer, /await openLocalTerminal\(\)/)
  assert.ok(
    initializer.indexOf('await settingsStore.loadAppSettings()') <
      initializer.indexOf('await openLocalTerminal()'),
  )
  assert.match(source, /void initializeSettingsAndLocalTerminal\(\)/)
})
