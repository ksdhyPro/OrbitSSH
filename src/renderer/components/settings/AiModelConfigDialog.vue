<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { AiModelConfig, AiSettings } from "../../../shared/settings";
import {
  createEmptyAiModelConfigForm,
  maskApiKey,
  toAiModelConfig,
  validateAiModelConfigForm,
  type AiModelConfigForm,
} from "../../utils/ai-model-config-form";
import AppDialog from "../AppDialog.vue";

const props = defineProps<{
  open: boolean;
  aiSettings: AiSettings;
}>();

const emit = defineEmits<{
  close: [];
  updateAiSettings: [value: AiSettings];
}>();

// 编辑的是草稿副本，用户输入未完成时不会直接写入全局设置。
const configDraft = ref<AiModelConfig[]>([]);
const message = ref("");
const isFormDialogOpen = ref(false);
const editingConfigId = ref<string | null>(null);
const form = ref<AiModelConfigForm>(createEmptyAiModelConfigForm());

const formError = computed(() => validateAiModelConfigForm(form.value));
const formDialogTitle = computed(() => (editingConfigId.value ? "编辑模型" : "新增模型"));

function cloneConfigs(configs: AiModelConfig[]): AiModelConfig[] {
  return configs.map(config => ({ ...config }));
}

function resetForm(): void {
  editingConfigId.value = null;
  form.value = createEmptyAiModelConfigForm();
}

watch(
  () => props.open,
  open => {
    if (!open) return;
    configDraft.value = cloneConfigs(props.aiSettings.configs);
    resetForm();
    isFormDialogOpen.value = false;
    message.value = "";
  },
  { immediate: true },
);

function closeFormDialog(): void {
  isFormDialogOpen.value = false;
  resetForm();
}

function startAdd(): void {
  resetForm();
  message.value = "";
  isFormDialogOpen.value = true;
}

function startEdit(config: AiModelConfig): void {
  editingConfigId.value = config.id;
  form.value = {
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    contextTokenLimitK: config.contextTokenLimitK,
  };
  message.value = "";
  isFormDialogOpen.value = true;
}

function persist(configs: AiModelConfig[], activeConfigId: string): void {
  emit("updateAiSettings", { ...props.aiSettings, activeConfigId, configs });
  configDraft.value = cloneConfigs(configs);
}

function saveForm(): void {
  if (formError.value) {
    message.value = formError.value;
    return;
  }

  const config = toAiModelConfig(form.value, editingConfigId.value ?? `ai-${crypto.randomUUID()}`);
  const nextConfigs = editingConfigId.value
    ? configDraft.value.map(item => (item.id === editingConfigId.value ? config : item))
    : [...configDraft.value, config];

  persist(nextConfigs, props.aiSettings.activeConfigId || config.id);
  closeFormDialog();
  message.value = "模型配置已保存。";
}

function selectConfig(configId: string): void {
  persist(configDraft.value, configId);
  message.value = "当前模型已更新。";
}

function removeConfig(configId: string): void {
  const nextConfigs = configDraft.value.filter(config => config.id !== configId);
  const activeConfigId =
    props.aiSettings.activeConfigId === configId
      ? (nextConfigs[0]?.id ?? "")
      : props.aiSettings.activeConfigId;

  persist(nextConfigs, activeConfigId);
  if (editingConfigId.value === configId) resetForm();
  message.value = "模型配置已删除。";
}
</script>

<template>
  <AppDialog v-if="open" title="模型配置" width="large" @close="emit('close')">
    <div class="ai-config-dialog">
      <div class="ai-config-toolbar">
        <p>API Key 仅加密保存在本机。</p>
        <div class="ai-config-actions">
          <button type="button" class="btn btn-primary" @click="startAdd">新增模型</button>
        </div>
      </div>

      <div v-if="message" class="ai-config-status">
        <p class="ai-config-form-tip">{{ message }}</p>
      </div>

      <div class="ai-config-table-wrap">
        <table class="ai-config-table">
          <thead>
            <tr>
              <th>模型名</th>
              <th>提供商</th>
              <th>连接信息</th>
              <th>上下文限制</th>
              <th>当前</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="configDraft.length === 0">
              <td colspan="6" class="empty-state ai-config-empty">
                暂无模型配置，点击「新增」开始配置
              </td>
            </tr>
            <tr
              v-for="config in configDraft"
              :key="config.id"
              :class="{ 'ai-config-row-active': config.id === aiSettings.activeConfigId }"
            >
              <td>{{ config.model }}</td>
              <td>OpenAI 兼容</td>
              <td>{{ maskApiKey(config.apiKey) }}</td>
              <td>
                {{ config.contextTokenLimitK > 0 ? `${config.contextTokenLimitK}K` : "未设置" }}
              </td>
              <td>
                <span
                  v-if="config.id === aiSettings.activeConfigId"
                  class="ai-config-current-badge"
                >
                  当前
                </span>
                <button
                  v-else
                  type="button"
                  class="btn btn-secondary btn-sm"
                  @click="selectConfig(config.id)"
                >
                  使用
                </button>
              </td>
              <td>
                <div class="ai-config-actions">
                  <button type="button" class="btn btn-secondary btn-sm" @click="startEdit(config)">
                    编辑
                  </button>
                  <button
                    type="button"
                    class="btn btn-danger-soft btn-sm"
                    @click="removeConfig(config.id)"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppDialog>

  <!-- 新增/编辑模型：独立子弹窗，避免常驻表单撑高列表弹窗 -->
  <AppDialog
    v-if="open && isFormDialogOpen"
    :title="formDialogTitle"
    width="medium"
    @close="closeFormDialog"
  >
    <form class="ai-config-form" @submit.prevent="saveForm">
      <p class="ai-config-form-tip" :class="{ 'is-error': formError }">
        {{ formError || "填写完整后保存，API Key 仅本地保存。" }}
      </p>

      <label>
        <span>模型名</span>
        <input
          v-model="form.model"
          class="settings-text-input"
          type="text"
          placeholder="deepseek-chat"
        />
      </label>

      <label>
        <span>Base URL</span>
        <input
          v-model="form.baseUrl"
          class="settings-text-input"
          type="url"
          placeholder="https://api.example.com"
        />
      </label>

      <label>
        <span>API Key</span>
        <input
          v-model="form.apiKey"
          class="settings-text-input"
          type="password"
          autocomplete="off"
          placeholder="sk-..."
        />
      </label>

      <label>
        <span>上下文总 Token 限制</span>
        <div class="ai-config-number-input">
          <input
            v-model.number="form.contextTokenLimitK"
            class="settings-text-input"
            type="number"
            min="1"
            step="1"
            placeholder="128"
          />
          <span>K</span>
        </div>
      </label>

      <div class="ai-config-form-actions">
        <button type="button" class="btn btn-ghost" @click="closeFormDialog">取消</button>
        <button type="submit" class="btn btn-primary" :disabled="Boolean(formError)">保存</button>
      </div>
    </form>
  </AppDialog>
</template>
