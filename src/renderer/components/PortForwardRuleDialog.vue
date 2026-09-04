<script setup lang="ts">
import { computed } from 'vue'
import AppDialog from './AppDialog.vue'
import type { PortForwardRuleInput } from '../../shared/port-forward'
import type { ServerConfig } from '../../shared/server'

const props = defineProps<{
  open: boolean
  servers: ServerConfig[]
  editing: boolean
  form: PortForwardRuleInput
  error: string
  isSubmitting: boolean
}>()

const emit = defineEmits<{ close: []; submit: [] }>()

const directionHint = computed(() => props.form.direction === 'local'
  ? '本地访问远程服务端口：连接本机监听端口后，将通过 SSH 访问远程服务器的本机服务。'
  : '远程访问本地服务端口：连接远程服务器监听端口后，将通过 SSH 访问本机服务。')
</script>

<template>
  <AppDialog
    v-if="open"
    :title="`${editing ? '编辑' : '新建'}端口转发`"
    :description="directionHint"
    width="medium"
    @close="emit('close')">
    <form class="port-forward-form" @submit.prevent="emit('submit')">
      <label><span>规则名称</span><input v-model="form.name" maxlength="100" placeholder="例如：本地访问数据库" /></label>
      <label><span>服务器</span><select v-model="form.serverId"><option v-for="server in servers" :key="server.id" :value="server.id">{{ server.name }}（{{ server.host }}）</option></select></label>
      <div class="form-row">
        <label><span>转发方向</span><select v-model="form.direction"><option value="local">本地访问远程服务端口 (-L)</option><option value="remote">远程访问本地服务端口 (-R)</option></select></label>
        <label><span>监听范围</span><select v-model="form.listenScope"><option value="loopback">仅本机</option><option value="lan">局域网</option></select></label>
      </div>
      <div class="form-row">
        <label><span>{{ form.direction === 'local' ? '本机监听端口' : '远端监听端口' }}</span><input v-model.number="form.listenPort" type="number" min="1" max="65535" /></label>
        <label><span>{{ form.direction === 'local' ? '远程服务端口' : '本地服务端口' }}</span><input v-model.number="form.targetPort" type="number" min="1" max="65535" /></label>
      </div>
      <p class="port-forward-hint">本地访问远程服务时，远程服务为当前 SSH 服务器；远程访问本地服务时，本地服务为当前电脑。服务地址由应用自动处理，无需填写。</p>
      <p v-if="form.listenScope === 'lan'" class="port-forward-warning">局域网监听会暴露端口，请确认防火墙与目标服务的访问控制配置。</p>
      <p v-if="error" class="form-error">{{ error }}</p>
      <footer class="dialog-actions"><button type="button" class="ghost-button" @click="emit('close')">取消</button><button class="primary-button" :disabled="isSubmitting">{{ isSubmitting ? '保存中…' : '保存规则' }}</button></footer>
    </form>
  </AppDialog>
</template>
