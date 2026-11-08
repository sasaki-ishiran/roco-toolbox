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
  criteriaId: 'all-mothers-v3-perfect',
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
let D;

before(async () => {
  [A, B, C, D] = await Promise.all(['A', 'B', 'C', 'D'].map((label) => register(label)));
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
    criteriaId: 'all-mothers-v3-medal',
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
  const body = {
    demanderAccountId: A.accountId,
    eggGameId: 3454,
    nature: '',
    gender: '母',
    body: '大块头',
    voice: '+100',
  };

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
    gender: '母',
    body: '大块头',
    voice: '+100',
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
    gender: '母',
    body: '大块头',
    voice: '+100',
    version: one.version,
  });
  assert.equal(claimOne.status, 200, JSON.stringify(claimOne.body));
  const done = await call(A.token, 'POST', `${base}/demands/3466/complete`, {
    demanderAccountId: A.accountId,
    eggGameId: 3466,
    nature: '',
    gender: '母',
    body: '大块头',
    voice: '+100',
    version: claimOne.body.demand.version,
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.demand.status, 'done');

  // 已完成的单是已结单凭据，不能撤回
  const withdrawDone = await call(
    A.token,
    'DELETE',
    `${base}/demands/3466?nature=&gender=%E6%AF%8D&body=%E5%A4%A7%E5%9D%97%E5%A4%B4&voice=%2B100`,
  );
  assert.equal(withdrawDone.status, 409);
  assert.equal(withdrawDone.body.code, 'DEMAND_ALREADY_DONE');

  // C 接住 A 的另一条（未完成）
  const claimTwo = await call(C.token, 'POST', `${base}/demands/3467/claim`, {
    demanderAccountId: A.accountId,
    eggGameId: 3467,
    nature: '胆小',
    gender: '母',
    body: '大块头',
    voice: '+100',
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
    gender: '母',
    body: '大块头',
    voice: '+100',
    version: cPublished.body.demands[0].version,
  });
  assert.equal(cClaim.status, 200, JSON.stringify(cClaim.body));

  // C 自己发的另一条由 B 接住并确认完成：移除 C 之后这笔「已结单」凭据必须保留
  const cDonePublish = await call(C.token, 'POST', `${base}/demands`, {
    eggGameId: 3469,
    natures: [],
  });
  assert.equal(cDonePublish.status, 200, JSON.stringify(cDonePublish.body));
  const cDoneClaim = await call(B.token, 'POST', `${base}/demands/3469/claim`, {
    demanderAccountId: C.accountId,
    eggGameId: 3469,
    nature: '',
    gender: '母',
    body: '大块头',
    voice: '+100',
    version: cDonePublish.body.demands[0].version,
  });
  assert.equal(cDoneClaim.status, 200, JSON.stringify(cDoneClaim.body));
  const cDone = await call(C.token, 'POST', `${base}/demands/3469/complete`, {
    demanderAccountId: C.accountId,
    eggGameId: 3469,
    nature: '',
    gender: '母',
    body: '大块头',
    voice: '+100',
    version: cDoneClaim.body.demand.version,
  });
  assert.equal(cDone.status, 200, JSON.stringify(cDone.body));
  assert.equal(cDone.body.demand.status, 'done');

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
  // 已完成的不再出现在列表里（2026-11-01：只回未完成，历史改走聚合）
  assert.equal(byEgg.has(3466), false);
  assert.equal(byEgg.has(3469), false);
  // C 接住的那条被释放回待承接
  assert.equal(byEgg.get(3467).status, 'open');
  assert.equal(byEgg.get(3467).claimerAccountId, null);
  // C 自己发的未完成需求被取消
  assert.equal(byEgg.has(3468), false);
  // 被移除者「已完成」的需求仍计入承接人的已结单累计（数字不会倒退）
  assert.equal(listed.body.completedCounts[B.accountId], 2);
  // A 是需求方、不是承接人：自己的完成回执为空
  assert.deepEqual(listed.body.myRecentCompleted, []);
  // 承接人 B 能看到自己最近完成的两条（含被移除者的那条）
  const listedByB = await call(B.token, 'GET', `${base}/demands`);
  assert.deepEqual(
    listedByB.body.myRecentCompleted.map((item) => item.eggGameId).sort((a, b) => a - b),
    [3466, 3469],
  );

  const detail = await call(A.token, 'GET', base);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(
    detail.body.members.some((member) => member.accountId === C.accountId),
    false,
  );

  // 已结单的同一颗蛋 + 同一组条件可以再次发布（归档后不占主键）
  const republished = await call(A.token, 'POST', `${base}/demands`, {
    eggGameId: 3466,
    natures: [],
  });
  assert.equal(republished.status, 200, JSON.stringify(republished.body));
  assert.equal(republished.body.demands[0].status, 'open');
  const listedAgain = await call(A.token, 'GET', `${base}/demands`);
  const rows3466 = listedAgain.body.demands.filter((item) => item.eggGameId === 3466);
  // 归档行不再随列表下发：重新发布后列表里只剩这一条新的 open
  assert.equal(rows3466.length, 1);
  assert.equal(rows3466[0].status, 'open');
  assert.equal(listedAgain.body.completedCounts[B.accountId], 2);
});

test('需求：同条件重复发布可以把「要求绿窝」升级为 1', async () => {
  const created = await createGroup(A, {
    name: '绿窝升级组',
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
  const criteria = { gender: '母', body: '大块头', voice: '+100' };

  const first = await call(A.token, 'POST', `${base}/demands`, {
    eggGameId: 3470,
    natures: ['固执'],
    ...criteria,
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  // 不要求绿窝时服务端省略这一列（DTO 只在 true 时带字段）
  assert.equal(first.body.demands[0].requireGreenNest, undefined);

  const again = await call(A.token, 'POST', `${base}/demands`, {
    eggGameId: 3470,
    natures: ['固执'],
    ...criteria,
    requireGreenNest: true,
  });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.demands[0].requireGreenNest, true);

  const listed = await call(A.token, 'GET', `${base}/demands`);
  const row = listed.body.demands.find((item) => item.eggGameId === 3470);
  assert.equal(row?.requireGreenNest, true);
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

/* ---------- 收集计划（2026-11-08） ---------- */

async function planGroup(name) {
  const created = await createGroup(A, {
    name,
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
  return created;
}

test('计划：创建/批量导入去重、已有跳过，按组列表含自己并标成员名', async () => {
  const created = await planGroup('计划创建组');
  const base = `/api/collection-groups/${created.id}`;

  const first = await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [101, 102, 101] });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.plans.length, 2);
  assert.deepEqual(first.body.plans.map((plan) => plan.status), ['backlog', 'backlog']);
  assert.equal(first.body.skipped, 0);

  const second = await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [101, 103] });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.plans.length, 1);
  assert.equal(second.body.plans[0].eggGameId, 103);
  assert.equal(second.body.skipped, 1);

  const listed = await call(B.token, 'GET', `${base}/plans`);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.plans.length, 3);
  assert.equal(listed.body.plans[0].memberDisplayName, 'A');
  assert.equal(listed.body.plans[0].progressStep, 0);
  assert.equal(listed.body.myActiveCount, 0);
  assert.deepEqual(listed.body.matchableEggIds, []);
});

test('计划：进行中不设数量上限，start 直接全部落进行中', async () => {
  const created = await planGroup('计划额度组');
  const base = `/api/collection-groups/${created.id}`;

  const bulk = await call(A.token, 'POST', `${base}/plans`, {
    eggGameIds: [201, 202, 203, 204, 205, 206, 207, 208, 209, 210],
    start: true,
  });
  assert.equal(bulk.status, 200, JSON.stringify(bulk.body));
  const active = bulk.body.plans.filter((plan) => plan.status === 'active');
  assert.equal(active.length, 10);
  assert.equal(bulk.body.overflow, undefined);
  assert.equal(bulk.body.notice, undefined);

  const listed = await call(A.token, 'GET', `${base}/plans`);
  assert.equal(listed.body.myActiveCount, 10);

  // 超过 8 条之后继续「开始」：照常落进行中，没有提示
  const extra = await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [211], start: true });
  assert.equal(extra.status, 200, JSON.stringify(extra.body));
  assert.equal(extra.body.plans[0].status, 'active');
  assert.equal(extra.body.overflow, undefined);
});

test('计划：非组员不能看、不能建、不能标记', async () => {
  const created = await planGroup('计划权限组');
  const base = `/api/collection-groups/${created.id}`;
  const plan = (await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [301] })).body.plans[0];

  const read = await call(D.token, 'GET', `${base}/plans`);
  assert.equal(read.status, 403);
  assert.equal(read.body.code, 'NOT_MEMBER');

  const create = await call(D.token, 'POST', `${base}/plans`, { eggGameIds: [302] });
  assert.equal(create.status, 403);
  assert.equal(create.body.code, 'NOT_MEMBER');

  const offer = await call(D.token, 'PUT', `${base}/plans/${plan.id}/offers/me`, { note: '有' });
  assert.equal(offer.status, 403);
  assert.equal(offer.body.code, 'NOT_MEMBER');
});

test('计划：开始/完成/删除，想收可直接完成，删除连带清掉提供标记', async () => {
  const created = await planGroup('计划流转组');
  const base = `/api/collection-groups/${created.id}`;

  const createdPlan = (await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [401] })).body
    .plans[0];
  // 别人的计划不能开始
  const notMine = await call(B.token, 'POST', `${base}/plans/${createdPlan.id}/start`);
  assert.equal(notMine.status, 403);
  assert.equal(notMine.body.code, 'PLAN_NOT_YOURS');

  const started = await call(A.token, 'POST', `${base}/plans/${createdPlan.id}/start`);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.plan.status, 'active');

  const done = await call(A.token, 'POST', `${base}/plans/${createdPlan.id}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.plan.status, 'done');
  // 已完成不可回退；重复完成幂等
  const restart = await call(A.token, 'POST', `${base}/plans/${createdPlan.id}/start`);
  assert.equal(restart.status, 409);
  assert.equal(restart.body.code, 'PLAN_ALREADY_DONE');
  const again = await call(A.token, 'POST', `${base}/plans/${createdPlan.id}/complete`);
  assert.equal(again.status, 200);
  assert.equal(again.body.plan.status, 'done');

  // 想收 → 直接完成（手里已经有这颗蛋）
  const direct = (await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [402] })).body.plans[0];
  const directDone = await call(A.token, 'POST', `${base}/plans/${direct.id}/complete`);
  assert.equal(directDone.status, 200, JSON.stringify(directDone.body));
  assert.equal(directDone.body.plan.status, 'done');

  // 删除：别人的不能删；自己的删掉后标记一并消失
  const target = (await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [403] })).body.plans[0];
  const offer = await call(B.token, 'PUT', `${base}/plans/${target.id}/offers/me`, { note: '我有' });
  assert.equal(offer.status, 200, JSON.stringify(offer.body));
  const deleteByOther = await call(B.token, 'DELETE', `${base}/plans/${target.id}`);
  assert.equal(deleteByOther.status, 403);
  assert.equal(deleteByOther.body.code, 'PLAN_NOT_YOURS');
  const deleted = await call(A.token, 'DELETE', `${base}/plans/${target.id}`);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

  const listed = await call(A.token, 'GET', `${base}/plans`);
  assert.equal(listed.body.plans.some((plan) => plan.id === target.id), false);
  assert.equal(listed.body.plans.some((plan) => plan.id === direct.id && plan.progressStep === 5), true);
});

test('计划：我能提供的标记/改备注/撤回，不能标自己的计划', async () => {
  const created = await planGroup('计划提供组');
  const base = `/api/collection-groups/${created.id}`;
  const plan = (await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [501] })).body.plans[0];

  const marked = await call(B.token, 'PUT', `${base}/plans/${plan.id}/offers/me`, { note: '我有' });
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  assert.equal(marked.body.offer.offerAccountId, B.accountId);
  assert.equal(marked.body.offer.note, '我有');

  const edited = await call(B.token, 'PUT', `${base}/plans/${plan.id}/offers/me`, { note: '改一下' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.offer.note, '改一下');

  const self = await call(A.token, 'PUT', `${base}/plans/${plan.id}/offers/me`, { note: '' });
  assert.equal(self.status, 409);
  assert.equal(self.body.code, 'PLAN_OFFER_SELF');

  const listed = await call(A.token, 'GET', `${base}/plans`);
  const view = listed.body.plans.find((item) => item.id === plan.id);
  assert.equal(view.offers.length, 1);
  assert.equal(view.offers[0].offerDisplayName, 'B');
  assert.equal(view.offers[0].note, '改一下');

  const withdrawn = await call(B.token, 'DELETE', `${base}/plans/${plan.id}/offers/me`);
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
  const again = await call(B.token, 'DELETE', `${base}/plans/${plan.id}/offers/me`);
  assert.equal(again.status, 404);
  assert.equal(again.body.code, 'PLAN_OFFER_NOT_FOUND');
});

test('计划：「你能补的」只算别人进行中、我发布过的蛋；自己的计划不算', async () => {
  const created = await planGroup('计划匹配组');
  const base = `/api/collection-groups/${created.id}`;

  const bPlan = (await call(B.token, 'POST', `${base}/plans`, { eggGameIds: [601], start: true }))
    .body.plans[0];
  const bBacklog = (await call(B.token, 'POST', `${base}/plans`, { eggGameIds: [602] })).body
    .plans[0];
  assert.equal(bPlan.status, 'active');
  assert.equal(bBacklog.status, 'backlog');

  const published = await call(A.token, 'PUT', `${base}/resources/me`, {
    baseRevision: 0,
    resource: motherDraft([motherAccount(7001, [601, 602])]),
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));

  const listed = await call(A.token, 'GET', `${base}/plans`);
  // 602 只是想收，不算「你能补的」；601 是别人进行中且我发布过
  assert.deepEqual(listed.body.matchableEggIds, [601]);

  const mine = (await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [603], start: true }))
    .body.plans[0];
  assert.equal(mine.status, 'active');
  const listedForB = await call(B.token, 'GET', `${base}/plans`);
  assert.equal(listedForB.body.matchableEggIds.includes(603), false);
});

test('计划：需求全部结单才自动完成，中途撤回不算', async () => {
  const created = await planGroup('计划自动完成组');
  const base = `/api/collection-groups/${created.id}`;
  const plan = (await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [701], start: true }))
    .body.plans[0];

  const published = await call(A.token, 'POST', `${base}/demands`, {
    eggGameId: 701,
    natures: ['胆小', '保守'],
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  const [timid, calm] = published.body.demands;

  const claimTimid = await call(B.token, 'POST', `${base}/demands/701/claim`, {
    demanderAccountId: A.accountId,
    eggGameId: 701,
    nature: '胆小',
    gender: '母',
    body: '大块头',
    voice: '+100',
    version: timid.version,
  });
  assert.equal(claimTimid.status, 200, JSON.stringify(claimTimid.body));
  const completeTimid = await call(A.token, 'POST', `${base}/demands/701/complete`, {
    demanderAccountId: A.accountId,
    eggGameId: 701,
    nature: '胆小',
    gender: '母',
    body: '大块头',
    voice: '+100',
    version: claimTimid.body.demand.version,
  });
  assert.equal(completeTimid.status, 200, JSON.stringify(completeTimid.body));

  // 还有一条「保守」没结单：计划保持进行中
  let listed = await call(A.token, 'GET', `${base}/plans`);
  assert.equal(listed.body.plans.find((item) => item.id === plan.id).status, 'active');

  const claimCalm = await call(C.token, 'POST', `${base}/demands/701/claim`, {
    demanderAccountId: A.accountId,
    eggGameId: 701,
    nature: '保守',
    gender: '母',
    body: '大块头',
    voice: '+100',
    version: calm.version,
  });
  const completeCalm = await call(A.token, 'POST', `${base}/demands/701/complete`, {
    demanderAccountId: A.accountId,
    eggGameId: 701,
    nature: '保守',
    gender: '母',
    body: '大块头',
    voice: '+100',
    version: claimCalm.body.demand.version,
  });
  assert.equal(completeCalm.status, 200, JSON.stringify(completeCalm.body));

  listed = await call(A.token, 'GET', `${base}/plans`);
  const donePlan = listed.body.plans.find((item) => item.id === plan.id);
  assert.equal(donePlan.status, 'done');
  assert.equal(donePlan.progressStep, 5);

  // 撤回不算完成：新计划发需求后撤回，计划仍是进行中
  const withdrawnPlan = (
    await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [702], start: true })
  ).body.plans[0];
  const withdrawDemand = await call(A.token, 'POST', `${base}/demands`, {
    eggGameId: 702,
    natures: [],
  });
  const withdraw = await call(
    A.token,
    'DELETE',
    `${base}/demands/702?nature=&gender=%E6%AF%8D&body=%E5%A4%A7%E5%9D%97%E5%A4%B4&voice=%2B100`,
  );
  assert.equal(withdraw.status, 200, JSON.stringify(withdraw.body));
  listed = await call(A.token, 'GET', `${base}/plans`);
  assert.equal(listed.body.plans.find((item) => item.id === withdrawnPlan.id).status, 'active');
});

test('计划：认领人标记已上窝后，发布人看到「待我确认」(4)、组员看到「已上窝」(3)，且不泄露游戏账号', async () => {
  const created = await planGroup('计划上窝组');
  const base = `/api/collection-groups/${created.id}`;
  const plan = (await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [801], start: true }))
    .body.plans[0];
  const published = await call(A.token, 'POST', `${base}/demands`, {
    eggGameId: 801,
    natures: [],
  });
  const demand = published.body.demands[0];

  const claim = await call(B.token, 'POST', `${base}/demands/801/claim`, {
    demanderAccountId: A.accountId,
    eggGameId: 801,
    nature: '',
    gender: '母',
    body: '大块头',
    voice: '+100',
    version: demand.version,
  });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));

  const criteria = {
    demanderAccountId: A.accountId,
    eggGameId: 801,
    nature: '',
    gender: '母',
    body: '大块头',
    voice: '+100',
  };
  // 非接单人不能标记
  const notClaimer = await call(C.token, 'POST', `${base}/demands/801/placement`, {
    ...criteria,
    accountKey: 'uid:9001',
  });
  assert.equal(notClaimer.status, 403);
  assert.equal(notClaimer.body.code, 'DEMAND_NOT_YOURS');

  const placed = await call(B.token, 'POST', `${base}/demands/801/placement`, {
    ...criteria,
    accountKey: 'uid:9001',
  });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  assert.ok(placed.body.demand.placedAt > 0);
  assert.equal('placedByAccountKey' in placed.body.demand, false);

  // 发布人视角：有人上窝 → 第 4 步「待我确认」
  const publisherList = await call(A.token, 'GET', `${base}/plans`);
  const publisherView = publisherList.body.plans.find((item) => item.id === plan.id);
  assert.equal(publisherView.progressStep, 4);
  assert.equal(publisherView.needsConfirm, true);
  assert.ok(publisherView.demands[0].placedAt > 0);

  // 组员视角：只看到第 3 步「已上窝」，不会被推到「待我确认」
  const memberList = await call(C.token, 'GET', `${base}/plans`);
  const memberView = memberList.body.plans.find((item) => item.id === plan.id);
  assert.equal(memberView.progressStep, 3);
  assert.equal(memberView.needsConfirm, false);
  assert.ok(memberView.demands[0].placedAt > 0);
  assert.equal(JSON.stringify(memberList.body).includes('uid:9001'), false);
});

test('回归：计划的增删改与退出小组都不影响历史结单数据与旧接口结构', async () => {
  const created = await planGroup('历史数据保护组');
  const base = `/api/collection-groups/${created.id}`;

  // 先造历史结单：B 发两条需求，A 全部接单并结单 → 归档 2 条
  const published = await call(B.token, 'POST', `${base}/demands`, {
    eggGameId: 901,
    natures: ['胆小', '保守'],
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  for (const demand of published.body.demands) {
    const claim = await call(A.token, 'POST', `${base}/demands/901/claim`, {
      demanderAccountId: B.accountId,
      eggGameId: 901,
      nature: demand.nature,
      gender: '母',
      body: '大块头',
      voice: '+100',
      version: demand.version,
    });
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
    const done = await call(A.token, 'POST', `${base}/demands/901/complete`, {
      demanderAccountId: B.accountId,
      eggGameId: 901,
      nature: demand.nature,
      gender: '母',
      body: '大块头',
      voice: '+100',
      version: claim.body.demand.version,
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
  }

  const before = await call(A.token, 'GET', `${base}/demands`);
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.equal(before.body.completedCounts[A.accountId], 2);
  assert.equal(before.body.myRecentCompleted.length, 2);
  assert.equal(before.body.demands.length, 0);

  // 旧客户端依赖的字段仍在；新增的 placedAt 只是可空字段
  const shape = before.body.myRecentCompleted[0];
  for (const key of [
    'groupId',
    'demanderAccountId',
    'eggGameId',
    'nature',
    'gender',
    'body',
    'voice',
    'status',
    'claimerAccountId',
    'version',
    'createdAt',
    'updatedAt',
  ]) {
    assert.ok(key in shape, `旧字段 ${key} 不应消失`);
  }
  assert.equal('placedByAccountKey' in shape, false);

  // 计划的各种操作：创建、开始、完成、被标记、删除（含级联清标记）
  const keep = (await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [901], start: true }))
    .body.plans[0];
  const remove = (await call(A.token, 'POST', `${base}/plans`, { eggGameIds: [902] })).body
    .plans[0];
  const complete = await call(A.token, 'POST', `${base}/plans/${keep.id}/complete`);
  assert.equal(complete.status, 200);
  const offer = await call(B.token, 'PUT', `${base}/plans/${remove.id}/offers/me`, {
    note: '我能给',
  });
  assert.equal(offer.status, 200);
  const removed = await call(A.token, 'DELETE', `${base}/plans/${remove.id}`);
  assert.equal(removed.status, 200);

  const afterPlans = await call(A.token, 'GET', `${base}/demands`);
  assert.deepEqual(afterPlans.body.completedCounts, before.body.completedCounts);
  assert.deepEqual(
    afterPlans.body.myRecentCompleted.map((item) => [item.eggGameId, item.nature]),
    before.body.myRecentCompleted.map((item) => [item.eggGameId, item.nature]),
  );

  // 退出小组：只清理成员的计划与进行中需求，历史归档保留
  const left = await call(B.token, 'DELETE', `${base}/members/me`);
  assert.equal(left.status, 200, JSON.stringify(left.body));
  const afterLeave = await call(A.token, 'GET', `${base}/demands`);
  assert.equal(afterLeave.body.completedCounts[A.accountId], 2);
  assert.equal(afterLeave.body.myRecentCompleted.length, 2);
  const plansAfterLeave = await call(A.token, 'GET', `${base}/plans`);
  assert.equal(plansAfterLeave.body.plans.some((plan) => plan.id === keep.id), true);
});
