/**
 * 小组收集二期：真实本地 Functions + D1 的 API 集成测试。
 *
 * 由 `tools/test/run-mother-groups-local.mjs` 启动服务后调用，只接受 loopback 地址。
 * 覆盖：旧组默认迁移、旧接口类型门禁、种公目标修订、种公摘要往返、
 * 组目标修改与并发、加入前确认、UID 抢占。
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';

const BASE = (process.env.ROCO_MOTHER_API_BASE ?? '').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(BASE)) {
  throw new Error(
    `拒绝在非 loopback 地址上运行集成测试：${BASE || '（未设置 ROCO_MOTHER_API_BASE）'}`,
  );
}

const TIME = '2026-10-23T00:00:00.000Z';
const LATER = '2026-10-24T00:00:00.000Z';
const SLOT = { groupId: 2, natureId: 11, natureName: '开朗', grade: '大婉' };

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

async function register(label) {
  const result = await call(null, 'POST', '/api/auth/register', { label }, { ip: uniqueIp() });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { label, token: result.body.token, accountId: result.body.accountId };
}

const motherAccount = (uid, ids) => ({
  accountKey: `uid:${uid}`,
  accountName: `账号${uid}`,
  sourceExportedAt: TIME,
  eggGameIds: ids,
});

const motherDraft = (accounts) => ({
  schemaVersion: 1,
  criteriaId: 'female-huge-voice100-v1',
  catalogVersion: 'test-v1',
  accounts,
});

const studAccount = (uid, covered, breedable = []) => ({
  accountKey: `uid:${uid}`,
  accountName: `账号${uid}`,
  sourceExportedAt: TIME,
  covered: covered.map((slot) => ({ ...slot, gameId: 102 })),
  breedable: breedable.map((slot) => ({ ...slot, gameId: 102 })),
});

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const slotKey = (slot) => `${slot.groupId}:${slot.natureId}:${slot.grade}`;
const targetIdOf = (target) =>
  `stud-${fnv1a(`${target.mode}|${target.slots.map(slotKey).sort().join(',')}`)}`;

const studTarget = (patch = {}) => ({
  kind: 'stud',
  mode: 'perfect',
  catalogVersion: 'test-v1',
  slots: [SLOT],
  ...patch,
});

const studDraft = (accounts, patch = {}) => ({
  schemaVersion: 1,
  kind: 'stud',
  mode: 'perfect',
  catalogVersion: 'test-v1',
  targetId: targetIdOf(studTarget()),
  targetRevision: 1,
  accounts,
  ...patch,
});

let A;
let B;
let C;

before(async () => {
  [A, B, C] = await Promise.all(['A', 'B', 'C'].map((label) => register(label)));
});

async function createGroup(owner, body) {
  const result = await call(owner.token, 'POST', '/api/collection-groups', body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { id: result.body.group.id, inviteCode: result.body.inviteCode, group: result.body.group };
}

async function join(identity, inviteCode) {
  return call(identity.token, 'POST', '/api/collection-groups/join', {
    inviteCode,
    displayName: identity.label,
  });
}

test('旧接口创建的组默认是母本组，新接口可直接读取', async () => {
  const legacy = await call(A.token, 'POST', '/api/mother-groups', {
    name: '旧组',
    displayName: 'A',
  });
  assert.equal(legacy.status, 200);
  const groupId = legacy.body.group.id;

  const list = await call(A.token, 'GET', '/api/collection-groups');
  assert.equal(list.status, 200);
  const summary = list.body.groups.find((item) => item.id === groupId);
  assert.ok(summary);
  assert.equal(summary.groupType, 'mother');
  assert.equal(summary.targetRevision, 0);
  assert.equal(summary.targetReady, true);

  const detail = await call(A.token, 'GET', `/api/collection-groups/${groupId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.group.groupType, 'mother');
  assert.equal(detail.body.group.target, null);
});

test('新建母本组带目标；旧接口仍可读写', async () => {
  const created = await createGroup(A, {
    name: '新母本组',
    displayName: 'A',
    groupType: 'mother',
    target: {
      kind: 'mother',
      mode: 'perfect',
      bodies: ['大块头'],
      voices: ['+100'],
      catalogVersion: 'test-v1',
    },
  });
  assert.equal(created.group.groupType, 'mother');
  assert.equal(created.group.target.criteriaId, 'female-huge-voice100-v1');

  const publish = await call(A.token, 'PUT', `/api/mother-groups/${created.id}/resources/me`, {
    baseRevision: 0,
    resource: motherDraft([motherAccount(1001, [101])]),
  });
  assert.equal(publish.status, 200);

  const legacyDetail = await call(A.token, 'GET', `/api/mother-groups/${created.id}`);
  assert.equal(legacyDetail.status, 200);
  assert.deepEqual(legacyDetail.body.members[0].resource.accounts[0].eggGameIds, [101]);
});

test('种公组：目标未确认时不能发布；组长确认后修订递增', async () => {
  const created = await createGroup(A, {
    name: '种公组',
    displayName: 'A',
    groupType: 'stud',
  });
  assert.equal(created.group.groupType, 'stud');
  assert.deepEqual(created.group.target.slots, []);

  const beforeReady = await call(
    A.token,
    'PUT',
    `/api/collection-groups/${created.id}/resources/me`,
    {
      baseRevision: 0,
      baseTargetRevision: 0,
      resource: studDraft([studAccount(1001, [SLOT])], { targetRevision: 0 }),
    },
  );
  assert.equal(beforeReady.status, 409);
  assert.equal(beforeReady.body.code, 'TARGET_NOT_READY');

  const targetUpdate = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/target`, {
    baseTargetRevision: 0,
    target: studTarget(),
  });
  assert.equal(targetUpdate.status, 200);
  assert.equal(targetUpdate.body.targetRevision, 1);

  const byOther = await call(B.token, 'PUT', `/api/collection-groups/${created.id}/target`, {
    baseTargetRevision: 1,
    target: studTarget(),
  });
  assert.equal(byOther.status, 403);
  assert.equal(byOther.body.code, 'NOT_OWNER');

  const stale = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/target`, {
    baseTargetRevision: 0,
    target: studTarget(),
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'REVISION_CONFLICT');
});

test('种公摘要往返：covered / breedable 分开保存，停止共享后清空', async () => {
  const created = await createGroup(A, {
    name: '种公组二',
    displayName: 'A',
    groupType: 'stud',
    target: studTarget(),
  });
  const joined = await join(B, created.inviteCode);
  assert.equal(joined.status, 200);
  assert.equal(joined.body.groupType, 'stud');

  const published = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 0,
    baseTargetRevision: 0,
    resource: studDraft([studAccount(1001, [SLOT], [])], { targetRevision: 0 }),
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.resourceRevision, 1);

  const detail = await call(B.token, 'GET', `/api/collection-groups/${created.id}`);
  assert.equal(detail.status, 200);
  const mine = detail.body.members.find((member) => member.accountId === A.accountId);
  assert.equal(mine.resource, null);
  assert.equal(mine.studResource.kind, 'stud');
  assert.deepEqual(mine.studResource.accounts[0].covered[0], {
    groupId: SLOT.groupId,
    natureId: SLOT.natureId,
    grade: SLOT.grade,
    gameId: 102,
  });
  assert.deepEqual(mine.studResource.accounts[0].breedable, []);

  const stopped = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 1,
    baseTargetRevision: 0,
    resource: studDraft([], { targetRevision: 0 }),
  });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.publishedAt, null);
  const after = await call(B.token, 'GET', `/api/collection-groups/${created.id}`);
  assert.equal(
    after.body.members.find((member) => member.accountId === A.accountId).studResource,
    null,
  );
});

test('种公组目标改变后，旧修订的发布被拒绝', async () => {
  const created = await createGroup(A, {
    name: '改目标',
    displayName: 'A',
    groupType: 'stud',
    target: studTarget(),
  });
  const update = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/target`, {
    baseTargetRevision: 0,
    target: studTarget({ slots: [SLOT, { ...SLOT, natureId: 12, natureName: '固执' }] }),
  });
  assert.equal(update.status, 200);

  const oldRevision = await call(
    A.token,
    'PUT',
    `/api/collection-groups/${created.id}/resources/me`,
    {
      baseRevision: 0,
      baseTargetRevision: 0,
      resource: studDraft([studAccount(1001, [SLOT])], { targetRevision: 0 }),
    },
  );
  assert.equal(oldRevision.status, 409);
  assert.equal(oldRevision.body.code, 'TARGET_CHANGED');

  const newTarget = studTarget({ slots: [SLOT, { ...SLOT, natureId: 12, natureName: '固执' }] });
  const current = await call(
    A.token,
    'PUT',
    `/api/collection-groups/${created.id}/resources/me`,
    {
      baseRevision: 0,
      baseTargetRevision: 1,
      resource: studDraft([studAccount(1001, [SLOT])], {
        targetRevision: 1,
        targetId: targetIdOf(newTarget),
      }),
    },
  );
  assert.equal(current.status, 200, JSON.stringify(current.body));
});

test('旧接口看不到、也写不进种公组；旧邀请码不能加入种公组', async () => {
  const created = await createGroup(A, {
    name: '隔离组',
    displayName: 'A',
    groupType: 'stud',
    target: studTarget(),
  });

  const oldList = await call(A.token, 'GET', '/api/mother-groups');
  assert.equal(oldList.body.groups.some((item) => item.id === created.id), false);

  const oldDetail = await call(A.token, 'GET', `/api/mother-groups/${created.id}`);
  assert.equal(oldDetail.status, 404);

  const oldPublish = await call(A.token, 'PUT', `/api/mother-groups/${created.id}/resources/me`, {
    baseRevision: 0,
    resource: motherDraft([motherAccount(1001, [101])]),
  });
  assert.equal(oldPublish.status, 404);

  const oldJoin = await call(B.token, 'POST', '/api/mother-groups/join', {
    inviteCode: created.inviteCode,
    displayName: 'B',
  });
  assert.equal(oldJoin.status, 404);

  const newList = await call(A.token, 'GET', '/api/collection-groups');
  assert.equal(newList.body.groups.some((item) => item.id === created.id), true);
});

test('加入前确认展示组名、类型与目标', async () => {
  const created = await createGroup(A, {
    name: '确认组',
    displayName: 'A',
    groupType: 'stud',
    target: studTarget(),
  });
  const preview = await call(C.token, 'POST', '/api/collection-groups/invite/preview', {
    inviteCode: created.inviteCode,
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.name, '确认组');
  assert.equal(preview.body.groupType, 'stud');
  assert.equal(preview.body.targetReady, true);
  assert.equal(preview.body.target.slots.length, 1);

  const bad = await call(C.token, 'POST', '/api/collection-groups/invite/preview', {
    inviteCode: 'ZZZZZZZZ',
  });
  assert.equal(bad.status, 404);
});

test('母本组自选口径：新口径可发布，旧固定口径被拒绝', async () => {
  const created = await createGroup(A, {
    name: '自选口径组',
    displayName: 'A',
    groupType: 'mother',
  });
  const customId = `mother-v2-${fnv1a('medal|小不点|婉转声')}`;
  const updated = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/target`, {
    baseTargetRevision: 0,
    target: {
      kind: 'mother',
      mode: 'medal',
      bodies: ['小不点'],
      voices: ['婉转声'],
      catalogVersion: 'test-v1',
    },
  });
  assert.equal(updated.status, 200);

  const detail = await call(A.token, 'GET', `/api/collection-groups/${created.id}`);
  assert.equal(detail.body.group.target.criteriaId, customId);

  const customDraft = {
    ...motherDraft([motherAccount(1001, [101])]),
    criteriaId: customId,
  };
  const published = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 0,
    baseTargetRevision: 1,
    resource: customDraft,
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));

  const legacyDraft = motherDraft([motherAccount(1001, [101])]);
  const byNew = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 1,
    baseTargetRevision: 1,
    resource: legacyDraft,
  });
  assert.equal(byNew.status, 409);
  assert.equal(byNew.body.code, 'TARGET_CHANGED');

  const byOld = await call(A.token, 'PUT', `/api/mother-groups/${created.id}/resources/me`, {
    baseRevision: 1,
    resource: legacyDraft,
  });
  assert.equal(byOld.status, 409);
  assert.equal(byOld.body.code, 'TARGET_CHANGED');
});

test('共同寻找：全员确认后才能认领，并发只有一个成功；发布补齐自动结束任务', async () => {
  const created = await createGroup(A, {
    name: '共同寻找组',
    displayName: 'A',
    groupType: 'mother',
  });
  assert.equal((await join(B, created.inviteCode)).status, 200);

  const unconfirmed = await call(
    A.token,
    'POST',
    `/api/collection-groups/${created.id}/tasks/claim`,
    { targetKey: 'mother:999' },
  );
  assert.equal(unconfirmed.status, 409);
  assert.equal(unconfirmed.body.code, 'TASKS_NOT_CONFIRMED');

  const aPublish = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 0,
    baseTargetRevision: 0,
    resource: motherDraft([motherAccount(1001, [101])]),
  });
  assert.equal(aPublish.status, 200);
  const bPublish = await call(B.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 0,
    baseTargetRevision: 0,
    resource: motherDraft([motherAccount(2001, [201])]),
  });
  assert.equal(bPublish.status, 200);

  const confirmed = await call(A.token, 'GET', `/api/collection-groups/${created.id}/tasks`);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.confirmed, true);
  assert.deepEqual(confirmed.body.tasks, []);

  // 并发认领同一目标：只能有一个成功
  const [left, right] = await Promise.all([
    call(A.token, 'POST', `/api/collection-groups/${created.id}/tasks/claim`, {
      targetKey: 'mother:999',
    }),
    call(B.token, 'POST', `/api/collection-groups/${created.id}/tasks/claim`, {
      targetKey: 'mother:999',
    }),
  ]);
  const statuses = [left.status, right.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 409]);
  const taken = left.status === 409 ? left : right;
  assert.equal(taken.body.code, 'TASK_TAKEN');

  const winnerToken = left.status === 200 ? A.token : B.token;
  const winnerId = left.status === 200 ? A.accountId : B.accountId;
  const loserToken = left.status === 200 ? B.token : A.token;
  const tasksAfterClaim = await call(A.token, 'GET', `/api/collection-groups/${created.id}/tasks`);
  const task = tasksAfterClaim.body.tasks.find((item) => item.targetKey === 'mother:999');
  assert.equal(task.status, 'claimed');
  assert.equal(task.ownerAccountId, winnerId);

  // 组长可以释放（普通成员释放由单测覆盖）
  const releasedByOwner = await call(A.token, 'POST', `/api/collection-groups/${created.id}/tasks/release`, {
    targetKey: 'mother:999',
    version: task.version,
  });
  assert.equal(releasedByOwner.status, 200);
  assert.equal(releasedByOwner.body.task.status, 'open');
  assert.equal(releasedByOwner.body.task.ownerAccountId, null);

  // 重新认领后，发布补齐该蛋血脉 → 任务自动关闭
  const reclaim = await call(winnerToken, 'POST', `/api/collection-groups/${created.id}/tasks/claim`, {
    targetKey: 'mother:999',
  });
  assert.equal(reclaim.status, 200);
  const covered = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 1,
    baseTargetRevision: 0,
    resource: motherDraft([
      {
        accountKey: 'uid:1001',
        accountName: '账号1001',
        sourceExportedAt: LATER,
        eggGameIds: [101, 999],
      },
    ]),
  });
  assert.equal(covered.status, 200);
  const afterCover = await call(A.token, 'GET', `/api/collection-groups/${created.id}/tasks`);
  assert.equal(afterCover.body.tasks.some((item) => item.targetKey === 'mother:999'), false);

  const claimCovered = await call(B.token, 'POST', `/api/collection-groups/${created.id}/tasks/claim`, {
    targetKey: 'mother:999',
  });
  assert.equal(claimCovered.status, 409);
  assert.equal(claimCovered.body.code, 'TASK_ALREADY_COVERED');
});

test('共同寻找：目标不属于本组当前目标时拒绝；种公组目标修订后旧任务不再可认领', async () => {
  const created = await createGroup(A, {
    name: '种公任务组',
    displayName: 'A',
    groupType: 'stud',
    target: studTarget(),
  });
  const outside = await call(A.token, 'POST', `/api/collection-groups/${created.id}/tasks/claim`, {
    targetKey: 'stud:9:9:大婉',
  });
  assert.equal(outside.status, 404);
  assert.equal(outside.body.code, 'TASK_NOT_FOUND');

  const update = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/target`, {
    baseTargetRevision: 0,
    target: studTarget({ slots: [SLOT, { ...SLOT, natureId: 12, natureName: '固执' }] }),
  });
  assert.equal(update.status, 200);
  const tasks = await call(A.token, 'GET', `/api/collection-groups/${created.id}/tasks`);
  assert.equal(tasks.status, 200);
  assert.equal(tasks.body.targetRevision, 1);
  assert.deepEqual(tasks.body.tasks, []);
});

test('种公摘要同组 UID 被占用时整批回滚；旧源时间被拒绝', async () => {
  const created = await createGroup(A, {
    name: '冲突组',
    displayName: 'A',
    groupType: 'stud',
    target: studTarget(),
  });
  assert.equal((await join(B, created.inviteCode)).status, 200);

  const a = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 0,
    baseTargetRevision: 0,
    resource: studDraft([studAccount(1001, [SLOT])], { targetRevision: 0 }),
  });
  assert.equal(a.status, 200);
  const b = await call(B.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 0,
    baseTargetRevision: 0,
    resource: studDraft([studAccount(1002, [SLOT])], { targetRevision: 0 }),
  });
  assert.equal(b.status, 200);

  const clash = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 1,
    baseTargetRevision: 0,
    resource: studDraft([studAccount(1002, [SLOT])], { targetRevision: 0 }),
  });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, 'GAME_ACCOUNT_ALREADY_SHARED');

  const stale = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 1,
    baseTargetRevision: 0,
    resource: studDraft([
      studAccount(1001, [SLOT], [], { sourceExportedAt: LATER }),
      { ...studAccount(1001, [SLOT]), sourceExportedAt: TIME },
    ], { targetRevision: 0 }),
  });
  assert.equal(stale.status, 400, '重复 UID 先被输入校验拦住');

  const stale2 = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 1,
    baseTargetRevision: 0,
    resource: studDraft([
      { ...studAccount(1001, [SLOT]), sourceExportedAt: TIME },
    ], { targetRevision: 0 }),
  });
  assert.equal(stale2.status, 200, '同一份数据同一覆盖允许重发');
});
