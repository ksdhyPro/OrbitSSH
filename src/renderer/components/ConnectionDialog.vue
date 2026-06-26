<script setup lang="ts">
import AppDialog from "./AppDialog.vue";
import NumberStepper from "./NumberStepper.vue";
import type { ServerAuthType } from "../../shared/server";

const props = defineProps<{
  open: boolean;
  editingServerId: string | null;
  connectionForm: {
    name: string;
    host: string;
    port: number;
    username: string;
    authType: ServerAuthType;
    password: string;
    privateKeyPath: string;
    passphrase: string;
  };
  formError: string;
  isSubmittingServer: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
  selectPrivateKey: [];
}>();

function setAuthType(authType: ServerAuthType): void {
  props.connectionForm.authType = authType;
}
</script>

<template>
  <AppDialog
    v-if="open"
    :title="editingServerId ? '编辑连接' : '新增连接'"
    description="填写 SSH 连接信息，保存后可直接打开终端和 SFTP。"
    width="medium"
    @close="emit('close')">
    <form class="connection-form" @submit.prevent="emit('submit')">
      <label>
        <span>名称</span>
        <input
          v-model="connectionForm.name"
          type="text"
          placeholder="Production Gateway" />
      </label>
      <label>
        <span>Host</span>
        <input
          v-model="connectionForm.host"
          type="text"
          placeholder="192.168.1.10" />
      </label>
      <div class="form-row">
        <label>
          <span>Port</span>
          <NumberStepper
            :model-value="connectionForm.port"
            :min="1"
            :max="65535"
            @update:model-value="connectionForm.port = $event" />
        </label>
        <label>
          <span>Username</span>
          <input
            v-model="connectionForm.username"
            type="text"
          placeholder="root" />
        </label>
      </div>
      <div class="auth-tabs" role="tablist" aria-label="认证方式">
        <button
          type="button"
          role="tab"
          :aria-selected="connectionForm.authType === 'password'"
          :class="{ active: connectionForm.authType === 'password' }"
          @click="setAuthType('password')">
          密码
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="connectionForm.authType === 'privateKey'"
          :class="{ active: connectionForm.authType === 'privateKey' }"
          @click="setAuthType('privateKey')">
          密钥文件
        </button>
      </div>

      <template v-if="connectionForm.authType === 'password'">
        <label>
          <span>Password</span>
          <input
            v-model="connectionForm.password"
            type="password"
            :placeholder="
              editingServerId
                ? '留空表示不修改密码'
                : '密码会通过 safeStorage 加密保存'
            " />
        </label>
      </template>
      <template v-else>
        <label>
          <span>密钥文件路径</span>
          <div class="key-file-picker">
            <input
              :value="connectionForm.privateKeyPath"
              type="text"
              readonly
              placeholder="请选择 SSH 密钥文件" />
            <button
              type="button"
              class="ghost-button browse-button"
              @click="emit('selectPrivateKey')">
              浏览
            </button>
          </div>
        </label>
        <label>
          <span>密钥口令</span>
          <input
            v-model="connectionForm.passphrase"
            type="password"
            :placeholder="
              editingServerId
                ? '可选，留空表示不修改'
                : '可选，存在口令时填写'
            " />
        </label>
      </template>

      <p v-if="formError" class="form-error">{{ formError }}</p>

      <footer class="dialog-actions">
        <button type="button" class="ghost-button" @click="emit('close')">
          取消
        </button>
        <button type="submit" class="primary-button" :disabled="isSubmittingServer">
          {{
            isSubmittingServer
              ? "保存中..."
              : editingServerId
                ? "保存修改"
                : "添加到列表"
          }}
        </button>
      </footer>
    </form>
  </AppDialog>
</template>
