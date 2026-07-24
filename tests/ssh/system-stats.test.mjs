import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSystemDiskStats,
  parsePosixDfSystemDiskStats,
  parseTaggedSystemDiskStats,
  summarizeSystemDisks,
} from "../../dist-electron/shared/system-stats.js";

test("POSIX 磁盘统计枚举所有挂载盘并排除伪文件系统和重复挂载", () => {
  const disks = parsePosixDfSystemDiskStats(`Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/mapper/centos-root 31247500 10485760 20761740 34% /
/dev/vda1 204800 51200 153600 25% /boot
/dev/vdb 104857600 4194304 100663296 4% /data
/dev/vdb 104857600 4194304 100663296 4% /mnt/data-bind
tmpfs 16384000 0 16384000 0% /dev/shm`);

  assert.deepEqual(
    disks.map(disk => [disk.name, disk.mountPoint]),
    [
      ["/dev/mapper/centos-root", "/"],
      ["/dev/vda1", "/boot"],
      ["/dev/vdb", "/data"],
    ],
  );
  assert.deepEqual(summarizeSystemDisks(disks), {
    diskFree: (20761740 + 153600 + 100663296) * 1024,
    diskTotal: (31247500 + 204800 + 104857600) * 1024,
  });
});

test("远端统计标签行可解析为独立磁盘容量", () => {
  const disks = parseTaggedSystemDiskStats(
    `{"cpu":10}\n__ORBITSSH_DISK__\t/dev/vda2\t/\t21474836480\t32212254720\n__ORBITSSH_DISK__\t/dev/vdb\t/data\t96636764160\t107374182400`,
  );

  assert.equal(disks.length, 2);
  assert.equal(disks[1].mountPoint, "/data");
  assert.equal(disks[1].total, 107374182400);
});

test("Windows 磁盘 JSON 会限制空闲容量并忽略无容量盘符", () => {
  const disks = normalizeSystemDiskStats([
    { name: "C", mount_point: "C:\\", free: 60, total: 100 },
    { name: "D", mount_point: "D:\\", free: 120, total: 100 },
    { name: "Z", mount_point: "Z:\\", free: 0, total: 0 },
  ]);

  assert.deepEqual(disks, [
    { name: "C", mountPoint: "C:\\", free: 60, total: 100 },
    { name: "D", mountPoint: "D:\\", free: 100, total: 100 },
  ]);
});
