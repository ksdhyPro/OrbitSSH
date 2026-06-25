import type { ConnectConfig } from 'ssh2'

import type { ServerAuthConfig } from '../../shared/server.js'

type ServerConnectOptions = Pick<ConnectConfig, 'host' | 'port' | 'username' | 'password' | 'privateKey' | 'passphrase'>

// 根据服务器认证方式生成 ssh2 连接参数，避免终端和 SFTP 分别维护认证分支。
export function createServerConnectOptions(server: ServerAuthConfig): ServerConnectOptions {
  const baseOptions = {
    host: server.host,
    port: server.port,
    username: server.username
  }

  if (server.authType === 'privateKey') {
    return {
      ...baseOptions,
      privateKey: server.privateKey,
      passphrase: server.passphrase
    }
  }

  return {
    ...baseOptions,
    password: server.password
  }
}
