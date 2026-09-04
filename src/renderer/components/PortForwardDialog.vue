<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import AppDialog from './AppDialog.vue'
import DeleteConfirmDialog from './DeleteConfirmDialog.vue'
import PortForwardRuleDialog from './PortForwardRuleDialog.vue'
import type { PortForwardRule, PortForwardRuleInput, PortForwardRuntime } from '../../shared/port-forward'
import type { ServerConfig } from '../../shared/server'

const props = defineProps<{ open: boolean; servers: ServerConfig[] }>()
const emit = defineEmits<{ close: [] }>()

const rules = ref<PortForwardRule[]>([])
const runtimes = reactive<Record<string, PortForwardRuntime>>({})
const error = ref('')
const ruleDialog = reactive({ open: false, editingId: '', error: '', isSubmitting: false })
// 删除确认留在 Renderer 内，避免原生确认框阻塞 WebContents 的焦点与输入事件。
const deleteDialog = reactive({ open: false, rule: null as PortForwardRule | null, isDeleting: false })
const form = reactive<PortForwardRuleInput>({ serverId: '', name: '', direction: 'local', listenScope: 'loopback', listenPort: 0, targetHost: '127.0.0.1', targetPort: 0 })
let removeStatusListener: (() => void) | null = null

function statusOf(rule: PortForwardRule): PortForwardRuntime['status'] { return runtimes[rule.id]?.status ?? 'stopped' }
function isActive(rule: PortForwardRule): boolean { const status = statusOf(rule); return status === 'starting' || status === 'running' }
function getServer(serverId: string): ServerConfig | undefined { return props.servers.find(server => server.id === serverId) }
function resetForm(rule?: PortForwardRule): void {
  ruleDialog.editingId = rule?.id ?? ''
  form.serverId = rule?.serverId ?? props.servers[0]?.id ?? ''
  form.name = rule?.name ?? ''
  form.direction = rule?.direction ?? 'local'
  form.listenScope = rule?.listenScope ?? 'loopback'
  form.listenPort = rule?.listenPort ?? 0
  // -L 的目标固定为当前 SSH 服务器，-R 的目标固定为本机回环地址。
  form.targetHost = rule?.direction === 'remote' ? '127.0.0.1' : (getServer(form.serverId)?.host ?? '127.0.0.1')
  form.targetPort = rule?.targetPort ?? 0
  ruleDialog.error = ''
}
async function load(): Promise<void> {
  if (!window.orbitSSH?.portForwards) return
  error.value = ''
  try {
    const result = await Promise.all(props.servers.map(server => Promise.all([window.orbitSSH.portForwards.list(server.id), window.orbitSSH.portForwards.listRuntimes(server.id)])))
    rules.value = result.flatMap(([savedRules]) => savedRules)
    for (const [, savedRuntimes] of result) for (const runtime of savedRuntimes) runtimes[runtime.ruleId] = runtime
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '加载端口转发规则失败' }
}
function openCreate(): void { resetForm(); ruleDialog.open = true }
function openEdit(rule: PortForwardRule): void { if (!isActive(rule)) { resetForm(rule); ruleDialog.open = true } }
function closeRuleDialog(): void { if (!ruleDialog.isSubmitting) ruleDialog.open = false }
async function saveRule(): Promise<void> {
  if (!form.serverId) { ruleDialog.error = '请选择服务器'; return }
  ruleDialog.isSubmitting = true; ruleDialog.error = ''
  try {
    if (ruleDialog.editingId) {
      const updated = await window.orbitSSH.portForwards.update({ id: ruleDialog.editingId, ...form })
      rules.value = rules.value.map(rule => rule.id === updated.id ? updated : rule)
    } else {
      rules.value = [...rules.value, await window.orbitSSH.portForwards.create(form)]
    }
    ruleDialog.open = false
  } catch (cause) { ruleDialog.error = cause instanceof Error ? cause.message : '保存端口转发规则失败' } finally { ruleDialog.isSubmitting = false }
}
async function start(rule: PortForwardRule): Promise<void> {
  error.value = ''
  try { await window.orbitSSH.portForwards.start(rule.id) } catch (cause) { runtimes[rule.id] = { ruleId: rule.id, serverId: rule.serverId, status: 'error', message: cause instanceof Error ? cause.message : '启动失败' } }
}
async function stop(rule: PortForwardRule): Promise<void> { try { await window.orbitSSH.portForwards.stop(rule.id) } catch (cause) { error.value = cause instanceof Error ? cause.message : '断开端口转发失败' } }
function requestRemove(rule: PortForwardRule): void {
  if (isActive(rule)) return
  // 仅记录待删除规则，用户确认前不修改持久化数据。
  deleteDialog.rule = rule
  deleteDialog.open = true
}
function closeDeleteDialog(): void {
  if (deleteDialog.isDeleting) return
  deleteDialog.open = false
  deleteDialog.rule = null
}
async function remove(): Promise<void> {
  const rule = deleteDialog.rule
  if (!rule || isActive(rule)) return
  deleteDialog.isDeleting = true
  try {
    await window.orbitSSH.portForwards.delete(rule.id)
    rules.value = rules.value.filter(item => item.id !== rule.id)
    delete runtimes[rule.id]
    deleteDialog.open = false
    deleteDialog.rule = null
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除端口转发规则失败' } finally { deleteDialog.isDeleting = false }
}
function statusText(rule: PortForwardRule): string { const runtime = runtimes[rule.id]; return runtime?.status === 'starting' ? '启动中' : runtime?.status === 'running' ? '运行中' : runtime?.status === 'error' ? '失败' : '未启动' }

watch(() => [props.open, props.servers.length], ([open]) => { if (open) void load() }, { immediate: true })
onMounted(() => { removeStatusListener = window.orbitSSH?.portForwards?.onStatus(event => { runtimes[event.ruleId] = event }) ?? null })
onUnmounted(() => removeStatusListener?.())
</script>

<template>
  <AppDialog v-if="open" title="端口转发" description="规则通过独立后台 SSH 连接运行，关闭终端不会中断转发。" width="large" @close="emit('close')">
    <section class="port-forward-dialog"><div class="port-forward-toolbar"><p>仅支持 TCP 单端口转发；规则需手动开启。</p><button class="primary-button" @click="openCreate">新建规则</button></div><p v-if="error" class="form-error">{{ error }}</p><div class="port-forward-table-wrap"><table class="port-forward-table"><thead><tr><th>服务器</th><th>名称</th><th>访问方向</th><th>监听端口</th><th>服务端口</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-if="!rules.length"><td colspan="7" class="port-forward-empty">暂无端口转发规则</td></tr><tr v-for="rule in rules" :key="rule.id"><td>{{ getServer(rule.serverId)?.name ?? '已删除服务器' }}</td><td>{{ rule.name }}</td><td>{{ rule.direction === 'local' ? '本地访问远程服务 (-L)' : '远程访问本地服务 (-R)' }}</td><td>{{ rule.listenScope === 'lan' ? '0.0.0.0' : '127.0.0.1' }}:{{ rule.listenPort }}</td><td>{{ rule.direction === 'local' ? getServer(rule.serverId)?.host : '127.0.0.1' }}:{{ rule.targetPort }}</td><td><span :class="['port-forward-status', `is-${statusOf(rule)}`]">{{ statusText(rule) }}</span><small v-if="runtimes[rule.id]?.message">{{ runtimes[rule.id].message }}</small></td><td><div class="port-forward-actions"><button v-if="isActive(rule)" class="ai-config-mini-button" @click="stop(rule)">断开</button><button v-else class="ai-config-mini-button" @click="start(rule)">开启</button><button class="ai-config-mini-button" :disabled="isActive(rule)" @click="openEdit(rule)">编辑</button><button class="ai-config-mini-button ai-config-danger-button" :disabled="isActive(rule)" @click="requestRemove(rule)">删除</button></div></td></tr></tbody></table></div></section>
    <PortForwardRuleDialog :open="ruleDialog.open" :servers="servers" :editing="Boolean(ruleDialog.editingId)" :form="form" :error="ruleDialog.error" :is-submitting="ruleDialog.isSubmitting" @close="closeRuleDialog" @submit="saveRule" />
    <DeleteConfirmDialog :open="deleteDialog.open" title="删除端口转发规则" :message="`确认删除端口转发规则“${deleteDialog.rule?.name ?? ''}”？`" confirm-label="删除" :danger="true" @cancel="closeDeleteDialog" @confirm="remove" />
  </AppDialog>
</template>
