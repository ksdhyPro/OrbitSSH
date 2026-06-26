<script setup lang="ts">
import { computed } from "vue";
import arrowDownIcon from "../assets/icons/arrow-down.svg";
import arrowUpIcon from "../assets/icons/arrow-up.svg";
import editIcon from "../assets/icons/edit.svg";
import fileIcon from "../assets/icons/file.svg";
import folderIcon from "../assets/icons/folder.svg";
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
  canUploadRemoteNode: (node: RemoteFileNode | null) => boolean;
  canDeleteRemoteNode: (node: RemoteFileNode | null) => boolean;
}>();

const emit = defineEmits<{
  preview: [];
  edit: [];
  download: [];
  upload: [sourceType: "file" | "directory"];
  create: [type: "file" | "directory"];
  rename: [];
  delete: [];
  close: [];
}>();

const menuItems = computed<ContextMenuItem[]>(() => {
  const node = props.menu.node;
  const count = props.menu.selectedCount;

  // 右键目标属于多选选区时，菜单执行批量操作；右键未选中项时不影响既有选区。
  if (props.menu.contextNodeSelected && count > 1) {
    return [
      {
        key: "delete",
        label: `删除 ${count} 项`,
        icon: trashIcon,
        danger: true,
      },
    ];
  }

  const createItems: ContextMenuItem[] =
    count === 0
      ? [
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
        ]
      : [];

  const uploadFileItem = {
    key: "upload-file",
    label: "上传文件",
    icon: arrowUpIcon,
    disabled: !props.canUploadRemoteNode(node),
  };
  const uploadDirectoryItem = {
    key: "upload-directory",
    label: "上传文件夹",
    icon: arrowUpIcon,
    disabled: !props.canUploadRemoteNode(node),
  };

  if (node?.type === "directory") {
    return [
      ...createItems,
      uploadFileItem,
      uploadDirectoryItem,
      {
        key: "rename",
        label: "重命名",
        icon: editIcon,
        disabled: !props.canDeleteRemoteNode(node),
      },
      {
        key: "delete",
        label: "删除",
        icon: trashIcon,
        disabled: !props.canDeleteRemoteNode(node),
        danger: true,
      },
    ];
  }

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
    ...createItems,
    primaryItem,
    {
      key: "download",
      label: "下载",
      icon: arrowDownIcon,
      disabled: !props.canDownloadRemoteFile(node),
    },
    {
      key: "rename",
      label: "重命名",
      icon: editIcon,
      disabled: !props.canDeleteRemoteNode(node),
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
  } else if (item.key === "upload-file") {
    emit("upload", "file");
  } else if (item.key === "upload-directory") {
    emit("upload", "directory");
  } else if (item.key === "new-file") {
    emit("create", "file");
  } else if (item.key === "new-directory") {
    emit("create", "directory");
  } else if (item.key === "rename") {
    emit("rename");
  } else if (item.key === "delete") {
    emit("delete");
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
