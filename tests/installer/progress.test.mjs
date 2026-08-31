import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const installerScriptUrl = new URL('../../packaging/windows/scripts/orbitssh-installer.nsi', import.meta.url);
const buildScriptUrl = new URL('../../scripts/build-windows-installer.cjs', import.meta.url);
const skinPluginUrl = new URL('../../packaging/windows/runtime/nsis/Plugins/OrbitSSHSkin.dll', import.meta.url);

test('交互安装使用后台解压并按真实解压量更新进度', async () => {
  const source = await readFile(installerScriptUrl, 'utf8');

  assert.match(source, /BgWorker::CallAndWait/, '应用文件需要在后台线程解压，避免阻塞安装器重绘');
  assert.match(source, /nsis7zU::ExtractWithCallback/, '应用压缩包需要提供真实解压进度回调');
  assert.match(source, /Function ExtractCallback[\s\S]*?"slrProgress" "value" "\$0"[\s\S]*?FunctionEnd/, '解压回调需要更新可见进度条');
  assert.doesNotMatch(source, /File \/r "\$\{APP_SOURCE_DIR\}\\\*"/, '不应继续在 UI 回调中同步写入全部应用文件');
});

test('正式构建使用 Windows 目录通配符收集全部应用文件', async () => {
  const source = await readFile(buildScriptUrl, 'utf8');

  assert.match(
    source,
    /appArchive,\s*["']\.\\\\\*["']/,
    '7z 输入必须在 JavaScript 字符串中保留反斜杠，避免 .\\* 被解释成只匹配隐藏项的 .*'
  );
  assert.match(source, /function verifyApplicationArchive\(\)/, '构建后必须校验应用压缩包');
  assert.match(source, /Path = \$\{packageJson\.build\.productName\}\.exe/, '压缩包必须包含主程序');
});

test('正式安装包使用高压缩率控制发布体积', async () => {
  const source = await readFile(buildScriptUrl, 'utf8');

  assert.match(
    source,
    /["']-t7z["']\s*,\s*["']-mx=9["']\s*,\s*["']-mmt=on["']\s*,\s*appArchive/,
    '应用归档必须使用 7z 极限压缩，确保安装包保持在 100 MB 以内'
  );
  assert.match(
    source,
    /["']-tzip["']\s*,\s*["']-mx=9["']\s*,\s*skinArchive/,
    '皮肤归档也应使用最高压缩级别'
  );
});

test('安装器皮肤插件统一使用 OrbitSSH 命名空间', async () => {
  const [installerSource, buildSource] = await Promise.all([
    readFile(installerScriptUrl, 'utf8'),
    readFile(buildScriptUrl, 'utf8')
  ]);
  const legacyPluginName = String.fromCharCode(110, 115, 78, 105, 117, 110, 105, 117, 83, 107, 105, 110);

  await access(skinPluginUrl);
  assert.match(installerSource, /OrbitSSHSkin::EnableDpi/, '安装脚本必须调用重命名后的插件');
  assert.equal(installerSource.includes(legacyPluginName), false, '安装脚本不应保留旧插件名称');
  assert.equal(buildSource.includes(legacyPluginName), false, '构建脚本不应保留旧插件名称');
});
