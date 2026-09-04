export type ServerAuthType = 'password' | 'privateKey'

export interface ServerConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: ServerAuthType
  passwordKey?: string
  privateKeyPath?: string
  passphraseKey?: string
  isPinned?: boolean
  /** 所属分组，未分组时为空。 */
  groupId?: string
  /** 列表条目的自定义背景色，未设置时使用默认背景。 */
  color?: string
  createdAt: number
  updatedAt: number
}

export interface ServerInput {
  name: string
  host: string
  port: number
  username: string
  authType?: ServerAuthType
  password?: string
  privateKeyPath?: string
  passphrase?: string
}

export interface ServerUpdateInput extends ServerInput {
  id: string
}

export interface ServerPinInput {
  id: string
  isPinned: boolean
}

export interface ServerAppearanceInput {
  id: string
  groupId?: string
  color?: string
}

export interface ServerGroup {
  id: string
  name: string
  color?: string
  createdAt: number
  updatedAt: number
}

export interface ServerGroupInput {
  name: string
  color?: string
}

export interface ServerGroupUpdateInput extends ServerGroupInput {
  id: string
}

/** 绑定到单台服务器的终端常用命令。 */
export interface ServerAutomationTask {
  id: string
  serverId: string
  name: string
  script: string
  createdAt: number
  updatedAt: number
}

export interface ServerAutomationTaskInput {
  serverId: string
  name: string
  script: string
}

export type ServerAuthConfig =
  | (ServerConfig & {
      authType: 'password'
      password: string
    })
  | (ServerConfig & {
      authType: 'privateKey'
      privateKey: string
      passphrase?: string
    })
