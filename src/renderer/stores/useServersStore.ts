import { computed, reactive, ref } from "vue";
import { defineStore } from "pinia";
import type { ServerAuthType, ServerConfig, ServerInput } from "../../shared/server";
import { useCoreStore } from "./useCoreStore";

// 服务器域 store：管理服务器列表、连接表单和增删改查，页面只负责确认弹窗与打开终端。
export const useServersStore = defineStore("servers", () => {
  const core = useCoreStore();

  const servers = ref<ServerConfig[]>([]);
  const isConnectionDialogOpen = ref(false);
  const formError = ref("");
  const listError = ref("");
  const editingServerId = ref<string | null>(null);
  const isServerListLoading = ref(false);
  const isSubmittingServer = ref(false);
  const runtimeError = ref("");
  const connectionForm = reactive({
    name: "",
    host: "",
    port: 22,
    username: "",
    authType: "password" as ServerAuthType,
    password: "",
    privateKeyPath: "",
    passphrase: "",
  });

  const hasServers = computed(() => servers.value.length > 0);

  // 统一排序，确保新建、加载和切换置顶后列表顺序一致。
  function sortServers(nextServers: ServerConfig[]): ServerConfig[] {
    return [...nextServers].sort(
      (left, right) => Number(Boolean(right.isPinned)) - Number(Boolean(left.isPinned)),
    );
  }

  function setListError(error: string): void {
    listError.value = error;
  }

  // 重置新增连接表单，避免再次打开弹窗时残留上一次输入。
  function resetConnectionForm(): void {
    connectionForm.name = "";
    connectionForm.host = "";
    connectionForm.port = 22;
    connectionForm.username = "";
    connectionForm.authType = "password";
    connectionForm.password = "";
    connectionForm.privateKeyPath = "";
    connectionForm.passphrase = "";
    formError.value = "";
    editingServerId.value = null;
  }

  function openConnectionDialog(): void {
    resetConnectionForm();
    isConnectionDialogOpen.value = true;
  }

  function closeConnectionDialog(): void {
    isConnectionDialogOpen.value = false;
    formError.value = "";
    editingServerId.value = null;
  }

  async function submitConnectionForm(): Promise<void> {
    if (
      !connectionForm.name.trim() ||
      !connectionForm.host.trim() ||
      !connectionForm.username.trim()
    ) {
      formError.value = "请填写名称、Host 和 Username";
      return;
    }

    if (
      connectionForm.authType === "password" &&
      !editingServerId.value &&
      !connectionForm.password
    ) {
      formError.value = "请填写 Password";
      return;
    }

    if (
      connectionForm.authType === "privateKey" &&
      !connectionForm.privateKeyPath.trim()
    ) {
      formError.value = "请填写密钥文件路径";
      return;
    }

    if (
      !Number.isInteger(connectionForm.port) ||
      connectionForm.port < 1 ||
      connectionForm.port > 65535
    ) {
      formError.value = "Port 需要在 1 到 65535 之间";
      return;
    }

    const nextServer: ServerInput = {
      name: connectionForm.name.trim(),
      host: connectionForm.host.trim(),
      port: connectionForm.port,
      username: connectionForm.username.trim(),
      authType: connectionForm.authType,
      password: connectionForm.password,
      privateKeyPath: connectionForm.privateKeyPath.trim(),
      passphrase: connectionForm.passphrase,
    };

    isSubmittingServer.value = true;
    formError.value = "";

    try {
      if (!core.orbitSSHApi) {
        throw new Error("请通过 Electron 窗口启动应用");
      }

      if (editingServerId.value) {
        const updatedServer = await core.orbitSSHApi.servers.update({
          id: editingServerId.value,
          ...nextServer,
        });
        servers.value = sortServers(servers.value.map(server =>
          server.id === updatedServer.id ? updatedServer : server,
        ));
      } else {
        const createdServer = await core.orbitSSHApi.servers.create(nextServer);
        servers.value = sortServers([createdServer, ...servers.value]);
      }

      closeConnectionDialog();
    } catch (error) {
      formError.value =
        error instanceof Error ? error.message : "保存服务器失败";
    } finally {
      isSubmittingServer.value = false;
    }
  }

  async function selectPrivateKeyFile(): Promise<void> {
    formError.value = "";

    try {
      if (!core.orbitSSHApi?.dialogs) {
        throw new Error("当前窗口的 Preload API 未加载文件选择能力，请重启应用后重试");
      }

      // 用户取消文件选择时返回 null，保留当前已填写的路径。
      const selectedPath = await core.orbitSSHApi.dialogs.selectPrivateKey();

      if (selectedPath) {
        connectionForm.privateKeyPath = selectedPath;
      }
    } catch (error) {
      formError.value =
        error instanceof Error ? error.message : "选择密钥文件失败";
    }
  }

  // 打开编辑弹窗并填充当前服务器信息，密码不从列表回填。
  function editServer(server: ServerConfig): void {
    editingServerId.value = server.id;
    connectionForm.name = server.name;
    connectionForm.host = server.host;
    connectionForm.port = server.port;
    connectionForm.username = server.username;
    connectionForm.authType = server.authType;
    connectionForm.password = "";
    connectionForm.privateKeyPath = server.privateKeyPath ?? "";
    connectionForm.passphrase = "";
    formError.value = "";
    isConnectionDialogOpen.value = true;
  }

  async function deleteServer(
    serverId: string,
    shouldDelete: () => boolean,
  ): Promise<void> {
    if (!shouldDelete()) {
      return;
    }

    try {
      if (!core.orbitSSHApi) {
        throw new Error("请通过 Electron 窗口启动应用");
      }

      await core.orbitSSHApi.servers.delete(serverId);
      servers.value = servers.value.filter(server => server.id !== serverId);
    } catch (error) {
      listError.value =
        error instanceof Error ? error.message : "删除服务器失败";
    }
  }

  async function setServerPinned(server: ServerConfig): Promise<void> {
    listError.value = "";

    try {
      if (!core.orbitSSHApi) {
        throw new Error("请通过 Electron 窗口启动应用");
      }

      const updatedServer = await core.orbitSSHApi.servers.setPinned({
        id: server.id,
        isPinned: !server.isPinned,
      });
      servers.value = sortServers(servers.value.map(item =>
        item.id === updatedServer.id ? updatedServer : item,
      ));
    } catch (error) {
      listError.value = error instanceof Error ? error.message : "更新服务器置顶状态失败";
    }
  }

  // 启动时从主进程读取服务器配置，Renderer 不直接接触本地文件。
  async function loadServers(): Promise<void> {
    isServerListLoading.value = true;
    listError.value = "";
    core.writeRendererLog("开始加载服务器列表");

    try {
      if (!core.orbitSSHApi) {
        runtimeError.value =
          "未检测到 Electron Preload API，请通过 Electron 窗口启动应用";
        servers.value = [];
        return;
      }

      servers.value = sortServers(await core.orbitSSHApi.servers.list());
      core.writeRendererLog("服务器列表加载完成", {
        serverCount: servers.value.length,
      });
    } catch (error) {
      listError.value =
        error instanceof Error ? error.message : "加载服务器列表失败";
    } finally {
      isServerListLoading.value = false;
    }
  }

  return {
    servers,
    isConnectionDialogOpen,
    formError,
    listError,
    editingServerId,
    isServerListLoading,
    isSubmittingServer,
    runtimeError,
    connectionForm,
    hasServers,
    setListError,
    resetConnectionForm,
    openConnectionDialog,
    closeConnectionDialog,
    submitConnectionForm,
    selectPrivateKeyFile,
    editServer,
    deleteServer,
    setServerPinned,
    loadServers,
  };
});
