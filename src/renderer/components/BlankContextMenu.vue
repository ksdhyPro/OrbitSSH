<script setup lang="ts">
import { computed } from "vue";
import fileAddIcon from "../assets/icons/file-add.svg";
import fileUploadIcon from "../assets/icons/file-upload.svg";
import folderAddIcon from "../assets/icons/folder-add.svg";
import folderUploadIcon from "../assets/icons/folder-upload.svg";
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
    icon: fileAddIcon,
    group: "create",
  },
  {
    key: "new-directory",
    label: "新建文件夹",
    icon: folderAddIcon,
    group: "create",
  },
  {
    key: "upload-file",
    label: "上传文件",
    icon: fileUploadIcon,
    group: "upload",
  },
  {
    key: "upload-directory",
    label: "上传文件夹",
    icon: folderUploadIcon,
    group: "upload",
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
