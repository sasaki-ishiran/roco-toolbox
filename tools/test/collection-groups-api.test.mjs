/**
 * 小组收集二期：真实本地 Functions + D1 的 API 集成测试。
 *
 * 由 `tools/test/run-mother-groups-local.mjs` 启动服务后调用，只接受 loopback 地址。
 * 覆盖：旧组默认迁移、旧接口类型门禁、母本目标修订、摘要往返、组目标修改与并发、
 * 加入前确认、UID 抢占、需求承接。
 * 种公组已于 2026-10-27 下线，创建请求必须被拒绝。
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
  criteriaId: 'all-mothers-v2',
  catalogVersion: 'test-v1',
  accounts,
});

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

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
  assert.equal(created.group.target.criteriaId, 'female-huge-voice100-v2');

  const publish = await call(A.token, 'PUT', `/api/mother-groups/${created.id}/resources/me`, {
    baseRevision: 0,
    resource: motherDraft([motherAccount(1001, [101])]),
  });
  assert.equal(publish.status, 200);

  const legacyDetail = await call(A.token, 'GET', `/api/mother-groups/${created.id}`);
  assert.equal(legacyDetail.status, 200);
  assert.deepEqual(legacyDetail.body.members[0].resource.accounts[0].eggGameIds, [101]);
});

test('种公组已下线：创建请求被拒绝', async () => {
  const rejected = await call(A.token, 'POST', '/api/collection-groups', {
    name: '种公组',
    displayName: 'A',
    groupType: 'stud',
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'INVALID_INPUT');
  assert.match(rejected.body.error, /种公/);
});

test('加入前确认展示组名与目标', async () => {
  const created = await createGroup(A, {
    name: '确认组',
    displayName: 'A',
    groupType: 'mother',
  });
  const preview = await call(C.token, 'POST', '/api/collection-groups/invite/preview', {
    inviteCode: created.inviteCode,
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.name, '确认组');
  assert.equal(preview.body.groupType, 'mother');
  assert.equal(preview.body.targetReady, true);
  assert.deepEqual(preview.body.target.bodies, ['大块头']);

  const bad = await call(C.token, 'POST', '/api/collection-groups/invite/preview', {
    inviteCode: 'ZZZZZZZZ',
  });
  assert.equal(bad.status, 404);
});

test('母本发布不再校验口径；过期 baseTargetRevision 仍拒绝', async () => {
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

  // 组目标口径不再参与发布校验：用别的 criteriaId 也能发布
  const legacyDraft = motherDraft([motherAccount(1001, [101])]);
  const byOther = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 1,
    baseTargetRevision: 1,
    resource: legacyDraft,
  });
  assert.equal(byOther.status, 200, JSON.stringify(byOther.body));

  const byOldApi = await call(A.token, 'PUT', `/api/mother-groups/${created.id}/resources/me`, {
    baseRevision: 2,
    resource: legacyDraft,
  });
  assert.equal(byOldApi.status, 200, JSON.stringify(byOldApi.body));

  // 但带了过期的 baseTargetRevision 仍要报冲突（CAS 语义保留）
  const staleTarget = await call(A.token, 'PUT', `/api/collection-groups/${created.id}/resources/me`, {
    baseRevision: 3,
    baseTargetRevision: 0,
    resource: legacyDraft,
  });
  assert.equal(staleTarget.status, 409);
  assert.equal(staleTarget.body.code, 'TARGET_CHANGED');
});

test('旧接口创建的组也能保存自选口径（自动补配置行）', async () => {
  const legacy = await call(A.token, 'POST', '/api/mother-groups', {
    name: '旧组自选',
    displayName: 'A',
  });
  assert.equal(legacy.status, 200);
  const groupId = legacy.body.group.id;

  const update = await call(A.token, 'PUT', `/api/collection-groups/${groupId}/target`, {
    baseTargetRevision: 0,
    target: {
      kind: 'mother',
      mode: 'medal',
      bodies: ['小不点'],
      voices: ['婉转声'],
      catalogVersion: 'test-v1',
    },
  });
  assert.equal(update.status, 200, JSON.stringify(update.body));
  const detail = await call(A.token, 'GET', `/api/collection-groups/${groupId}`);
  assert.equal(detail.body.group.target.criteriaId, `mother-v2-${fnv1a('medal|小不点|婉转声')}`);
  assert.equal(detail.body.group.targetRevision, 1);
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

test('共同寻找：目标不属于本组当前目标时拒绝', async () => {
  const created = await createGroup(A, {
    name: '任务校验组',
    displayName: 'A',
    groupType: 'mother',
  });
  // 母本组只认 mother:<蛋血脉>；种公槽位键不属于本组目标
  const outside = await call(A.token, 'POST', `/api/collection-groups/${created.id}/tasks/claim`, {
    targetKey: 'stud:9:9:大婉',
  });
  assert.equal(outside.status, 404);
  assert.equal(outside.body.code, 'TASK_NOT_FOUND');
});

test('需求承接：组员可接单、放弃，别人接过的不能再接', async () => {
  const created = await createGroup(A, {
    name: '需求承接组',
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
  assert.equal((await join(B, created.inviteCode)).status, 200);
  assert.equal((await join(C, created.inviteCode)).status, 200);

  // 不挑性格：nature 为空串
  const published = await call(A.token, 'POST', `/api/collection-groups/${created.id}/demands`, {
    eggGameId: 3454,
    natures: [],
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  const demand = published.body.demands[0];
  assert.equal(demand.nature, '');
  assert.equal(demand.status, 'open');

  const path = `/api/collection-groups/${created.id}/demands/3454`;
  const body = { demanderAccountId: A.accountId, eggGameId: 3454, nature: '' };

  const claim = await call(B.token, 'POST', `${path}/claim`, { ...body, version: demand.version });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(claim.body.demand.status, 'claimed');
  assert.equal(claim.body.demand.claimerAccountId, B.accountId);

  const taken = await call(C.token, 'POST', `${path}/claim`, { ...body, version: claim.body.demand.version });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.code, 'DEMAND_TAKEN');

  const release = await call(B.token, 'POST', `${path}/release`, {
    ...body,
    version: claim.body.demand.version,
  });
  assert.equal(release.status, 200, JSON.stringify(release.body));
  assert.equal(release.body.demand.status, 'open');
  assert.equal(release.body.demand.claimerAccountId, null);

  // 带性格的一条：按性格单独接单
  const named = await call(A.token, 'POST', `/api/collection-groups/${created.id}/demands`, {
    eggGameId: 3455,
    natures: ['胆小'],
  });
  assert.equal(named.status, 200, JSON.stringify(named.body));
  const namedClaim = await call(C.token, 'POST', `${path.replace('3454', '3455')}/claim`, {
    demanderAccountId: A.accountId,
    eggGameId: 3455,
    nature: '胆小',
    version: named.body.demands[0].version,
  });
  assert.equal(namedClaim.status, 200, JSON.stringify(namedClaim.body));
  assert.equal(namedClaim.body.demand.nature, '胆小');
  assert.equal(namedClaim.body.demand.claimerAccountId, C.accountId);
});

test('已完成需求不能撤回；组长移除组员会释放承接、取消未完成需求并保留已完成', async () => {
  const created = await createGroup(A, {
    name: '移除组员组',
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
  assert.equal((await join(B, created.inviteCode)).status, 200);
  assert.equal((await join(C, created.inviteCode)).status, 200);

  const base = `/api/collection-groups/${created.id}`;
  const aOne = await call(A.token, 'POST', `${base}/demands`, { eggGameId: 3466, natures: [] });
  const aTwo = await call(A.token, 'POST', `${base}/demands`, {
    eggGameId: 3467,
    natures: ['胆小'],
  });
  assert.equal(aOne.status, 200, JSON.stringify(aOne.body));
  assert.equal(aTwo.status, 200, JSON.stringify(aTwo.body));
  const one = aOne.body.demands[0];
  const two = aTwo.body.demands[0];

  // A 的 3466 由 B 接并确认完成
  const claimOne = await call(B.token, 'POST', `${base}/demands/3466/claim`, {
    demanderAccountId: A.accountId,
    eggGameId: 3466,
    nature: '',
    version: one.version,
  });
  assert.equal(claimOne.status, 200, JSON.stringify(claimOne.body));
  const done = await call(A.token, 'POST', `${base}/demands/3466/complete`, {
    demanderAccountId: A.accountId,
    eggGameId: 3466,
    nature: '',
    version: claimOne.body.demand.version,
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.demand.status, 'done');

  // 已完成的单是已结单凭据，不能撤回
  const withdrawDone = await call(A.token, 'DELETE', `${base}/demands/3466?nature=`);
  assert.equal(withdrawDone.status, 409);
  assert.equal(withdrawDone.body.code, 'DEMAND_ALREADY_DONE');

  // C 接住 A 的另一条（未完成）
  const claimTwo = await call(C.token, 'POST', `${base}/demands/3467/claim`, {
    demanderAccountId: A.accountId,
    eggGameId: 3467,
    nature: '胆小',
    version: two.version,
  });
  assert.equal(claimTwo.status, 200, JSON.stringify(claimTwo.body));

  // C 自己发一条，B 接住：移除 C 时这条未完成需求应被删除
  const cPublished = await call(C.token, 'POST', `${base}/demands`, {
    eggGameId: 3468,
    natures: [],
  });
  assert.equal(cPublished.status, 200, JSON.stringify(cPublished.body));
  const cClaim = await call(B.token, 'POST', `${base}/demands/3468/claim`, {
    demanderAccountId: C.accountId,
    eggGameId: 3468,
    nature: '',
    version: cPublished.body.demands[0].version,
  });
  assert.equal(cClaim.status, 200, JSON.stringify(cClaim.body));

  const notOwner = await call(B.token, 'DELETE', `${base}/members/${C.accountId}`);
  assert.equal(notOwner.status, 403);
  assert.equal(notOwner.body.code, 'NOT_OWNER');
  const removeSelf = await call(A.token, 'DELETE', `${base}/members/${A.accountId}`);
  assert.equal(removeSelf.status, 400);
  const ghost = await call(A.token, 'DELETE', `${base}/members/not-a-member`);
  assert.equal(ghost.status, 404);

  const removed = await call(A.token, 'DELETE', `${base}/members/${C.accountId}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  const listed = await call(A.token, 'GET', `${base}/demands`);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const byEgg = new Map(listed.body.demands.map((item) => [item.eggGameId, item]));
  // 已完成保留（承接人的已结单计数不会倒退）
  assert.equal(byEgg.get(3466).status, 'done');
  assert.equal(byEgg.get(3466).claimerAccountId, B.accountId);
  // C 接住的那条被释放回待承接
  assert.equal(byEgg.get(3467).status, 'open');
  assert.equal(byEgg.get(3467).claimerAccountId, null);
  // C 自己发的未完成需求被取消
  assert.equal(byEgg.has(3468), false);

  const detail = await call(A.token, 'GET', base);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(
    detail.body.members.some((member) => member.accountId === C.accountId),
    false,
  );
});

test('收集组接口：产线随母本摘要发布并可读回（发布预览不再反复提示变化）', async () => {
  const created = await createGroup(A, {
    name: '产线往返组',
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
  const lines = [
    { eggGameId: 101, grade: '大婉', natures: ['固执', '开朗'] },
    { eggGameId: 201, grade: '小婉', natures: ['胆小'] },
  ];
  const resource = motherDraft([
    { ...motherAccount(1001, [101, 201]), lines },
  ]);
  const published = await call(
    A.token,
    'PUT',
    `/api/collection-groups/${created.id}/resources/me`,
    { baseRevision: 0, resource },
  );
  assert.equal(published.status, 200, JSON.stringify(published.body));

  const detail = await call(A.token, 'GET', `/api/collection-groups/${created.id}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  const mine = detail.body.members.find((member) => member.accountId === A.accountId);
  assert.deepEqual(mine.resource.accounts[0].lines, lines);
});

test('种公需求：负数蛋组 id 可发布、可读回；非法蛋组拒绝', async () => {
  const created = await createGroup(A, {
    name: '种公需求组',
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
  const base = `/api/collection-groups/${created.id}`;
  const published = await call(A.token, 'POST', `${base}/demands`, {
    eggGameId: -12,
    natures: ['踏实'],
    gender: '公',
    body: '大块头',
    voice: '+100',
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.demands[0].eggGameId, -12);
  assert.equal(published.body.demands[0].nature, '踏实');

  const listed = await call(A.token, 'GET', `${base}/demands`);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.ok(
    listed.body.demands.some((item) => item.eggGameId === -12 && item.nature === '踏实'),
  );

  const bad = await call(A.token, 'POST', `${base}/demands`, {
    eggGameId: -1,
    natures: ['踏实'],
  });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  assert.equal(bad.body.code, 'INVALID_INPUT');
});
