<script setup lang="ts">
import closeIcon from "../assets/icons/close.svg";

withDefaults(
  defineProps<{
    title: string;
    description?: string;
    width?: "small" | "medium" | "config" | "large" | "editor";
  }>(),
  {
    description: "",
    width: "medium",
  },
);

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade" appear>
      <div class="app-dialog-backdrop">
        <section
          :class="['app-dialog', `app-dialog-${width}`]"
          role="dialog"
          aria-modal="true"
          :aria-label="title">
          <header class="app-dialog-header">
            <div>
              <h2>{{ title }}</h2>
              <p v-if="description">{{ description }}</p>
            </div>
            <button
              type="button"
              class="icon-button"
              aria-label="关闭弹窗"
              @click="emit('close')">
              <img :src="closeIcon" alt="" />
            </button>
          </header>

          <slot />
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
