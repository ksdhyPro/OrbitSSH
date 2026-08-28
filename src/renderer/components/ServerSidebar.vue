<script setup lang="ts">
import editIcon from "../assets/icons/edit.svg";
import pinIcon from "../assets/icons/pin.svg";
import plusIcon from "../assets/icons/plus.svg";
import trashIcon from "../assets/icons/trash.svg";
import chevronRightIcon from "../assets/icons/chevron-right.svg";
import type { ServerConfig } from "../../shared/server";

defineProps<{
  servers: ServerConfig[];
  runtimeError: string;
  isServerListLoading: boolean;
  listError: string;
  hasServers: boolean;
  activeServerId: string;
  collapsed: boolean;
}>();

const emit = defineEmits<{
  openConnectionDialog: [];
  openServerTerminal: [server: ServerConfig];
  editServer: [server: ServerConfig];
  setServerPinned: [server: ServerConfig];
  deleteServer: [serverId: string];
  toggleCollapsed: [];
}>();
</script>

<template>
  <section :class="['panel', 'server-panel', { collapsed }]">
    <div class="panel-header" draggable="true">
      <button
        type="button"
        class="panel-toggle"
        :aria-expanded="!collapsed"
        aria-controls="server-panel-content"
        @click="emit('toggleCollapsed')">
        <img :class="{ expanded: !collapsed }" :src="chevronRightIcon" alt="" />
        <h2>服务器</h2>
      </button>
      <button
        v-if="!collapsed"
        type="button"
        class="icon-button"
        aria-label="新增连接"
        @click.stop="emit('openConnectionDialog')">
        <img :src="plusIcon" alt="" />
      </button>
    </div>

    <Transition name="panel-slide">
    <div v-show="!collapsed" id="server-panel-content" class="server-list">
      <div v-if="runtimeError" class="server-empty error">
        {{ runtimeError }}
      </div>
      <div v-else-if="isServerListLoading" class="server-empty">
        正在加载服务器...
      </div>
      <div v-else-if="listError" class="server-empty error">
        {{ listError }}
      </div>
      <div v-else-if="!hasServers" class="server-empty">
        暂无服务器，点击右上角新增连接
      </div>

      <article
        v-for="server in servers"
        :key="server.id"
        :class="['server-item', { active: server.id === activeServerId }]"
        role="button"
        tabindex="0"
        :aria-current="server.id === activeServerId ? 'page' : undefined"
        @click="emit('openServerTerminal', server)"
        @keydown.enter.prevent="emit('openServerTerminal', server)">
        <div class="server-meta">
          <div class="server-title">
            <span
              v-if="server.isPinned"
              class="server-pinned-badge"
              title="已置顶">
              <img :src="pinIcon" alt="" />
            </span>
            <strong>{{ server.name }}</strong>
          </div>
          <span>{{ server.username }}@{{ server.host }}:{{ server.port }}</span>
        </div>
        <div class="server-side">
          <div class="server-actions" aria-label="服务器操作">
            <button
              type="button"
              class="server-action"
              :class="{ active: server.isPinned }"
              :aria-label="server.isPinned ? '取消置顶服务器' : '置顶服务器'"
              :title="server.isPinned ? '取消置顶' : '置顶'"
              @click.stop="emit('setServerPinned', server)">
              <img :src="pinIcon" alt="" />
            </button>
            <button
              type="button"
              class="server-action"
              aria-label="编辑服务器"
              title="编辑"
              @click.stop="emit('editServer', server)">
              <img :src="editIcon" alt="" />
            </button>
            <button
              type="button"
              class="server-action danger"
              aria-label="删除服务器"
              title="删除"
              @click.stop="emit('deleteServer', server.id)">
              <img :src="trashIcon" alt="" />
            </button>
          </div>
        </div>
      </article>
    </div>
    </Transition>
  </section>
</template>
