<script setup lang="ts">
import { computed } from "vue";
import fileIcon from "../assets/icons/file.svg";
import folderIcon from "../assets/icons/folder.svg";
import type { ContextMenuItem } from "../types/context-menu";
import type { BlankContextMenuState } from "../types/sftp";
import ContextMenu from "./ContextMenu.vue";

defineProps<{
  menu: BlankContextMenuState;
}>();

const emit = defineEmits<{
  create: [type: "file" | "directory"];
  close: [];
}>();

const menuItems = computed<ContextMenuItem[]>(() => [
  {
    key: "new-file",
    label: "新建文件",
    icon: fileIcon,
  },
  {
    key: "new-directory",
    label: "新建文件夹",
    icon: folderIcon,
  },
]);

function selectMenuItem(item: ContextMenuItem): void {
  if (item.key === "new-file") {
    emit("create", "file");
  } else if (item.key === "new-directory") {
    emit("create", "directory");
  }
}
</script>

<template>
  <ContextMenu
    :menu="menu"
    :items="menuItems"
    @select="selectMenuItem"
    @close="emit('close')" />
</template>
