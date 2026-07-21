import assert from 'node:assert/strict'
import test from 'node:test'

import {
  findExecutedAiCommand,
  normalizeAiCommandForDedup,
} from '../../dist-electron/main/ai/ai-command-dedup.js'

test('重复命令比较会忽略首尾空白和换行格式', () => {
  assert.equal(
    normalizeAiCommandForDedup('  systemctl status nginx\r\n'),
    'systemctl status nginx',
  )
  assert.equal(
    normalizeAiCommandForDedup('docker compose   up -d  &&  docker compose ps'),
    'docker compose up -d&&docker compose ps',
  )
  assert.equal(
    normalizeAiCommandForDedup('docker compose up -d&&docker compose ps'),
    'docker compose up -d&&docker compose ps',
  )
})

test('本轮已经执行过的相同命令会被识别', () => {
  const executed = [
    {
      command: 'systemctl restart x-ui && sleep 2 && systemctl status x-ui',
      reason: '重启并检查服务',
      risk: 'high',
      result: {
        stdout: 'active (running)',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        durationMs: 100,
      },
    },
  ]

  assert.equal(
    findExecutedAiCommand(
      executed,
      'systemctl restart x-ui && sleep 2 && systemctl status x-ui',
    ),
    executed[0],
  )
  assert.equal(findExecutedAiCommand(executed, 'systemctl status x-ui'), undefined)
})
