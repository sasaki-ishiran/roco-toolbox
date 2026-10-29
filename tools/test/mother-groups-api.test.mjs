/**
 * 多人母本共享：真实本地 Functions + D1 的 API 集成测试。
 *
 * 由 `tools/test/run-mother-groups-local.mjs` 启动服务后调用，**不接受外部数据库**。
 * 只使用 loopback 地址；令牌与恢复码只留在内存，不写日志。
 *
 * 覆盖面：认证与权限、发布归属、CAS 冲突、旧源/同源冲突、UID 抢占回滚、
 * 撤回与停止共享、昵称/邀请码/退出/解散、注销级联、20 人边界、输入校验与限流。
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';

const BASE = (process.env.ROCO_MOTHER_API_BASE ?? '').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(BASE)) {
  throw new Error(
    `拒绝在非 loopback 地址上运行集成测试：${BASE || '（未设置 ROCO_MOTHER_API_BASE）'}`,
  );
}

const CRITERIA_ID = 'all-mothers-v3-perfect';
const TIME = '2026-10-23T00:00:00.000Z';
const LATER = '2026-10-24T00:00:00.000Z';
const READ_LIMIT_PER_HOUR = 1800;

let ipCounter = 0;
const uniqueIp = () => `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${++ipCounter & 255}`;

async function call(token, method, pathName, body, options = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.ip) headers['CF-Connecting-IP'] = options.ip;
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

async function register(label, ip = '127.0.0.1') {
  const result = await call(
    null,
    'POST',
    '/api/auth/register',
    { label },
    { ip },
  );
  assert.equal(result.status, 200, `注册失败：${JSON.stringify(result.body)}`);
  return {
    label,
    token: result.body.token,
    accountId: result.body.accountId,
    recoveryCode: result.body.recoveryCode,
  };
}

function accountOf(uid, ids, patch = {}) {
  return {
    accountKey: `uid:${uid}`,
    accountName: `账号${uid}`,
    sourceExportedAt: TIME,
    eggGameIds: [...new Set(ids)].sort((a, b) => a - b),
    ...patch,
  };
}

function draftOf(accounts, patch = {}) {
  return {
    schemaVersion: 1,
    criteriaId: CRITERIA_ID,
    catalogVersion: 'test-v1',
    accounts,
    ...patch,
  };
}

const memberOf = (detail, accountId) => {
  const member = detail.body.members.find((item) => item.accountId === accountId);
  assert.ok(member, `详情里缺少成员 ${accountId}`);
  return member;
};

let A;
let B;
let C;
let D;
let A2;

before(async () => {
  [A, B, C, D] = await Promise.all(['A', 'B', 'C', 'D'].map((label) => register(label)));
  const recovered = await call(null, 'POST', '/api/auth/recover', { recoveryCode: A.recoveryCode });
  assert.equal(recovered.status, 200);
  A2 = { ...A, token: recovered.body.token, label: 'A-第二设备' };
  assert.equal(recovered.body.accountId, A.accountId);
});

async function createGroup(owner = A, name = '测试组') {
  const result = await call(owner.token, 'POST', '/api/mother-groups', { name, displayName: '组长' });
  assert.equal(result.status, 200, `创建组失败：${JSON.stringify(result.body)}`);
  assert.equal(result.body.group.ownerAccountId, owner.accountId);
  assert.match(result.body.inviteCode, /^[0-9A-Z]{8}$/);
  return { id: result.body.group.id, inviteCode: result.body.inviteCode };
}

async function joinGroup(identity, inviteCode, displayName = identity.label) {
  return call(identity.token, 'POST', '/api/mother-groups/join', { inviteCode, displayName });
}

async function groupWithMembers(identities = [B]) {
  const group = await createGroup();
  for (const identity of identities) {
    const joined = await joinGroup(identity, group.inviteCode);
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
  }
  return group;
}

const publish = (token, groupId, baseRevision, resource) =>
  call(token, 'PUT', `/api/mother-groups/${groupId}/resources/me`, { baseRevision, resource });

const detailOf = (token, groupId) => call(token, 'GET', `/api/mother-groups/${groupId}`);

test('未登录访问任一接口都是 401，且不缓存', async () => {
  const list = await call(null, 'GET', '/api/mother-groups');
  assert.equal(list.status, 401);
  assert.equal(list.body.code, 'UNAUTHENTICATED');
  assert.equal(list.headers.get('cache-control'), 'no-store');

  const create = await call(null, 'POST', '/api/mother-groups', { name: '组', displayName: '人' });
  assert.equal(create.status, 401);
});

test('CORS 预检允许 DELETE，成功响应也不缓存', async () => {
  const preflight = await fetch(`${BASE}/api/mother-groups/abc`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://roco-toolbox.pages.dev',
      'Access-Control-Request-Method': 'DELETE',
    },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /DELETE/);

  const group = await createGroup();
  const detail = await detailOf(A.token, group.id);
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get('cache-control'), 'no-store');
});

test('昵称与组名按 Unicode 码点计数', async () => {
  const group = await createGroup();
  const allowed = await call(B.token, 'POST', '/api/mother-groups/join', {
    inviteCode: group.inviteCode,
    displayName: '🐣'.repeat(6),
  });
  assert.equal(allowed.status, 200);

  const tooLongName = await call(B.token, 'PUT', `/api/mother-groups/${group.id}/profile/me`, {
    displayName: '🐣'.repeat(7),
  });
  assert.equal(tooLongName.status, 400);

  const tooLongGroup = await call(A.token, 'POST', '/api/mother-groups', {
    name: '组'.repeat(41),
    displayName: '人',
  });
  assert.equal(tooLongGroup.status, 400);
});

test('创建组与组主成员原子完成，组列表只返回自己加入的组', async () => {
  const group = await createGroup();
  const mine = await call(A.token, 'GET', '/api/mother-groups');
  assert.equal(mine.status, 200);
  const summary = mine.body.groups.find((item) => item.id === group.id);
  assert.ok(summary);
  assert.equal(summary.memberCount, 1);
  assert.equal(summary.ownerAccountId, A.accountId);

  const others = await call(D.token, 'GET', '/api/mother-groups');
  assert.equal(others.body.groups.some((item) => item.id === group.id), false);

  // A 的第二个设备（同一身份）能发现同一个组，不需要重新输入邀请码
  const secondDevice = await call(A2.token, 'GET', '/api/mother-groups');
  assert.equal(secondDevice.body.groups.some((item) => item.id === group.id), true);

  const detail = await detailOf(A.token, group.id);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.group.name, '测试组');
  assert.equal(detail.body.members.length, 1);
  assert.equal(detail.body.members[0].resource, null);
  assert.equal(detail.body.group.inviteHash, undefined);
  assert.equal(detail.body.group.invite_hash, undefined);
});

test('只有组员可读；写入归属只取 token，不能伪造 accountId', async () => {
  const group = await groupWithMembers([B]);

  const outsiderRead = await detailOf(D.token, group.id);
  assert.equal(outsiderRead.status, 403);
  assert.equal(outsiderRead.body.code, 'NOT_MEMBER');
  assert.equal(outsiderRead.body.members, undefined, '403 不应泄露成员摘要');

  const outsiderWrite = await publish(
    D.token,
    group.id,
    0,
    draftOf([accountOf(2001, [101])]),
  );
  assert.equal(outsiderWrite.status, 403);

  // B 在正文里冒充 A：归属应仍是 B
  const write = await call(B.token, 'PUT', `/api/mother-groups/${group.id}/resources/me`, {
    accountId: A.accountId,
    baseRevision: 0,
    resource: draftOf([accountOf(2001, [101])]),
  });
  assert.equal(write.status, 200);

  const detail = await detailOf(A.token, group.id);
  assert.equal(memberOf(detail, A.accountId).resource, null);
  assert.deepEqual(memberOf(detail, B.accountId).resource.accounts[0].eggGameIds, [101]);
});

test('发布替换整份摘要：v0→v1、并发 CAS 只有一个成功、旧版本重试不覆盖', async () => {
  const group = await groupWithMembers([B]);
  const first = await publish(A.token, group.id, 0, draftOf([accountOf(1001, [101])]));
  assert.equal(first.status, 200);
  assert.equal(first.body.resourceRevision, 1);
  assert.equal(typeof first.body.publishedAt, 'number');

  const second = await publish(
    A.token,
    group.id,
    1,
    draftOf([accountOf(1001, [101, 201], { sourceExportedAt: LATER })]),
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.resourceRevision, 2);

  // 两个设备拿同一个 baseRevision 并发写同一份覆盖：只能有一个成功（CAS 冲突）
  const [left, right] = await Promise.all([
    publish(A.token, group.id, 2, draftOf([accountOf(1001, [101, 201], { sourceExportedAt: LATER })])),
    publish(A2.token, group.id, 2, draftOf([accountOf(1001, [101, 201], { sourceExportedAt: LATER })])),
  ]);
  const statuses = [left.status, right.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 409]);
  const conflict = left.status === 409 ? left : right;
  assert.equal(conflict.body.code, 'REVISION_CONFLICT');

  const detail = await detailOf(A.token, group.id);
  const resource = memberOf(detail, A.accountId).resource;
  assert.equal(resource.revision, 3);
  assert.deepEqual(resource.accounts[0].eggGameIds, [101, 201]);

  // 旧 baseRevision 再试一次（同样的覆盖，避免先触发同源校验）：仍然冲突，内容不变
  const retry = await publish(A.token, group.id, 1, draftOf([accountOf(1001, [101, 201], { sourceExportedAt: LATER })]));
  assert.equal(retry.status, 409);
  assert.equal(retry.body.code, 'REVISION_CONFLICT');
  const after = await detailOf(A.token, group.id);
  assert.deepEqual(memberOf(after, A.accountId).resource.accounts[0].eggGameIds, resource.accounts[0].eggGameIds);
});

test('同组同 UID 被他人占用时整次发布回滚，原摘要保留', async () => {
  const group = await groupWithMembers([B]);
  const mine = await publish(A.token, group.id, 0, draftOf([accountOf(1001, [101]), accountOf(1002, [201])]));
  assert.equal(mine.status, 200);

  const theirs = await publish(B.token, group.id, 0, draftOf([accountOf(3001, [301])]));
  assert.equal(theirs.status, 200);

  const clash = await publish(
    A.token,
    group.id,
    1,
    draftOf([accountOf(1001, [101]), accountOf(1002, [201]), accountOf(3001, [401])]),
  );
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, 'GAME_ACCOUNT_ALREADY_SHARED');
  assert.ok(clash.body.error.includes('B'), '说明已由哪位组员共享');

  const detail = await detailOf(A.token, group.id);
  const resource = memberOf(detail, A.accountId).resource;
  assert.equal(resource.revision, 1, '冲突的发布不能推进版本');
  assert.deepEqual(
    resource.accounts.map((item) => item.accountKey),
    ['uid:1001', 'uid:1002'],
    '冲突的发布不能删掉原有账号',
  );
});

test('撤回一个账号后覆盖消失；停止共享保留成员身份并递增版本', async () => {
  const group = await groupWithMembers([B]);
  const two = await publish(
    A.token,
    group.id,
    0,
    draftOf([accountOf(1001, [101]), accountOf(1002, [201])]),
  );
  assert.equal(two.status, 200);

  const one = await publish(A.token, group.id, 1, draftOf([accountOf(1001, [101])]));
  assert.equal(one.status, 200);
  let detail = await detailOf(A.token, group.id);
  assert.deepEqual(
    memberOf(detail, A.accountId).resource.accounts.map((item) => item.accountKey),
    ['uid:1001'],
  );

  const stopped = await publish(A.token, group.id, 2, draftOf([]));
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.resourceRevision, 3);
  assert.equal(stopped.body.publishedAt, null);
  detail = await detailOf(A.token, group.id);
  const member = memberOf(detail, A.accountId);
  assert.equal(member.resource, null);
  assert.equal(member.resourceRevision, 3);
});

test('一个账号 + 空蛋 ID = 已发布但目前无达标母本（不是未知）', async () => {
  const group = await groupWithMembers([B]);
  const published = await publish(A.token, group.id, 0, draftOf([accountOf(1001, [])]));
  assert.equal(published.status, 200);
  assert.equal(typeof published.body.publishedAt, 'number');

  const detail = await detailOf(A.token, group.id);
  const resource = memberOf(detail, A.accountId).resource;
  assert.ok(resource);
  assert.deepEqual(resource.accounts[0].eggGameIds, []);
});

test('旧源时间被拒绝；同时间同源不同覆盖报 SOURCE_MISMATCH；换图鉴重算允许', async () => {
  const group = await groupWithMembers([B]);
  const newer = await publish(
    A.token,
    group.id,
    0,
    draftOf([accountOf(1001, [101], { sourceExportedAt: LATER })]),
  );
  assert.equal(newer.status, 200);

  const stale = await publish(
    A.token,
    group.id,
    1,
    draftOf([accountOf(1001, [101, 201], { sourceExportedAt: TIME })]),
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'STALE_SOURCE');

  const mismatch = await publish(
    A.token,
    group.id,
    1,
    draftOf([accountOf(1001, [201], { sourceExportedAt: LATER })]),
  );
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, 'SOURCE_MISMATCH');

  // 同时间同覆盖（只改显示名）允许
  const rename = await publish(
    A.token,
    group.id,
    1,
    draftOf([accountOf(1001, [101], { sourceExportedAt: LATER, accountName: '改名了' })]),
  );
  assert.equal(rename.status, 200);

  // 图鉴升级：允许用同一原始快照重新计算不同覆盖
  const upgraded = await publish(
    A.token,
    group.id,
    2,
    draftOf([accountOf(1001, [101, 201], { sourceExportedAt: LATER })], {
      catalogVersion: 'test-v2',
    }),
  );
  assert.equal(upgraded.status, 200);

  const detail = await detailOf(A.token, group.id);
  assert.equal(memberOf(detail, A.accountId).resource.catalogVersion, 'test-v2');
  assert.deepEqual(memberOf(detail, A.accountId).resource.accounts[0].eggGameIds, [101, 201]);
});

test('非法输入不落库：字段、数量、UID、时间、版本与未知字段', async () => {
  const group = await groupWithMembers([B]);
  const base = await publish(A.token, group.id, 0, draftOf([accountOf(1001, [101])]));
  assert.equal(base.status, 200);

  const cases = [
    ['非规范 UID', draftOf([accountOf(1001, [101], { accountKey: 'uid:01' })])],
    ['name 形式 UID', draftOf([accountOf(1001, [101], { accountKey: 'name:甲' })])],
    ['重复 UID', draftOf([accountOf(1001, [101]), accountOf(1001, [201])])],
    ['小数 ID', draftOf([accountOf(1001, [1.5])])],
    ['负数 ID', draftOf([accountOf(1001, [-1])])],
    ['字符串 ID', draftOf([accountOf(1001, ['101'])])],
    ['无效时间', draftOf([accountOf(1001, [101], { sourceExportedAt: '2026-10-23' })])],
    ['空账号名', draftOf([accountOf(1001, [101], { accountName: '' })])],
    ['账号名过长', draftOf([accountOf(1001, [101], { accountName: 'x'.repeat(81) })])],
    ['未知 schemaVersion', draftOf([accountOf(1001, [101])], { schemaVersion: 2 })],
    ['未知 criteriaId', draftOf([accountOf(1001, [101])], { criteriaId: 'other' })],
    ['空图鉴版本', draftOf([accountOf(1001, [101])], { catalogVersion: '' })],
    ['超过 50 个账号', draftOf(Array.from({ length: 51 }, (_, index) => accountOf(5000 + index, [101])))],
    ['单账号超过 1024 个蛋', draftOf([accountOf(1001, Array.from({ length: 1025 }, (_, index) => index + 1))])],
    ['产线档位未知', draftOf([accountOf(1001, [101], { lines: [{ eggGameId: 101, grade: '神级', natures: ['固执'] }] })])],
    ['产线性格为空', draftOf([accountOf(1001, [101], { lines: [{ eggGameId: 101, grade: '大婉', natures: [] }] })])],
    ['产线性格重复', draftOf([accountOf(1001, [101], { lines: [{ eggGameId: 101, grade: '大婉', natures: ['固执', '固执'] }] })])],
    ['产线蛋 ID 非法', draftOf([accountOf(1001, [101], { lines: [{ eggGameId: 0, grade: '大婉', natures: ['固执'] }] })])],
    [
      '产线重复（蛋 + 档位）',
      draftOf([
        accountOf(1001, [101], {
          lines: [
            { eggGameId: 101, grade: '大婉', natures: ['固执'] },
            { eggGameId: 101, grade: '大婉', natures: ['开朗'] },
          ],
        }),
      ]),
    ],
  ];
  for (const [label, resource] of cases) {
    const result = await publish(A.token, group.id, 1, resource);
    assert.equal(result.status, 400, `${label} 应返回 400，实际 ${result.status}`);
    assert.equal(result.body.code, 'INVALID_INPUT', `${label} 的 code 应是 INVALID_INPUT`);
  }

  const badBody = await publish(A.token, group.id, 1, undefined);
  assert.equal(badBody.status, 400);

  const badRevision = await call(A.token, 'PUT', `/api/mother-groups/${group.id}/resources/me`, {
    baseRevision: 1.5,
    resource: draftOf([accountOf(1001, [101])]),
  });
  assert.equal(badRevision.status, 400);

  const invalidJson = await fetch(`${BASE}/api/mother-groups/${group.id}/resources/me`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${A.token}`, 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(invalidJson.status, 400);

  const detail = await detailOf(A.token, group.id);
  const resource = memberOf(detail, A.accountId).resource;
  assert.equal(resource.revision, 1, '非法输入不能推进版本');
  assert.deepEqual(resource.accounts[0].eggGameIds, [101]);
});

test('产线随摘要发布并可读回', async () => {
  const group = await groupWithMembers([B]);
  const lines = [
    { eggGameId: 101, grade: '大婉', natures: ['固执', '开朗'] },
    { eggGameId: 201, grade: '小婉', natures: ['胆小'] },
  ];
  const result = await publish(
    A.token,
    group.id,
    0,
    draftOf([accountOf(1001, [101, 201], { lines })]),
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const detail = await detailOf(A.token, group.id);
  const saved = memberOf(detail, A.accountId).resource;
  assert.deepEqual(saved.accounts[0].lines, lines);
});

test('超过 256KiB 的请求体返回 413', async () => {
  const group = await groupWithMembers([B]);
  const huge = draftOf([accountOf(1001, [101])], { padding: 'x'.repeat(260 * 1024) });
  const result = await publish(A.token, group.id, 0, huge);
  assert.equal(result.status, 413);
  assert.equal(result.body.code, 'PAYLOAD_TOO_LARGE');
});

test('未知字段只忽略、不持久化；蛋 ID 排序去重', async () => {
  const group = await groupWithMembers([B]);
  const resource = draftOf([
    {
      ...accountOf(1001, [201, 101, 101]),
      token: '客户端自报的令牌',
      extra: 'x',
    },
  ], { accountId: 'forged', token: 'nope' });
  const result = await publish(A.token, group.id, 0, resource);
  assert.equal(result.status, 200);

  const detail = await detailOf(A.token, group.id);
  const saved = memberOf(detail, A.accountId).resource;
  assert.deepEqual(saved.accounts[0].eggGameIds, [101, 201]);
  assert.equal(Object.hasOwn(saved.accounts[0], 'token'), false);
  assert.equal(Object.hasOwn(saved.accounts[0], 'extra'), false);
  assert.equal(Object.hasOwn(saved, 'token'), false);
});

test('昵称更新只作用于当前组自己，不影响资源版本', async () => {
  const group = await groupWithMembers([B]);
  const published = await publish(A.token, group.id, 0, draftOf([accountOf(1001, [101])]));
  assert.equal(published.status, 200);

  const updated = await call(B.token, 'PUT', `/api/mother-groups/${group.id}/profile/me`, {
    displayName: 'B 的新昵称',
  });
  assert.equal(updated.status, 200);

  const detail = await detailOf(A.token, group.id);
  assert.equal(memberOf(detail, B.accountId).displayName, 'B 的新昵称');
  assert.equal(memberOf(detail, A.accountId).displayName, '组长');
  assert.equal(memberOf(detail, A.accountId).resource.revision, 1);
});

test('邀请码重置后旧码失效、现有成员保留；非组主不能重置或解散', async () => {
  const group = await groupWithMembers([B]);
  const resetByB = await call(B.token, 'POST', `/api/mother-groups/${group.id}/invite/reset`);
  assert.equal(resetByB.status, 403);
  assert.equal(resetByB.body.code, 'NOT_OWNER');

  const reset = await call(A.token, 'POST', `/api/mother-groups/${group.id}/invite/reset`);
  assert.equal(reset.status, 200);
  assert.match(reset.body.inviteCode, /^[0-9A-Z]{8}$/);
  assert.notEqual(reset.body.inviteCode, group.inviteCode);

  const oldCode = await joinGroup(C, group.inviteCode, 'C');
  assert.equal(oldCode.status, 404);
  assert.equal(oldCode.body.code, 'GROUP_NOT_FOUND');

  const newCode = await joinGroup(C, reset.body.inviteCode, 'C');
  assert.equal(newCode.status, 200);
  assert.equal(newCode.body.groupId, group.id);

  const still = await detailOf(B.token, group.id);
  assert.equal(still.status, 200);
  assert.equal(still.body.members.length, 3);

  const dissolveByB = await call(B.token, 'DELETE', `/api/mother-groups/${group.id}`);
  assert.equal(dissolveByB.status, 403);
  assert.equal(dissolveByB.body.code, 'NOT_OWNER');
});

test('普通成员退出后资源与成员资格一起删除；组主必须解散', async () => {
  const group = await groupWithMembers([B]);
  const published = await publish(B.token, group.id, 0, draftOf([accountOf(2001, [101])]));
  assert.equal(published.status, 200);

  const ownerLeave = await call(A.token, 'DELETE', `/api/mother-groups/${group.id}/members/me`);
  assert.equal(ownerLeave.status, 409);
  assert.equal(ownerLeave.body.code, 'OWNER_MUST_DISSOLVE');

  const leave = await call(B.token, 'DELETE', `/api/mother-groups/${group.id}/members/me`);
  assert.equal(leave.status, 200);

  const detail = await detailOf(A.token, group.id);
  assert.equal(detail.body.members.length, 1);
  assert.equal(detail.body.members.some((item) => item.accountId === B.accountId), false);

  const readAfterLeave = await detailOf(B.token, group.id);
  assert.equal(readAfterLeave.status, 403);

  // 重新加入后是全新成员：旧资源不会回来
  const back = await joinGroup(B, group.inviteCode, 'B');
  assert.equal(back.status, 200);
  const fresh = await detailOf(A.token, group.id);
  assert.equal(memberOf(fresh, B.accountId).resource, null);
});

test('解散组后其他成员看到 404，组从各自的列表里消失', async () => {
  const group = await groupWithMembers([B]);
  const dissolved = await call(A.token, 'DELETE', `/api/mother-groups/${group.id}`);
  assert.equal(dissolved.status, 200);

  const gone = await detailOf(B.token, group.id);
  assert.equal(gone.status, 404);
  assert.equal(gone.body.code, 'GROUP_NOT_FOUND');

  const list = await call(B.token, 'GET', '/api/mother-groups');
  assert.equal(list.body.groups.some((item) => item.id === group.id), false);
});

test('注销工具箱身份会解散自己创建的组，并撤回在其他组里的资源', async () => {
  const owner = await register('注销测试', uniqueIp());
  const group = await createGroup(owner, '注销组');
  const joined = await joinGroup(B, group.inviteCode, 'B');
  assert.equal(joined.status, 200);
  const published = await publish(owner.token, group.id, 0, draftOf([accountOf(9001, [101])]));
  assert.equal(published.status, 200);

  const removed = await call(owner.token, 'DELETE', '/api/account');
  assert.equal(removed.status, 200);

  const gone = await detailOf(B.token, group.id);
  assert.equal(gone.status, 404);

  // B 自己在别的组里的成员资格不受影响
  const ownGroup = await createGroup(B, 'B 自己的组');
  const alive = await detailOf(B.token, ownGroup.id);
  assert.equal(alive.status, 200);
});

test('20 人上限并发抢最后名额不会超额，已入组重试仍幂等', async () => {
  const owner = await register('人数上限组长', uniqueIp());
  const members = await Promise.all(
    Array.from({ length: 18 }, (_, index) => register(`成员${index}`, uniqueIp())),
  );
  const candidates = await Promise.all([
    register('最后名额甲', uniqueIp()),
    register('最后名额乙', uniqueIp()),
  ]);

  const group = await createGroup(owner, '满员组');
  for (const member of members) {
    const joined = await joinGroup(member, group.inviteCode, member.label);
    assert.equal(joined.status, 200);
  }

  const [left, right] = await Promise.all([
    joinGroup(candidates[0], group.inviteCode, candidates[0].label),
    joinGroup(candidates[1], group.inviteCode, candidates[1].label),
  ]);
  const statuses = [left.status, right.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 409]);
  const rejected = left.status === 409 ? left : right;
  assert.equal(rejected.body.code, 'GROUP_FULL');

  const detail = await detailOf(owner.token, group.id);
  assert.equal(detail.body.members.length, 20);

  // 满员时已入组的人重试加入仍然成功（幂等，不重复建成员）
  const retry = await joinGroup(members[0], group.inviteCode, members[0].label);
  assert.equal(retry.status, 200);
  const afterRetry = await detailOf(owner.token, group.id);
  assert.equal(afterRetry.body.members.length, 20);

  // 没抢到的人再试仍然 409
  const loser = left.status === 409 ? candidates[0] : candidates[1];
  const again = await joinGroup(loser, group.inviteCode, loser.label);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'GROUP_FULL');
});

test('创建接口限流 30 次/小时，429 带 Retry-After', async () => {
  const identity = await register('限流测试', uniqueIp());
  for (let index = 0; index < 30; index += 1) {
    const result = await call(identity.token, 'POST', '/api/mother-groups', {
      name: `限流组 ${index}`,
      displayName: '人',
    });
    assert.equal(result.status, 200, `第 ${index + 1} 次创建应成功`);
  }
  const blocked = await call(identity.token, 'POST', '/api/mother-groups', {
    name: '再来一个',
    displayName: '人',
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'RATE_LIMITED');
  assert.equal(blocked.headers.get('retry-after'), '60');
});

test('读取限流按账号计，同 IP 的另一身份不受影响', { timeout: 180_000 }, async () => {
  const first = await register('读取限流甲', uniqueIp());
  const second = await register('读取限流乙', uniqueIp());
  const sharedIp = uniqueIp();

  let blocked = null;
  for (let index = 0; index < READ_LIMIT_PER_HOUR + 5; index += 1) {
    const result = await call(first.token, 'GET', '/api/mother-groups', undefined, { ip: sharedIp });
    if (result.status === 429) {
      blocked = result;
      break;
    }
    assert.equal(result.status, 200);
  }
  assert.ok(blocked, '超过读取上限后应出现 429');
  assert.equal(blocked.body.code, 'RATE_LIMITED');
  assert.equal(blocked.headers.get('retry-after'), '60');

  const other = await call(second.token, 'GET', '/api/mother-groups', undefined, { ip: sharedIp });
  assert.equal(other.status, 200, '同公网 IP 的其他身份不应共用读取桶');
});
