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
