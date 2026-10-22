const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('../../scripts/publish-gitee-release.cjs');

test('仅将发布令牌放入请求头并拒绝接口重定向', async () => {
  const request = createClient('test-secret', async (url, options) => {
    assert.equal(url, 'https://gitee.com/api/v5/repos/ksdhy/orbit-ssh/releases');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ id: 123 }), { status: 200 });
  });
  assert.deepEqual(await request('/releases'), { id: 123 });
});

test('首次发布允许发行版不存在，但权限错误必须终止', async () => {
  const missing = createClient('test-secret', async () => new Response(null, { status: 404 }));
  assert.equal(await missing('/releases/tags/ci-test', { missingOK: true }), null);
  const forbidden = createClient('test-secret', async () => new Response('test-secret', { status: 403 }));
  await assert.rejects(forbidden('/releases', { missingOK: true }), error => {
    assert.match(error.message, /HTTP 403/);
    assert.doesNotMatch(error.message, /test-secret/);
    return true;
  });
});

test('上传超限和服务异常不能被当作发布成功', async () => {
  for (const status of [413, 429, 500]) {
    const request = createClient('test-secret', async () => new Response(null, { status }));
    await assert.rejects(request('/releases/123/attach_files', { method: 'POST', body: new FormData() }),
      new RegExp(`HTTP ${status}`));
  }
});

test('服务端非 JSON 响应不能被当作发布成功', async () => {
  const request = createClient('test-secret', async () => new Response('<html>error</html>', { status: 200 }));
  await assert.rejects(request('/releases'), SyntaxError);
});
