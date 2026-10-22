import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { isAppNavigation, isExternalHttpUrl } from '../../dist-electron/main/window/navigation-policy.js'

test('只有 http/https 链接可以交给系统浏览器打开', () => {
  assert.equal(isExternalHttpUrl('https://gitee.com/ksdhy/orbit-ssh'), true)
  assert.equal(isExternalHttpUrl('http://127.0.0.1:8080/status'), true)
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'smb://attacker/share',
    'vscode://file/etc/hosts',
    'not a url'
  ]) {
    assert.equal(isExternalHttpUrl(url), false, url)
  }
})

test('应用窗口只能停留在自身页面，外部地址不能替换窗口内容', () => {
  const devUrl = 'http://127.0.0.1:5173/'
  assert.equal(isAppNavigation('http://127.0.0.1:5173/#/settings', devUrl), true)
  assert.equal(isAppNavigation('https://evil.example.com/', devUrl), false)
  assert.equal(isAppNavigation('http://127.0.0.1:5174/', devUrl), false)

  const fileUrl = 'file:///Applications/OrbitSSH.app/Contents/Resources/app/dist/index.html'
  assert.equal(isAppNavigation(`${fileUrl}#ai`, fileUrl), true)
  assert.equal(isAppNavigation('file:///etc/passwd', fileUrl), false)
  assert.equal(isAppNavigation('https://example.com/', fileUrl), false)
})

test('所有窗口统一拦截新窗口、外部导航和 webview', async () => {
  const source = await readFile(new URL('../../src/main/index.ts', import.meta.url), 'utf8')

  assert.match(source, /app\.on\("web-contents-created"/)
  assert.match(source, /setWindowOpenHandler\([\s\S]*?return \{ action: "deny" \}/)
  assert.match(source, /"will-navigate"[\s\S]*?event\.preventDefault\(\)/)
  assert.match(source, /"will-attach-webview", event => event\.preventDefault\(\)/)
})
