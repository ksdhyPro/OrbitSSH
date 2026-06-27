<script setup lang="ts">
import { computed } from "vue";
import arrowUpIcon from "../assets/icons/arrow-up.svg";
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
  upload: [sourceType: "file" | "directory"];
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
  {
    key: "upload-file",
    label: "上传文件",
    icon: arrowUpIcon,
  },
  {
    key: "upload-directory",
    label: "上传文件夹",
    icon: arrowUpIcon,
  },
]);

function selectMenuItem(item: ContextMenuItem): void {
  if (item.key === "new-file") {
    emit("create", "file");
  } else if (item.key === "new-directory") {
    emit("create", "directory");
  } else if (item.key === "upload-file") {
    emit("upload", "file");
  } else if (item.key === "upload-directory") {
    emit("upload", "directory");
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
