import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatUnixMode,
  formatUnixPermissions,
  parseUnixMode,
  unixRightsToMode,
} from '../../dist-electron/shared/file-permissions.js'

test('SFTP 权限字符串转换为 chmod 模式并保留特殊权限位', () => {
  assert.equal(
    unixRightsToMode({ user: 'rws', group: 'r-x', other: 'r-t' }),
    0o5755,
  )
  assert.equal(formatUnixMode(0o5755), '5755')
  assert.equal(formatUnixPermissions(0o5755), 'rwsr-xr-t')
  assert.equal(
    unixRightsToMode({ user: 'rwS', group: 'r-S', other: 'r-T' }),
    0o7644,
  )
  assert.equal(formatUnixPermissions(0o7644), 'rwSr-Sr-T')
})

test('八进制权限只接受 3 到 4 位且范围为 0000-7777', () => {
  assert.equal(parseUnixMode('755'), 0o755)
  assert.equal(parseUnixMode('0644'), 0o644)
  assert.equal(parseUnixMode('888'), null)
  assert.equal(parseUnixMode('77'), null)
})
