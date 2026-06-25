<script setup lang="ts">
import { computed } from "vue";
import arrowDownIcon from "../assets/icons/arrow-down.svg";
import editIcon from "../assets/icons/edit.svg";
import fileIcon from "../assets/icons/file.svg";
import trashIcon from "../assets/icons/trash.svg";
import type { RemoteFileNode } from "../../shared/sftp";
import type { ContextMenuItem } from "../types/context-menu";
import type { FileContextMenuState } from "../types/sftp";
import ContextMenu from "./ContextMenu.vue";

const props = defineProps<{
  menu: FileContextMenuState;
  isPreviewImageFile: (node: RemoteFileNode | null) => boolean;
  isEditableTextFile: (node: RemoteFileNode | null) => boolean;
  getFileEditMenuLabel: (node: RemoteFileNode | null) => string;
  canDownloadRemoteFile: (node: RemoteFileNode | null) => boolean;
  canDeleteRemoteNode: (node: RemoteFileNode | null) => boolean;
}>();

const emit = defineEmits<{
  preview: [];
  edit: [];
  download: [];
  delete: [];
}>();

const menuItems = computed<ContextMenuItem[]>(() => {
  const node = props.menu.node;
  const primaryItem = props.isPreviewImageFile(node)
    ? {
        key: "preview",
        label: "预览",
        icon: fileIcon,
      }
    : {
        key: "edit",
        label: props.getFileEditMenuLabel(node),
        icon: editIcon,
        disabled: !props.isEditableTextFile(node),
      };

  return [
    primaryItem,
    {
      key: "download",
      label: "下载",
      icon: arrowDownIcon,
      disabled: !props.canDownloadRemoteFile(node),
    },
    {
      key: "delete",
      label: "删除",
      icon: trashIcon,
      disabled: !props.canDeleteRemoteNode(node),
      danger: true,
    },
  ];
});

// 文件菜单保留原有事件语义，内部只把通用菜单项映射回文件操作。
function selectMenuItem(item: ContextMenuItem): void {
  if (item.key === "preview") {
    emit("preview");
  } else if (item.key === "edit") {
    emit("edit");
  } else if (item.key === "download") {
    emit("download");
  } else if (item.key === "delete") {
    emit("delete");
  }
}
</script>

<template>
  <ContextMenu :menu="menu" :items="menuItems" @select="selectMenuItem" />
</template>
