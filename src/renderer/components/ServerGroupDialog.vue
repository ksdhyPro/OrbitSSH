<script setup lang="ts">
import AppDialog from "./AppDialog.vue";

defineProps<{ open: boolean; name: string; editing: boolean }>();
const emit = defineEmits<{ close: []; submit: []; updateName: [name: string] }>();
</script>

<template>
  <AppDialog v-if="open" :title="editing ? '编辑分组' : '新增分组'" description="为服务器连接创建一个独立分组。" width="small" @close="emit('close')">
    <form class="server-group-dialog-form" @submit.prevent="emit('submit')">
      <label>
        <span>分组名称</span>
        <input :value="name" type="text" maxlength="100" autofocus placeholder="例如：生产环境" @input="emit('updateName', ($event.target as HTMLInputElement).value)" />
      </label>
      <footer class="dialog-actions"><button type="button" class="ghost-button" @click="emit('close')">取消</button><button type="submit" class="primary-button">{{ editing ? '保存' : '创建' }}</button></footer>
    </form>
  </AppDialog>
</template>
