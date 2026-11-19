/**
 * 开发预览用的「假后端」：把小组页会用到的 `/api/collection-groups/**` 接口
 * 用一份内存状态实现出来，返回结构与真实服务端一致（客户端解析器会照常严格校验）。
 *
 * 只在 `?mock=group` 的开发预览里生效；生产构建不会包含（见 index.ts 的动态导入）。
 */
import { applyEggAction, type EggWorkflowState } from '../../shared/eggWorkflow';
import type {
  CollectionDemand,
  CollectionGroupDetail,
  CollectionGroupType,
  CollectionTaskRecord,
  DemandBody,
  DemandGender,
  DemandVoice,
  GroupTargetConfig,
} from '../../shared/collectionGroups';
import type { MotherResourceDraft } from '../../shared/motherGroups';
import {
  MOCK_INVITE,
  MOCK_ME,
  createDemandFeed,
  createEggWorkflow,
  createGroupDetail,
  createTasks,
} from './data';

export interface MockGroupState {
  me: string;
  group: CollectionGroupDetail;
  inviteCode: string;
  feed: {
    demands: CollectionDemand[];
    completedCounts: Record<string, number>;
    myRecentCompleted: CollectionDemand[];
  };
  tasks: { targetRevision: number; confirmed: boolean; pendingMemberIds: string[]; tasks: CollectionTaskRecord[] };
  egg: EggWorkflowState;
  /** 换蛋状态版本号：每次改动 +1，客户端靠它判断要不要重拉。 */
  eggVersion: number;
}

export function createMockState(): MockGroupState {
  const group = createGroupDetail();
  return {
    me: MOCK_ME,
    group,
    inviteCode: MOCK_INVITE,
    feed: createDemandFeed(),
    tasks: createTasks(group.group.targetRevision),
    egg: createEggWorkflow(),
    eggVersion: 1,
  };
}

export interface MockReply {
  status: number;
  body: unknown;
}

const ok = (body: unknown = {}): MockReply => ({ status: 200, body });
const fail = (status: number, error: string, code?: string): MockReply => ({
  status,
  body: { error, ...(code ? { code } : {}) },
});

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const summaryOf = (state: MockGroupState) => ({
  id: state.group.group.id,
  name: state.group.group.name,
  ownerAccountId: state.group.group.ownerAccountId,
  memberCount: state.group.members.length,
  groupType: state.group.group.groupType,
  targetRevision: state.group.group.targetRevision,
  targetReady: state.group.group.target !== null,
});

/** 改动之后都走这里：任务里的 targetRevision 跟着走，避免界面读到旧值。 */
const touch = (state: MockGroupState): void => {
  state.tasks = createTasks(state.group.group.targetRevision);
};

function demandOf(state: MockGroupState, eggGameId: number, body: Record<string, unknown>): CollectionDemand | null {
  const demander = (body.demanderAccountId as string | undefined) ?? state.me;
  const nature = typeof body.nature === 'string' ? body.nature : '';
  return (
    state.feed.demands.find(
      (demand) =>
        demand.eggGameId === eggGameId &&
        demand.demanderAccountId === demander &&
        demand.nature === nature,
    ) ?? null
  );
}

function actionDemand(
  state: MockGroupState,
  eggGameId: number,
  action: 'claim' | 'release' | 'complete' | 'placement',
  body: Record<string, unknown>,
): MockReply {
  const demand = demandOf(state, eggGameId, body);
  if (!demand) return fail(404, '需求不存在或已被撤回');
  const now = Date.now();
  if (action === 'claim') {
    if (demand.status !== 'open') return fail(409, '这条需求已经被别人接了');
    demand.status = 'claimed';
    demand.claimerAccountId = state.me;
  } else if (action === 'release') {
    demand.status = 'open';
    demand.claimerAccountId = null;
  } else if (action === 'complete') {
    demand.status = 'done';
    if (demand.claimerAccountId) {
      state.feed.completedCounts[demand.claimerAccountId] =
        (state.feed.completedCounts[demand.claimerAccountId] ?? 0) + 1;
    }
  } else {
    demand.placedAt = now;
  }
  demand.version += 1;
  demand.updatedAt = now;
  return ok({ demand });
}

/** 发布摘要：把草稿原样收下（假数据，不做逐字段校验）。 */
function publishResource(state: MockGroupState, draft: MotherResourceDraft): MockReply {
  const me = state.group.members.find((item) => item.accountId === state.me);
  if (!me) return fail(404, '你不在这个小组里');
  const now = Date.now();
  me.resource = {
    schemaVersion: 1,
    criteriaId: draft.criteriaId,
    catalogVersion: draft.catalogVersion,
    accounts: draft.accounts.map((account) => ({ ...account })),
    revision: (me.resource?.revision ?? 0) + 1,
    publishedAt: now,
  };
  me.resourceRevision = me.resource.revision;
  state.group.group.resourceEpoch += 1;
  return ok({ resourceRevision: me.resource.revision, publishedAt: now });
}

export function handleMockApi(
  pathname: string,
  method: string,
  rawBody: unknown,
  state: MockGroupState,
): MockReply | null {
  const body = asRecord(rawBody);

  if (pathname === '/api/me' && method === 'GET') {
    return ok({ accountId: state.me, createdAt: Date.now() - 86_400_000, username: 'mock', snapshot: null });
  }
  if (pathname === '/api/event') return { status: 204, body: null };

  /* ---------- 小组列表 / 新建 / 加入 / 邀请预览 ---------- */
  if (pathname === '/api/collection-groups' && method === 'GET') {
    return ok({ groups: [summaryOf(state)] });
  }
  if (pathname === '/api/collection-groups' && method === 'POST') {
    const groupType = (body.groupType as CollectionGroupType | undefined) ?? 'mother';
    state.group = {
      group: {
        ...state.group.group,
        id: `mock-${Date.now()}`,
        name: String(body.name ?? '新建小组'),
        ownerAccountId: state.me,
        groupType,
        targetRevision: 1,
      },
      members: [
        {
          accountId: state.me,
          displayName: String(body.displayName ?? '我'),
          joinedAt: Date.now(),
          resourceRevision: 0,
          resource: null,
          studResource: null,
        },
      ],
    };
    state.inviteCode = String(body.inviteCode ?? MOCK_INVITE);
    state.feed = createDemandFeed();
    state.egg = createEggWorkflow();
    state.eggVersion += 1;
    touch(state);
    return ok({ group: state.group.group, inviteCode: state.inviteCode });
  }
  if (pathname === '/api/collection-groups/join' && method === 'POST') {
    const exists = state.group.members.some((item) => item.accountId === state.me);
    if (!exists) {
      state.group.members.push({
        accountId: state.me,
        displayName: String(body.displayName ?? '我'),
        joinedAt: Date.now(),
        resourceRevision: 0,
        resource: null,
        studResource: null,
      });
    }
    touch(state);
    return ok({ groupId: state.group.group.id, groupType: state.group.group.groupType });
  }
  if (pathname === '/api/collection-groups/invite/preview' && method === 'POST') {
    const code = String(body.inviteCode ?? '').trim().toUpperCase();
    if (code !== state.inviteCode) return fail(404, '邀请码不对或小组已解散');
    return ok({
      name: state.group.group.name,
      groupType: state.group.group.groupType,
      targetRevision: state.group.group.targetRevision,
      targetReady: state.group.group.target !== null,
      target: state.group.group.target,
    });
  }

  /* ---------- 单个小组 ---------- */
  const groupMatch = pathname.match(/^\/api\/collection-groups\/([^/]+)(?:\/(.+))?$/);
  if (!groupMatch) return null;
  const groupId = decodeURIComponent(groupMatch[1]);
  const rest = groupMatch[2] ?? '';
  if (groupId !== state.group.group.id) return fail(404, '小组不存在或你不在组里');

  if (rest === '' && method === 'GET') return ok(state.group);
  if (rest === '' && method === 'DELETE') {
    state.group.members = state.group.members.filter((item) => item.accountId !== state.me);
    return { status: 204, body: null };
  }
  if (rest === 'version' && method === 'GET') {
    return ok({
      detail: `d${state.group.group.resourceEpoch}-${state.group.group.targetRevision}-${state.group.members.length}`,
      demands: `q${state.eggVersion}`,
      tasks: `t${state.group.group.targetRevision}`,
    });
  }
  if (rest === 'resources/me' && method === 'PUT') {
    const draft = body.resource as MotherResourceDraft | undefined;
    if (!draft || !Array.isArray(draft.accounts)) return fail(400, '摘要格式不对');
    return publishResource(state, draft);
  }
  if (rest === 'target' && method === 'PUT') {
    const target = body.target as GroupTargetConfig | undefined;
    if (!target) return fail(400, '目标格式不对');
    state.group.group.target = target;
    state.group.group.targetRevision += 1;
    touch(state);
    return ok({ targetRevision: state.group.group.targetRevision });
  }
  if (rest === 'tasks' && method === 'GET') return ok(state.tasks);
  const taskMatch = rest.match(/^tasks\/(claim|release|transfer)$/);
  if (taskMatch) {
    const task: CollectionTaskRecord | undefined = state.tasks.tasks[0];
    // 预览数据没有认领任务：动作接口照常返回 404，界面会显示可读的错误。
    return task ? ok({ task }) : fail(404, '任务不存在（预览数据没有任务）');
  }
  if (rest === 'demands' && method === 'GET') return ok(state.feed);
  if (rest === 'demands' && method === 'POST') {
    const eggGameId = Number(body.eggGameId);
    const natures = Array.isArray(body.natures) ? body.natures.map(String) : [];
    const gender = body.gender as DemandGender;
    const demandBody = body.body as DemandBody;
    const voice = body.voice as DemandVoice;
    if (!Number.isSafeInteger(eggGameId) || natures.length === 0) return fail(400, '需求内容不完整');
    const now = Date.now();
    const next: CollectionDemand = {
      groupId: state.group.group.id,
      demanderAccountId: state.me,
      eggGameId,
      nature: natures[0],
      gender,
      body: demandBody,
      voice,
      status: 'open',
      claimerAccountId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...(body.requireGreenNest === true ? { requireGreenNest: true } : {}),
    };
    state.feed.demands = [
      ...state.feed.demands.filter(
        (demand) => !(demand.demanderAccountId === state.me && demand.eggGameId === eggGameId && demand.nature === natures[0]),
      ),
      next,
    ];
    return ok({ demands: state.feed.demands });
  }
  const demandMatch = rest.match(/^demands\/(\d+)(?:\/(claim|release|complete|placement))?$/);
  if (demandMatch) {
    const eggGameId = Number(demandMatch[1]);
    const action = demandMatch[2];
    if (!action && method === 'DELETE') {
      const demand = demandOf(state, eggGameId, body);
      state.feed.demands = state.feed.demands.filter((item) => item !== demand);
      return { status: 204, body: null };
    }
    if (action) return actionDemand(state, eggGameId, action as 'claim' | 'release' | 'complete' | 'placement', body);
  }
  if (rest === 'profile/me' && method === 'PUT') {
    const me = state.group.members.find((item) => item.accountId === state.me);
    if (me) me.displayName = String(body.displayName ?? me.displayName);
    return ok();
  }
  if (rest === 'invite/reset' && method === 'POST') {
    state.inviteCode = `M0CK${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    return ok({ inviteCode: state.inviteCode });
  }
  if (rest === 'members/me' && method === 'DELETE') {
    state.group.members = state.group.members.filter((item) => item.accountId !== state.me);
    touch(state);
    return { status: 204, body: null };
  }
  const memberMatch = rest.match(/^members\/([^/]+)$/);
  if (memberMatch && method === 'DELETE') {
    const target = decodeURIComponent(memberMatch[1]);
    state.group.members = state.group.members.filter((item) => item.accountId !== target);
    state.feed.demands = state.feed.demands.filter((item) => item.demanderAccountId !== target);
    touch(state);
    return { status: 204, body: null };
  }

  /* ---------- 机器人接入（只影响弹窗文案） ---------- */
  if (rest === 'egg-bot') {
    if (method === 'DELETE') return ok({});
    if (method === 'POST') return ok({ code: 'MOCK-DEV1-PREV', expiresAt: Date.now() + 600_000 });
    return ok({ binding: { qqGroupId: '1058200146', updatedAt: Date.now() - 86_400_000 }, quotaUsed: 12 });
  }

  /* ---------- 换蛋（需求中心 / 广场 / 蛋仓 / 我的换蛋） ---------- */
  if (rest === 'egg-matching' && method === 'GET') {
    return ok({ version: state.eggVersion, state: state.egg });
  }
  if (rest === 'egg-matching' && method === 'POST') {
    const baseVersion = Number(body.baseVersion);
    if (baseVersion !== state.eggVersion) return fail(409, '换蛋数据已变化，正在刷新');
    try {
      state.egg = applyEggAction(state.egg, groupId, state.me, body.action, Date.now());
      state.eggVersion += 1;
      return ok({ version: state.eggVersion, state: state.egg });
    } catch (error) {
      return fail(400, error instanceof Error ? error.message : '操作失败');
    }
  }

  return null;
}

/**
 * 「我」不在成员列表里时补进去（新建 / 加入小组后没有资源的场景）。
 * 组长离开时把组长移交给「我」，避免页面顶部出现一个组外人的名字。
 */
export function ensureSelf(state: MockGroupState): void {
  if (state.group.members.some((item) => item.accountId === state.me)) return;
  state.group.members.push({
    accountId: state.me,
    displayName: '阿岚',
    joinedAt: Date.now(),
    resourceRevision: 0,
    resource: null,
    studResource: null,
  });
  if (!state.group.members.some((item) => item.accountId === state.group.group.ownerAccountId)) {
    state.group.group.ownerAccountId = state.me;
  }
}
