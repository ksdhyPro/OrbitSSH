<script setup lang="ts">
import AppDialog from "./AppDialog.vue";

defineProps<{
  open: boolean;
  version: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const projectUrl = "https://gitee.com/ksdhy/orbit-ssh";
</script>

<template>
  <AppDialog
    v-if="open"
    title="关于 OrbitSSH"
    description="SSH / SFTP 客户端"
    width="medium"
    @close="emit('close')">
    <div class="about-dialog-content">
      <div class="settings-field">
        <div>
          <h3>版本</h3>
          <p>{{ version || "—" }}</p>
        </div>
      </div>
      <div class="settings-field">
        <div>
          <h3>项目地址</h3>
          <p>
            <a
              class="about-link"
              :href="projectUrl"
              target="_blank"
              rel="noreferrer">
              {{ projectUrl }}
            </a>
          </p>
        </div>
      </div>
    </div>
  </AppDialog>
</template>
