import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = name => readFile(new URL(`../../src/${name}`, import.meta.url), 'utf8')

test('远程文件列表显示权限并提供 chmod 编辑入口', async () => {
  const [shared, session, ipc, preload, list, menu, dialog, store, sidebar, app] =
    await Promise.all([
      source('shared/sftp.ts'),
      source('main/sftp/sftp-session.ts'),
      source('main/ipc/sftp-ipc.ts'),
      source('preload/index.ts'),
      source('renderer/components/RemoteFileList.vue'),
      source('renderer/components/FileContextMenu.vue'),
      source('renderer/components/FilePermissionDialog.vue'),
       source('renderer/stores/useSftpStore.ts'),
       source('renderer/stores/useSidebarStore.ts'),
       source('renderer/App.vue'),
    ])

  assert.match(shared, /mode\?: number/)
  assert.match(shared, /interface SftpChmodInput/)
  assert.match(shared, /recursive\?: boolean/)
  assert.match(shared, /interface SftpStatResult/)
  assert.match(session, /mode: unixRightsToMode\(item\.rights\)/)
  assert.match(session, /session\.client\.chmod\(normalizedPath, normalizedMode\)/)
  assert.match(session, /stat\.mode & 0o7777/)
  assert.match(session, /item\.type === 'l'/)
  assert.match(session, /maxRecursiveChmodNodes/)
  assert.match(ipc, /ipcMain\.handle\('sftp:chmod'/)
  assert.match(ipc, /ipcMain\.handle\('sftp:stat'/)
  assert.match(preload, /ipcRenderer\.invoke\("sftp:chmod", input\)/)
  assert.match(preload, /ipcRenderer\.invoke\("sftp:stat", input\)/)
  assert.match(list, /formatUnixPermissions\(node\.mode\)/)
  assert.match(menu, /label: "权限"/)
  assert.match(
    menu,
    /node\?\.type === "directory"[\s\S]*uploadDirectoryItem,\s*permissionItem,\s*\{\s*key: "rename"/,
  )
  assert.doesNotMatch(menu, /disabled: node\?\.mode === undefined/)
  assert.match(dialog, /Setuid/)
  assert.match(dialog, /Setgid/)
  assert.match(dialog, /Sticky/)
  assert.match(dialog, /递归应用到目录内容/)
  assert.match(dialog, /<summary>高级权限<\/summary>/)
  assert.match(store, /core\.orbitSSHApi\.sftp\.stat/)
  assert.match(store, /async function saveFilePermissions\(mode: number, recursive: boolean\)/)
  assert.match(sidebar, /const sidebarWidth = ref\(360\)/)
  assert.match(sidebar, /Math\.min\(Math\.max\(width, 320\), 560\)/)
  assert.match(app, /<FilePermissionDialog/)
})

test('图片预览支持缩放、适应窗口、实际大小和按住拖拽平移', async () => {
  const [preview, styles] = await Promise.all([
    source('renderer/components/ImagePreviewDialog.vue'),
    source('renderer/styles/forms-and-status.css'),
  ])

  assert.match(preview, /PhMagnifyingGlassMinus/)
  assert.match(preview, /type="range"/)
  assert.match(preview, /function fitToViewport\(\)/)
  assert.match(preview, /function showActualSize\(\)/)
  assert.match(preview, /if \(!event\.ctrlKey && !event\.metaKey\) return/)
  assert.match(preview, /zoomAroundPoint\(zoom\.value \* factor, event\.clientX, event\.clientY\)/)
  assert.match(preview, /@wheel="handlePreviewWheel"/)
  assert.match(preview, /function handlePreviewPointerDown\(event: PointerEvent\)/)
  assert.match(preview, /body\.setPointerCapture\(event\.pointerId\)/)
  assert.match(preview, /body\.scrollLeft = dragStartScrollLeft - \(event\.clientX - dragStartX\)/)
  assert.match(preview, /@pointermove="handlePreviewPointerMove"/)
  assert.match(preview, /@pointercancel="finishPreviewDrag"/)
  assert.match(styles, /\.image-preview-body[\s\S]*overflow: auto/)
  assert.match(styles, /\.image-preview-body\.pannable[\s\S]*cursor: grab/)
  assert.match(styles, /\.image-preview-body\.dragging[\s\S]*cursor: grabbing/)
  assert.match(styles, /\.image-preview-canvas/)
})

test('远程文件行在明暗主题下都有清晰的整行悬停反馈', async () => {
  const styles = await source('renderer/styles/redesign.css')

  assert.match(styles, /--file-row-hover: #29313a/)
  assert.match(styles, /--file-row-hover: #dfe7f0/)
  assert.match(styles, /\.file-node:hover\s*\{[\s\S]*background: var\(--file-row-hover\)/)
  assert.match(styles, /\.file-node:hover small/)
})
