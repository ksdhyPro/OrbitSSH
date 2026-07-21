import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const settingsDialogUrl = new URL(
  '../../src/renderer/components/SettingsDialog.vue',
  import.meta.url,
)
const panelUrl = new URL(
  '../../src/renderer/components/AiPanel.vue',
  import.meta.url,
)
const settingsStoreUrl = new URL(
  '../../src/renderer/stores/useSettingsStore.ts',
  import.meta.url,
)
const appUrl = new URL('../../src/renderer/App.vue', import.meta.url)
const redesignStylesUrl = new URL(
  '../../src/renderer/styles/redesign.css',
  import.meta.url,
)
const aiStylesUrl = new URL(
  '../../src/renderer/styles/ai.css',
  import.meta.url,
)
const themeUtilsUrl = new URL(
  '../../src/renderer/utils/theme.ts',
  import.meta.url,
)
const formsStylesUrl = new URL(
  '../../src/renderer/styles/forms-and-status.css',
  import.meta.url,
)
const settingsMainUrl = new URL(
  '../../src/main/storage/settings-store.ts',
  import.meta.url,
)
const sharedSettingsUrl = new URL(
  '../../src/shared/settings.ts',
  import.meta.url,
)
const sidebarStoreUrl = new URL(
  '../../src/renderer/stores/useSidebarStore.ts',
  import.meta.url,
)

test('AI defaults to enabled while preserving an explicit disabled preference', async () => {
  const [sharedSource, mainStoreSource] = await Promise.all([
    readFile(sharedSettingsUrl, 'utf8'),
    readFile(settingsMainUrl, 'utf8'),
  ])

  assert.match(sharedSource, /ai:\s*\{[\s\S]*?enabled: true/)
  assert.match(mainStoreSource, /enabled:\s*value\?\.enabled !== false/)
})

test('narrow AI panels keep their right edge and message content inside the viewport', async () => {
  const [appSource, sidebarSource, redesignSource] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(sidebarStoreUrl, 'utf8'),
    readFile(redesignStylesUrl, 'utf8'),
  ])

  assert.match(sidebarSource, /const MIN_AI_PANEL_WIDTH = 320/)
  assert.match(sidebarSource, /Math\.max\(\s*MIN_AI_PANEL_WIDTH,/)
  assert.match(
    appSource,
    /function handleWindowResize\(\): void \{\s*aiPanelWidth\.value = clampAiPanelWidth\(aiPanelWidth\.value\)/,
  )
  assert.match(
    redesignSource,
    /\.ai-message-list\s*\{[\s\S]*?scrollbar-gutter: stable/,
  )
  assert.match(
    redesignSource,
    /\.ai-message\.user\s*\{[\s\S]*?align-self: flex-end;[\s\S]*?max-width: calc\(100% - 8px\)/,
  )
})

test('workspace keeps servers and session files stacked without a navigation rail', async () => {
  const [appSource, styleSource] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(redesignStylesUrl, 'utf8'),
  ])

  assert.doesNotMatch(appSource, /WorkspaceRail|sidebarSection/)
  assert.match(appSource, /<ServerSidebar/)
  assert.match(appSource, /<SftpPanel/)
  assert.match(styleSource, /\.sidebar > \.server-panel/)
  assert.match(styleSource, /\.sidebar > \.file-panel/)
  assert.doesNotMatch(styleSource, /\.workspace-rail/)
})

test('terminal chrome and AI code surfaces follow light and dark theme tokens', async () => {
  const [source, themeSource] = await Promise.all([
    readFile(redesignStylesUrl, 'utf8'),
    readFile(themeUtilsUrl, 'utf8'),
  ])

  assert.match(source, /:root\[data-theme="light"\][\s\S]*--bg-deep: #f7f9fc/)
  assert.match(source, /--code-surface: #14181e/)
  assert.match(source, /--code-surface: #f3f5f7/)
  assert.match(source, /--terminal-chrome-bg: #17191d/)
  assert.match(source, /--terminal-chrome-bg: #f7f8fa/)
  assert.match(source, /--terminal-frame-bg: #f7f9fc/)
  assert.match(source, /\.ai-command-output pre,[\s\S]*background: var\(--code-surface\)/)
  assert.match(source, /\.status-bar[\s\S]*background: var\(--terminal-chrome-bg\)/)
  assert.match(themeSource, /light:\s*\{[\s\S]*terminal:\s*\{[\s\S]*background: "#f7f9fc"/)
})

test('segmented controls, switches, drop targets and danger actions remain visible', async () => {
  const [redesignSource, formsSource] = await Promise.all([
    readFile(redesignStylesUrl, 'utf8'),
    readFile(formsStylesUrl, 'utf8'),
  ])

  assert.match(
    redesignSource,
    /\.theme-mode-control\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  )
  assert.match(
    redesignSource,
    /\.settings-switch-control input:checked \+ i::after,[\s\S]*background: #ffffff/,
  )
  assert.match(
    redesignSource,
    /\.dialog-actions button:not\(\.primary-button\):not\(\.danger-button\)/,
  )
  assert.match(formsSource, /\.transfer-file-list\.is-pane-drop-target/)
  assert.match(formsSource, /\.transfer-pane-location-selects/)
})

test('模型设置按供应商分组并在组内复用连接信息', async () => {
  const source = await readFile(settingsDialogUrl, 'utf8')

  assert.match(source, /function groupAiConfigs\(configs: AiModelConfig\[\]\)/)
  assert.match(source, /config\.providerName,\s*config\.baseUrl,\s*config\.apiKey/)
  assert.match(source, /function startAddAiModel\(group: AiProviderGroup\)/)
  assert.match(source, /baseUrl: group\.baseUrl,\s*apiKey: group\.apiKey/)
  assert.match(source, /组内模型已同步/)
  assert.match(source, /class="ai-provider-workspace"/)
})

test('聊天输入区通过级联面板同时选择供应商、模型和推理强度', async () => {
  const [source, redesignSource] = await Promise.all([
    readFile(panelUrl, 'utf8'),
    readFile(new URL('../../src/renderer/styles/redesign.css', import.meta.url), 'utf8'),
  ])

  assert.match(source, /class="ai-model-selection-menu"/)
  assert.match(source, /class="ai-model-cascade"/)
  assert.match(source, /class="ai-model-cascade-providers"/)
  assert.match(source, /class="ai-model-cascade-models"/)
  assert.match(source, /class="ai-model-cascade-reasoning"/)
  assert.match(source, /function previewProvider/)
  assert.doesNotMatch(source, /setModelSelectionMenuPage/)
  assert.match(source, /aiApiSpecLabels\[activeModelConfig\.spec\]/)
  assert.match(source, /思考强度/)
  assert.match(source, /emit\("updateModelReasoning"/)
  assert.match(source, /v-for="group in modelProviderGroups"/)
  assert.match(source, /normalizeAiReasoningValues\(/)
  assert.match(redesignSource, /\.ai-reasoning-option[\s\S]*white-space: nowrap/)
  assert.match(redesignSource, /word-break: keep-all/)
  assert.match(
    redesignSource,
    /\.ai-model-cascade-reasoning \.ai-reasoning-option\s*\{[\s\S]*width: auto/,
  )
})

test('聊天区模型选择器按内容自适应且发送按钮保持右对齐', async () => {
  const [source, baseSource, redesignSource, appSource] = await Promise.all([
    readFile(aiStylesUrl, 'utf8'),
    readFile(new URL('../../src/renderer/styles/base.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/renderer/styles/redesign.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/renderer/App.vue', import.meta.url), 'utf8'),
  ])

  assert.match(
    source,
    /\.ai-compose-actions\s*\{[\s\S]*?display: flex;[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/,
  )
  assert.match(
    source,
    /\.ai-model-selection-trigger\s*\{[\s\S]*?width: fit-content;[\s\S]*?max-width: 220px;/,
  )
  assert.doesNotMatch(
    source,
    /\.ai-model-selection-trigger\s*\{[^}]*width: 100%;/s,
  )
  assert.match(
    source,
    /\.ai-compose \.ai-action-btn\s*\{[\s\S]*?margin-left: auto;/,
  )
  assert.match(
    source,
    /\.ai-panel\s*\{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: none;/,
  )
  assert.match(baseSource, /body\s*\{[\s\S]*?min-width: 0;/)
  assert.match(
    baseSource,
    /minmax\(0, var\(--ai-panel-track-width, 360px\)\)/,
  )
  assert.match(
    redesignSource,
    /minmax\(0, var\(--ai-panel-track-width, 360px\)\)/,
  )
  assert.doesNotMatch(redesignSource, /minmax\(420px, 1fr\)/)
  assert.match(
    appSource,
    /'--ai-panel-track-width': isAiPanelOpen \? `\$\{aiPanelWidth\}px` : '42px'/,
  )
})

test('模型思考使用统一开关和用户可配置参数，不再暴露三模式', async () => {
  const source = await readFile(settingsDialogUrl, 'utf8')

  assert.doesNotMatch(source, /<span>思考模式<\/span>/)
  assert.doesNotMatch(source, /不发送思考参数/)
  assert.match(source, /<strong>模型思考<\/strong>/)
  assert.match(source, /v-model="aiConfigForm\.reasoningParameter"/)
  assert.match(source, /v-model="aiConfigForm\.reasoningEffort"/)
  assert.match(source, /v-model="reasoningEffortOptionsText"/)
  assert.match(source, /getAiReasoningDefaults\(/)
  assert.match(source, /v-model="aiConfigForm\.spec"/)
  assert.match(source, /aiApiSpecLabels/)
})

test('模型 ID 跨供应商匹配 models.dev 并保留用户可编辑参数', async () => {
  const source = await readFile(settingsDialogUrl, 'utf8')

  assert.match(source, /function findCatalogModel\(modelId: string\)/)
  assert.match(source, /getOfficialCatalogProviderId/)
  assert.match(source, /findCatalogModel\(aiConfigForm\.value\.model\)/)
  assert.match(source, /已从 models\.dev 匹配/)
  assert.match(source, /aiModelAutoFillTimer/)
  assert.match(source, /function queueModelCatalogAutoFill\(\)/)
  assert.match(source, /const typedModelId = aiConfigForm\.value\.model\.trim\(\)/)
  assert.match(source, /typedModelId === aiConfigInitialModelId\.value\.trim\(\)/)
  assert.match(source, /@input="queueModelCatalogAutoFill"/)
  assert.match(source, /aiConfigForm\.value\.model\.trim\(\) !== typedModelId/)
  assert.doesNotMatch(source, /loadAiCatalog\(\)\.then\(\(\) => applySelectedModel\(\)\)/)
  assert.match(source, /保存后生效/)
  assert.match(source, /spec: aiConfigForm\.value\.spec/)
  assert.match(source, /v-model="aiConfigForm\.reasoningParameter"/)
  assert.match(source, /v-model="reasoningEffortOptionsText"/)
})

test('旧模型配置迁移后持久化，编辑已有值时不被目录数据覆盖', async () => {
  const [dialogSource, settingsSource, styleSource] = await Promise.all([
    readFile(settingsDialogUrl, 'utf8'),
    readFile(settingsMainUrl, 'utf8'),
    readFile(redesignStylesUrl, 'utf8'),
  ])

  assert.match(settingsSource, /value\?\.contextLength/)
  assert.match(settingsSource, /value\?\.contextSize/)
  assert.match(settingsSource, /value\?\.maxTokens/)
  assert.match(settingsSource, /value\?\.maxOutput/)
  assert.match(settingsSource, /hasLegacyAiConfigShape\(rawSettings\)/)
  assert.match(settingsSource, /persistSettingsWithEncryptedAiKeys\(hydratedSettings\)/)
  assert.match(dialogSource, /aiConfigInitialModelId\.value = config\.model\.trim\(\)/)
  assert.doesNotMatch(dialogSource, /const initialFormSnapshot/)
  assert.doesNotMatch(dialogSource, /config\.catalogMetadataSynced !== false/)
  assert.match(dialogSource, /catalogMetadataSynced: true/)
  assert.doesNotMatch(
    styleSource,
    /\.ai-provider-item\.active\s*\{[^}]*box-shadow:\s*inset/s,
  )
})

test('模型配置保存等待主进程确认，失败时回滚且不关闭编辑表单', async () => {
  const [dialogSource, storeSource, appSource] = await Promise.all([
    readFile(settingsDialogUrl, 'utf8'),
    readFile(settingsStoreUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
  ])

  assert.match(dialogSource, /onComplete\?: \(saved: boolean\) => void/)
  assert.match(dialogSource, /if \(!saved\) \{[\s\S]*模型配置保存失败/)
  assert.match(dialogSource, /isAiConfigSaving\.value = true/)
  assert.match(dialogSource, /\{\{ isAiConfigSaving \? "保存中\.\.\." : "保存" \}\}/)
  assert.match(storeSource, /async function saveAppSettings\(\): Promise<boolean>/)
  assert.match(storeSource, /function cloneAiSettings\(value: AiSettings\): AiSettings/)
  assert.match(storeSource, /reasoningEffortOptions: \[\.\.\.config\.reasoningEffortOptions\]/)
  assert.match(storeSource, /inputModalities: \[\.\.\.config\.inputModalities\]/)
  assert.doesNotMatch(storeSource, /structuredClone\(appSettings\.ai\)/)
  assert.match(storeSource, /const previousAiSettings = cloneAiSettings\(appSettings\.ai\)/)
  assert.match(storeSource, /if \(!saved\) Object\.assign\(appSettings\.ai, previousAiSettings\)/)
  assert.match(appSource, /async function handleUpdateAiSettings/)
  assert.match(appSource, /finally \{\s+onComplete\?\.\(saved\)/)
  assert.match(appSource, /@update-ai-settings="handleUpdateAiSettings"/)
})

test('聊天区调整的推理强度写回当前模型配置', async () => {
  const source = await readFile(settingsStoreUrl, 'utf8')

  assert.match(source, /async function updateAiModelReasoning/)
  assert.match(source, /config\.reasoningEnabled = value\.reasoningEnabled/)
  assert.match(source, /config\.reasoningEffort = value\.reasoningEffort\.trim\(\)/)
  assert.match(source, /await saveAppSettings\(\)/)
})

test('目录模型使用 models.dev 实际限制，自定义模型默认 200K 上下文', async () => {
  const source = await readFile(settingsDialogUrl, 'utf8')

  assert.match(source, /contextWindow: model\.contextWindow \?\? DEFAULT_CUSTOM_AI_CONTEXT_WINDOW/)
  assert.match(source, /maxOutputTokens: model\.maxOutputTokens \?\? DEFAULT_AI_MAX_OUTPUT_TOKENS/)
  assert.match(source, /models\.dev 公布的上下文与输出上限/)
  assert.match(source, /200,000 tokens/)
})
