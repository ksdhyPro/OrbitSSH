<script setup lang="ts">
import AppDialog from "./AppDialog.vue";
import NumberStepper from "./NumberStepper.vue";
import SegmentedControl, { type SegmentedOption } from "./ui/SegmentedControl.vue";
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

const authTypeOptions: SegmentedOption<ServerAuthType>[] = [
  { value: "password", label: "密码" },
  { value: "privateKey", label: "密钥文件" },
];
</script>

<template>
  <AppDialog
    v-if="open"
    :title="editingServerId ? '编辑连接' : '新增连接'"
    width="medium"
    @close="emit('close')"
  >
    <form class="connection-form" @submit.prevent="emit('submit')">
      <label>
        <span>名称</span>
        <input v-model="connectionForm.name" type="text" placeholder="Production Gateway" />
      </label>
      <label>
        <span>Host</span>
        <input v-model="connectionForm.host" type="text" placeholder="192.168.1.10" />
      </label>
      <div class="form-row">
        <label>
          <span>Port</span>
          <NumberStepper
            :model-value="connectionForm.port"
            :min="1"
            :max="65535"
            @update:model-value="connectionForm.port = $event"
          />
        </label>
        <label>
          <span>Username</span>
          <input v-model="connectionForm.username" type="text" placeholder="root" />
        </label>
      </div>
      <SegmentedControl
        v-model="connectionForm.authType"
        :options="authTypeOptions"
        variant="tabs"
        ariaLabel="认证方式"
      />

      <template v-if="connectionForm.authType === 'password'">
        <label>
          <span>Password</span>
          <input
            v-model="connectionForm.password"
            type="password"
            :placeholder="
              editingServerId ? '留空表示不修改密码' : '密码会通过 safeStorage 加密保存'
            "
          />
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
              placeholder="请选择 SSH 密钥文件"
            />
            <button
              type="button"
              class="btn btn-ghost browse-button"
              @click="emit('selectPrivateKey')"
            >
              浏览
            </button>
          </div>
        </label>
        <label>
          <span>密钥口令</span>
          <input
            v-model="connectionForm.passphrase"
            type="password"
            :placeholder="editingServerId ? '可选，留空表示不修改' : '可选，存在口令时填写'"
          />
        </label>
      </template>

      <p v-if="formError" class="form-error">{{ formError }}</p>

      <footer class="dialog-actions">
        <button type="button" class="btn btn-ghost" @click="emit('close')">取消</button>
        <button type="submit" class="btn btn-primary" :disabled="isSubmittingServer">
          {{ isSubmittingServer ? "保存中..." : editingServerId ? "保存修改" : "添加到列表" }}
        </button>
      </footer>
    </form>
  </AppDialog>
</template>
