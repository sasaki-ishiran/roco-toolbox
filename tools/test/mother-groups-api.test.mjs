/**
 * 多人母本共享：真实本地 Functions + D1 的 API 集成测试。
 *
 * 由 `tools/test/run-mother-groups-local.mjs` 启动服务后调用，**不接受外部数据库**。
 * 只使用 loopback 地址；令牌与恢复码只留在内存，不写日志。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const BASE = (process.env.ROCO_MOTHER_API_BASE ?? '').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(BASE)) {
  throw new Error(
    `拒绝在非 loopback 地址上运行集成测试：${BASE || '（未设置 ROCO_MOTHER_API_BASE）'}`,
  );
}

async function call(token, method, pathName, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${pathName}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, headers: response.headers, body: parsed };
}

async function register(label) {
  const result = await call(null, 'POST', '/api/auth/register', { label });
  assert.equal(result.status, 200, `注册失败：${JSON.stringify(result.body)}`);
  return { token: result.body.token, accountId: result.body.accountId, recoveryCode: result.body.recoveryCode };
}

test('本地 Functions 可访问', async () => {
  const health = await call(null, 'GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
});

test('新身份可注册并读回（本地 D1 已接上）', async () => {
  const identity = await register('d1-smoke');
  const me = await call(identity.token, 'GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.accountId, identity.accountId);
  assert.equal(me.body.snapshot, null);
});
