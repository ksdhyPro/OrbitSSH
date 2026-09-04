/** SSH TCP 端口转发规则；每条规则只表达一个 -L 或 -R 映射。 */
export type PortForwardDirection = 'local' | 'remote'
export type PortForwardListenScope = 'loopback' | 'lan'
export type PortForwardStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface PortForwardRule {
  id: string
  serverId: string
  name: string
  direction: PortForwardDirection
  listenScope: PortForwardListenScope
  listenPort: number
  targetHost: string
  targetPort: number
  createdAt: number
  updatedAt: number
}

export interface PortForwardRuleInput {
  serverId: string
  name: string
  direction: PortForwardDirection
  listenScope: PortForwardListenScope
  listenPort: number
  targetHost: string
  targetPort: number
}

export interface PortForwardRuleUpdateInput extends PortForwardRuleInput {
  id: string
}

export interface PortForwardRuntime {
  ruleId: string
  serverId: string
  status: PortForwardStatus
  message?: string
}

export interface PortForwardStatusEvent extends PortForwardRuntime {}
