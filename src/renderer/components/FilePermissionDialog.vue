<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PhLockKey } from "@phosphor-icons/vue";

import {
  formatUnixMode,
  formatUnixPermissions,
  parseUnixMode,
} from "../../shared/file-permissions";
import type { FilePermissionDialogState } from "../types/sftp";
import AppDialog from "./AppDialog.vue";

const props = defineProps<{
  state: FilePermissionDialogState;
}>();

const emit = defineEmits<{
  close: [];
  save: [mode: number, recursive: boolean];
}>();

const mode = ref(0);
const octalValue = ref("0000");
const recursive = ref(false);

const permissionGroups = [
  {
    label: "所有者",
    permissions: [
      { label: "读取", bit: 0o400 },
      { label: "写入", bit: 0o200 },
      { label: "执行", bit: 0o100 },
    ],
  },
  {
    label: "用户组",
    permissions: [
      { label: "读取", bit: 0o040 },
      { label: "写入", bit: 0o020 },
      { label: "执行", bit: 0o010 },
    ],
  },
  {
    label: "其他用户",
    permissions: [
      { label: "读取", bit: 0o004 },
      { label: "写入", bit: 0o002 },
      { label: "执行", bit: 0o001 },
    ],
  },
] as const;

const specialPermissions = [
  {
    label: "以所有者身份运行",
    code: "Setuid",
    description: "仅用于可执行文件",
    bit: 0o4000,
  },
  {
    label: "继承所属用户组",
    code: "Setgid",
    description: "目录中新建内容继承该用户组",
    bit: 0o2000,
  },
  {
    label: "仅所有者可删除",
    code: "Sticky",
    description: "常用于多人共享目录",
    bit: 0o1000,
  },
] as const;

const presets = [
  { label: "644", mode: 0o644 },
  { label: "600", mode: 0o600 },
  { label: "755", mode: 0o755 },
  { label: "700", mode: 0o700 },
] as const;

const parsedMode = computed(() => parseUnixMode(octalValue.value));
const symbolicMode = computed(() => formatUnixPermissions(mode.value));
const isDirectory = computed(() => props.state.node?.type === "directory");
const canEdit = computed(
  () => !props.state.loading && props.state.node?.mode !== undefined,
);

function setMode(nextMode: number): void {
  mode.value = nextMode;
  octalValue.value = formatUnixMode(nextMode);
}

function handleOctalInput(event: Event): void {
  const nextValue = (event.target as HTMLInputElement).value
    .replace(/[^0-7]/g, "")
    .slice(0, 4);
  octalValue.value = nextValue;
  const parsed = parseUnixMode(nextValue);
  if (parsed !== null) mode.value = parsed;
}

function normalizeOctalInput(): void {
  if (parsedMode.value !== null) setMode(parsedMode.value);
}

function togglePermission(bit: number, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked;
  setMode(checked ? mode.value | bit : mode.value & ~bit);
}

function save(): void {
  const parsed = parsedMode.value;
  if (parsed === null || props.state.saving || !canEdit.value) return;
  emit("save", parsed, isDirectory.value && recursive.value);
}

watch(
  () => [props.state.open, props.state.node?.path, props.state.node?.mode] as const,
  ([open]) => {
    if (open) {
      setMode(props.state.node?.mode ?? 0);
      recursive.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <AppDialog
    v-if="state.open"
    :title="isDirectory ? '目录权限' : '文件权限'"
    :description="state.node?.path"
    width="medium"
    @close="emit('close')">
    <form class="file-permission-dialog" @submit.prevent="save">
      <div class="file-permission-summary">
        <PhLockKey :size="20" weight="regular" aria-hidden="true" />
        <div>
          <strong>{{ symbolicMode }}</strong>
          <span>{{ octalValue || "----" }}</span>
        </div>
        <dl>
          <div>
            <dt>UID</dt>
            <dd>{{ state.node?.ownerId ?? "-" }}</dd>
          </div>
          <div>
            <dt>GID</dt>
            <dd>{{ state.node?.groupId ?? "-" }}</dd>
          </div>
        </dl>
      </div>

      <p v-if="state.loading" class="file-permission-loading">正在读取服务器权限...</p>

      <fieldset class="file-permission-fields" :disabled="!canEdit || state.saving">
        <div class="file-permission-octal-row">
          <label for="file-permission-octal">八进制权限</label>
          <input
            id="file-permission-octal"
            :value="octalValue"
            inputmode="numeric"
            maxlength="4"
            spellcheck="false"
            aria-describedby="file-permission-octal-hint"
            @input="handleOctalInput"
            @blur="normalizeOctalInput" />
          <span id="file-permission-octal-hint">0000-7777</span>
        </div>

        <div class="file-permission-presets" aria-label="常用权限">
          <button
            v-for="preset in presets"
            :key="preset.label"
            type="button"
            :class="{ active: mode === preset.mode }"
            @click="setMode(preset.mode)">
            {{ preset.label }}
          </button>
        </div>

        <div class="file-permission-grid">
          <div class="file-permission-grid-header" aria-hidden="true">
            <span></span>
            <span>读取</span>
            <span>写入</span>
            <span>执行</span>
          </div>
          <div
            v-for="group in permissionGroups"
            :key="group.label"
            class="file-permission-grid-row">
            <strong>{{ group.label }}</strong>
            <label
              v-for="permission in group.permissions"
              :key="permission.bit"
              :title="`${group.label}${permission.label}`">
              <input
                type="checkbox"
                :checked="Boolean(mode & permission.bit)"
                :aria-label="`${group.label}${permission.label}`"
                @change="togglePermission(permission.bit, $event)" />
            </label>
          </div>
        </div>

        <label v-if="isDirectory" class="file-permission-recursive">
          <input v-model="recursive" type="checkbox" />
          <span>
            <strong>递归应用到目录内容</strong>
            <small>同时修改所有子文件和子目录，符号链接会跳过</small>
          </span>
        </label>

        <details class="file-permission-advanced">
          <summary>高级权限</summary>
          <div class="file-permission-special">
            <label v-for="permission in specialPermissions" :key="permission.bit">
              <input
                type="checkbox"
                :checked="Boolean(mode & permission.bit)"
                @change="togglePermission(permission.bit, $event)" />
              <span>
                <strong>{{ permission.label }}</strong>
                <small>{{ permission.code }} · {{ permission.description }}</small>
              </span>
            </label>
          </div>
        </details>
      </fieldset>

      <p v-if="state.error" class="file-permission-error">{{ state.error }}</p>

      <footer class="file-permission-actions">
        <button
          type="button"
          class="ghost-button"
          :disabled="state.saving"
          @click="emit('close')">
          取消
        </button>
        <button
          type="submit"
          class="primary-button"
          :disabled="parsedMode === null || state.saving || !canEdit">
          {{ state.saving ? "保存中..." : "保存权限" }}
        </button>
      </footer>
    </form>
  </AppDialog>
</template>
