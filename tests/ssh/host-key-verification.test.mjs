import assert from "node:assert/strict";
import test from "node:test";

import {
  HOST_KEY_REJECTED_MESSAGE,
  createHostKeyVerification,
  describeHostKeyError,
  getHostKeyId,
  parseHostKey,
  probeHostKeyWithSsh2,
} from "../../dist-electron/main/ssh/host-key-verification.js";

// 测试专用公钥，指纹来自 ssh-keygen -lf 的实际输出。
const ED25519_KEY = Buffer.from(
  "AAAAC3NzaC1lZDI1NTE5AAAAICAs8oV013kvIZacwZactSRzXBl175xA3cbAk7/WV7tA",
  "base64",
);
const ED25519_FINGERPRINT = "SHA256:NX3cl1iyu3EIR2jdFiIKVOcE3QNwRQw2wwKp0GOgpe0";
const ECDSA_KEY = Buffer.from(
  "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBE4xCYXXswWGcGGNibJkFis61n1P/POXd/2G6KzFA85rhdpskbA0sKcDhFs8+2GfOcCq9V/suWRU5RAPuuuhlis=",
  "base64",
);
const ECDSA_FINGERPRINT = "SHA256:tt8c0+6p2BVU7KHYcCn0JlXj5aySS+/S+QzrfEmsqds";

const target = { host: "Prod.Example.com", port: 22, serverName: "生产服务器" };

function createHarness(decide = async () => true) {
  const records = new Map();
  const prompts = [];
  const verification = createHostKeyVerification({
    repository: {
      get: hostId => records.get(hostId),
      set: (hostId, record) => records.set(hostId, record),
    },
    requestDecision: async prompt => {
      prompts.push(prompt);
      return decide(prompt);
    },
    now: () => 1_700_000_000_000,
  });
  return { records, prompts, verifier: verification.createVerifier(target) };
}

function verifyKey(verifier, key) {
  return new Promise(resolve => verifier(key, resolve));
}

test("主机标识与 OpenSSH known_hosts 一致且不区分大小写", () => {
  assert.equal(getHostKeyId("Prod.Example.com", 22), "prod.example.com");
  assert.equal(getHostKeyId(" 10.0.0.8 ", 2222), "[10.0.0.8]:2222");
});

test("解析主机密钥类型并生成与 ssh-keygen 相同的 SHA256 指纹", () => {
  assert.deepEqual(parseHostKey(ED25519_KEY), {
    keyType: "ssh-ed25519",
    fingerprint: ED25519_FINGERPRINT,
    publicKey: ED25519_KEY.toString("base64"),
  });
  assert.equal(parseHostKey(ECDSA_KEY).keyType, "ecdsa-sha2-nistp256");
  assert.equal(parseHostKey(ECDSA_KEY).fingerprint, ECDSA_FINGERPRINT);
});

test("首次连接需要用户确认，信任后记录密钥并继续握手", async () => {
  const { records, prompts, verifier } = createHarness(async () => true);

  assert.equal(await verifyKey(verifier, ED25519_KEY), true);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].kind, "unknown");
  assert.equal(prompts[0].fingerprint, ED25519_FINGERPRINT);
  assert.equal(prompts[0].serverName, "生产服务器");
  assert.deepEqual(records.get("prod.example.com"), {
    keyType: "ssh-ed25519",
    fingerprint: ED25519_FINGERPRINT,
    publicKey: ED25519_KEY.toString("base64"),
    trustedAt: 1_700_000_000_000,
  });

  // 已信任且一致时直接放行，不再打扰用户。
  assert.equal(await verifyKey(verifier, ED25519_KEY), true);
  assert.equal(prompts.length, 1);
});

test("用户拒绝首次连接时中止握手且不记录密钥", async () => {
  const { records, verifier } = createHarness(async () => false);

  assert.equal(await verifyKey(verifier, ED25519_KEY), false);
  assert.equal(records.size, 0);
});

test("密钥变化时提示前后指纹，默认拒绝且保留原记录", async () => {
  const { records, prompts, verifier } = createHarness(async prompt => prompt.kind === "unknown");
  await verifyKey(verifier, ED25519_KEY);

  assert.equal(await verifyKey(verifier, ECDSA_KEY), false);
  assert.equal(prompts[1].kind, "changed");
  assert.equal(prompts[1].previousKeyType, "ssh-ed25519");
  assert.equal(prompts[1].previousFingerprint, ED25519_FINGERPRINT);
  assert.equal(prompts[1].fingerprint, ECDSA_FINGERPRINT);
  assert.equal(records.get("prod.example.com").fingerprint, ED25519_FINGERPRINT);
});

test("用户明确信任变化后的密钥时更新记录", async () => {
  const { records, verifier } = createHarness(async () => true);
  await verifyKey(verifier, ED25519_KEY);

  assert.equal(await verifyKey(verifier, ECDSA_KEY), true);
  assert.equal(records.get("prod.example.com").fingerprint, ECDSA_FINGERPRINT);
});

test("同一主机同一密钥的并发连接只弹出一次确认", async () => {
  let release;
  const { prompts, verifier } = createHarness(
    () =>
      new Promise(resolve => {
        release = resolve;
      }),
  );

  const first = verifyKey(verifier, ED25519_KEY);
  const second = verifyKey(verifier, ED25519_KEY);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prompts.length, 1);

  release(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});

test("确认流程异常时按拒绝处理", async () => {
  const { verifier } = createHarness(async () => {
    throw new Error("窗口不可用");
  });

  assert.equal(await verifyKey(verifier, ED25519_KEY), false);
});

test("首次连接先探测并确认密钥，已信任的主机不再探测", async () => {
  const records = new Map();
  const probes = [];
  const prompts = [];
  const verification = createHostKeyVerification({
    repository: { get: id => records.get(id), set: (id, record) => records.set(id, record) },
    requestDecision: async prompt => {
      prompts.push(prompt);
      return true;
    },
    probeHostKey: async probeTarget => {
      probes.push(probeTarget);
      return ED25519_KEY;
    },
  });

  await Promise.all([verification.ensureTrusted(target), verification.ensureTrusted(target)]);
  assert.equal(probes.length, 1);
  assert.equal(prompts.length, 1);
  assert.equal(records.get("prod.example.com").fingerprint, ED25519_FINGERPRINT);

  await verification.ensureTrusted(target);
  assert.equal(probes.length, 1);
});

test("首次连接被用户拒绝时预检抛出错误，探测失败时交给正式连接报告", async () => {
  const rejected = createHostKeyVerification({
    repository: { get: () => undefined, set: () => undefined },
    requestDecision: async () => false,
    probeHostKey: async () => ED25519_KEY,
  });
  await assert.rejects(() => rejected.ensureTrusted(target), {
    message: HOST_KEY_REJECTED_MESSAGE,
  });

  const unreachable = createHostKeyVerification({
    repository: { get: () => undefined, set: () => undefined },
    requestDecision: async () => assert.fail("探测失败时不应弹出确认"),
    probeHostKey: async () => null,
  });
  await unreachable.ensureTrusted(target);
});

test("ssh2 的主机校验失败错误转换为中文提示", () => {
  assert.equal(
    describeHostKeyError(new Error("Host denied (verification failed)")),
    HOST_KEY_REJECTED_MESSAGE,
  );
  assert.equal(
    describeHostKeyError(new Error("connect: Host denied (verification failed)")),
    HOST_KEY_REJECTED_MESSAGE,
  );
  assert.equal(
    describeHostKeyError(new Error("All configured authentication methods failed")),
    null,
  );
});

test("真实 ssh2 握手中异步确认通过才继续认证，拒绝则中止连接", async () => {
  const { Client, Server, utils } = (await import("ssh2")).default;
  const hostKey = utils.generateKeyPairSync("ed25519");
  const expectedFingerprint = parseHostKey(
    Buffer.from(hostKey.public.split(" ")[1], "base64"),
  ).fingerprint;
  let authenticated = 0;
  const server = new Server({ hostKeys: [hostKey.private] }, client => {
    client.on("authentication", context => {
      authenticated += 1;
      context.accept();
    });
    client.on("error", () => undefined);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const connect = decide => {
    const records = new Map();
    const prompts = [];
    const verifier = createHostKeyVerification({
      repository: { get: id => records.get(id), set: (id, record) => records.set(id, record) },
      requestDecision: async prompt => {
        prompts.push(prompt);
        // 模拟用户阅读指纹后再点击，验证握手会等待异步确认。
        await new Promise(resolve => setTimeout(resolve, 200));
        return decide;
      },
    }).createVerifier({ host: "127.0.0.1", port, serverName: "本地测试" });

    return new Promise(resolve => {
      const client = new Client();
      client
        .once("ready", () => {
          client.end();
          resolve({ ok: true, prompts });
        })
        .once("error", error => resolve({ ok: false, error, prompts }))
        .connect({
          host: "127.0.0.1",
          port,
          username: "test",
          password: "test",
          hostVerifier: verifier,
          readyTimeout: 5000,
        });
    });
  };

  try {
    const probed = await probeHostKeyWithSsh2({
      host: "127.0.0.1",
      port,
      serverName: "本地测试",
      username: "test",
    });
    assert.equal(parseHostKey(probed).fingerprint, expectedFingerprint);
    // 探测在认证前中止，不会发送任何凭据。
    assert.equal(authenticated, 0);

    const trusted = await connect(true);
    assert.equal(trusted.ok, true);
    assert.equal(trusted.prompts[0].fingerprint, expectedFingerprint);
    assert.equal(trusted.prompts[0].keyType, "ssh-ed25519");
    assert.equal(authenticated, 1);

    const rejected = await connect(false);
    assert.equal(rejected.ok, false);
    assert.equal(describeHostKeyError(rejected.error), HOST_KEY_REJECTED_MESSAGE);
    // 拒绝发生在认证之前，密码不会发送给未受信任的主机。
    assert.equal(authenticated, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("所有 SSH/SFTP 连接都经由带主机密钥校验的统一连接参数", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const root = new URL("../../src/main/", import.meta.url);
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith(".ts"));
  const authOptions = await readFile(new URL("ssh/auth-options.ts", root), "utf8");
  assert.match(authOptions, /await ensureServerHostKeyTrusted\(server\)/);
  assert.match(authOptions, /hostVerifier: createServerHostVerifier\(server\)/);

  let checkedConnections = 0;
  for (const file of files) {
    // 探测连接只取主机公钥并在认证前中止，使用自己的校验函数。
    if (file.endsWith("host-key-verification.ts")) continue;
    const source = await readFile(new URL(file, root), "utf8");
    // 连接参数是异步的，直接展开 Promise 能通过类型检查却会丢失全部参数。
    assert.doesNotMatch(
      source,
      /\.\.\.createServerConnectOptions\(/,
      `${file} 必须先 await 连接参数`,
    );
    for (const match of source.matchAll(/\.connect\(/g)) {
      const receiver = source.slice(Math.max(0, match.index - 40), match.index);
      // 只检查 ssh2 / ssh2-sftp-client 客户端，net.connect 等普通 TCP 连接不在此列。
      if (!/client\s*$/i.test(receiver)) continue;
      checkedConnections += 1;
      const args = source.slice(match.index, match.index + 120);
      assert.match(
        args,
        /\(await createServerConnectOptions\(server\)\)|connectOptions/,
        `${file} 的 SSH 连接必须使用 createServerConnectOptions 生成的参数`,
      );
    }
  }
  // 终端、SFTP 会话、连接池、上传、下载、中转、端口转发、自动化任务。
  assert.ok(checkedConnections >= 8, `应覆盖全部 SSH/SFTP 连接入口，实际 ${checkedConnections} 处`);

  // createSshClient 使用链式调用，单独确认其连接参数（AI 跨服务器命令与 MCP 经由这里）。
  const transferCommon = await readFile(new URL("sftp/sftp-transfer-common.ts", root), "utf8");
  const sshClientFactory =
    transferCommon.match(/export async function createSshClient[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(
    sshClientFactory,
    /const connectOptions = await createServerConnectOptions\(server\)/,
  );
  assert.match(sshClientFactory, /\.\.\.connectOptions/);
});
