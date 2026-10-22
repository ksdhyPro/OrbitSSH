<script setup lang="ts">
import { computed } from "vue";
import AppDialog from "./AppDialog.vue";
import AppSelect, { type AppSelectOption } from "./ui/AppSelect.vue";
import type { PortForwardRuleInput } from "../../shared/port-forward";
import type { ServerConfig } from "../../shared/server";

const props = defineProps<{
  open: boolean;
  servers: ServerConfig[];
  editing: boolean;
  form: PortForwardRuleInput;
  error: string;
  isSubmitting: boolean;
}>();

const emit = defineEmits<{ close: []; submit: [] }>();

const serverOptions = computed<AppSelectOption[]>(() =>
  props.servers.map(server => ({ value: server.id, label: `${server.name}（${server.host}）` })),
);
const directionOptions: AppSelectOption<PortForwardRuleInput["direction"]>[] = [
  { value: "local", label: "本地访问远程服务端口 (-L)" },
  { value: "remote", label: "远程访问本地服务端口 (-R)" },
];
const listenScopeOptions: AppSelectOption<PortForwardRuleInput["listenScope"]>[] = [
  { value: "loopback", label: "仅本机" },
  { value: "lan", label: "局域网" },
];

const directionHint = computed(() =>
  props.form.direction === "local"
    ? "本地访问远程服务端口：连接本机监听端口后，将通过 SSH 访问远程服务器的本机服务。"
    : "远程访问本地服务端口：连接远程服务器监听端口后，将通过 SSH 访问本机服务。",
);
</script>

<template>
  <AppDialog
    v-if="open"
    :title="`${editing ? '编辑' : '新建'}端口转发`"
    :description="directionHint"
    width="medium"
    @close="emit('close')"
  >
    <form class="port-forward-form" @submit.prevent="emit('submit')">
      <label
        ><span>规则名称</span
        ><input v-model="form.name" maxlength="100" placeholder="例如：本地访问数据库"
      /></label>
      <label
        ><span>服务器</span
        ><AppSelect
          v-model="form.serverId"
          :options="serverOptions"
          ariaLabel="服务器"
          placeholder="请选择服务器"
      /></label>
      <div class="form-row">
        <label
          ><span>转发方向</span
          ><AppSelect v-model="form.direction" :options="directionOptions" ariaLabel="转发方向"
        /></label>
        <label
          ><span>监听范围</span
          ><AppSelect v-model="form.listenScope" :options="listenScopeOptions" ariaLabel="监听范围"
        /></label>
      </div>
      <div class="form-row">
        <label
          ><span>{{ form.direction === "local" ? "本机监听端口" : "远端监听端口" }}</span
          ><input v-model.number="form.listenPort" type="number" min="1" max="65535"
        /></label>
        <label
          ><span>{{ form.direction === "local" ? "远程服务端口" : "本地服务端口" }}</span
          ><input v-model.number="form.targetPort" type="number" min="1" max="65535"
        /></label>
      </div>
      <p class="port-forward-hint">
        本地访问远程服务时，远程服务为当前 SSH
        服务器；远程访问本地服务时，本地服务为当前电脑。服务地址由应用自动处理，无需填写。
      </p>
      <p v-if="form.listenScope === 'lan'" class="port-forward-warning">
        局域网监听会暴露端口，请确认防火墙与目标服务的访问控制配置。
      </p>
      <p v-if="error" class="form-error">{{ error }}</p>
      <footer class="dialog-actions">
        <button type="button" class="btn btn-ghost" @click="emit('close')">取消</button
        ><button class="btn btn-primary" :disabled="isSubmitting">
          {{ isSubmitting ? "保存中…" : "保存规则" }}
        </button>
      </footer>
    </form>
  </AppDialog>
</template>
