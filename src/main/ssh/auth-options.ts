import type { ConnectConfig } from "ssh2";

import type { ServerAuthConfig } from "../../shared/server.js";
import { createServerHostVerifier, ensureServerHostKeyTrusted } from "./host-key-service.js";

type ServerConnectOptions = Pick<
  ConnectConfig,
  "host" | "port" | "username" | "password" | "privateKey" | "passphrase" | "hostVerifier"
>;

// 根据服务器认证方式生成 ssh2 连接参数，避免终端和 SFTP 分别维护认证分支。
// 所有 SSH/SFTP 连接都经由这里：首次连接先确认主机密钥，之后每次握手都比对已信任的密钥，
// 未受信任的主机不会进入认证阶段。
export async function createServerConnectOptions(
  server: ServerAuthConfig,
): Promise<ServerConnectOptions> {
  await ensureServerHostKeyTrusted(server);

  const baseOptions = {
    host: server.host,
    port: server.port,
    username: server.username,
    hostVerifier: createServerHostVerifier(server),
  };

  if (server.authType === "privateKey") {
    return {
      ...baseOptions,
      privateKey: server.privateKey,
      passphrase: server.passphrase,
    };
  }

  return {
    ...baseOptions,
    password: server.password,
  };
}
