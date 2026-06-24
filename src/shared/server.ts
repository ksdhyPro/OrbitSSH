export interface ServerConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password'
  passwordKey: string
  createdAt: number
  updatedAt: number
}

export interface ServerInput {
  name: string
  host: string
  port: number
  username: string
  password?: string
}

export interface ServerUpdateInput extends ServerInput {
  id: string
}
