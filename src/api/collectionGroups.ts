/**
 * 小组收集二期：`/api/collection-groups` 客户端。
 *
 * 与一期 `motherGroups.ts` 相同的严格解析口径：响应必须逐字段校验，
 * 不把非法响应 `as` 成组数据；失败抛 `MotherGroupsApiError`（带 status/code/retryAfter）。
 */
import {
  isMotherApiErrorCode,
  isProductionLineGrade,
  type MotherResourceDraft,
  type PublishedMotherResource,
  type SharedMotherAccount,
  type SharedProductionLine,
} from '../shared/motherGroups';
import {
  DEFAULT_DEMAND_BODY,
  DEFAULT_DEMAND_GENDER,
  DEFAULT_DEMAND_VOICE,
  MOTHER_TARGET_BODIES,
  isCollectionGroupType,
  isDemandBody,
  isDemandGender,
  isDemandVoice,
  isTargetGrade,
  isTargetMode,
  motherCriteriaIdOf,
  type CollectionDemand,
  type CollectionDemandFeed,
  type CollectionDemandStatus,
  type CollectionGroupDetail,
  type CollectionGroupInfo,
  type CollectionGroupMember,
  type CollectionGroupSummary,
  type CollectionGroupType,
  type CollectionTargetGrade,
  type CollectionTargetMode,
  type CollectionTaskRecord,
  type CollectionTaskStatus,
  type DemandBody,
  type DemandGender,
  type DemandVoice,
  type GroupTargetConfig,
  type MotherTargetConfig,
  type PublishedStudResource,
  type SharedStudAccount,
  type StudResourceDraft,
  type StudSlotCoverage,
  type StudTargetConfig,
} from '../shared/collectionGroups';
import {
  trackDemandClaim,
  trackDemandComplete,
  trackDemandPublish,
  trackDemandWithdraw,
  trackGroupJoin,
  trackOfferMark,
  trackPlanCreate,
  trackPlanImport,
  trackPlanStart,
} from './analytics';
import {
  PLAN_STATUSES,
  type CollectionPlan,
  type PlanOffer,
  type PlanProgressStep,
  type PlanStatus,
} from '../shared/collectionPlans';
import { MotherGroupsApiError } from './motherGroups';
import { authFetch } from './session';

const bad = (message: string): never => {
  throw new MotherGroupsApiError(200, 'INVALID_RESPONSE', message);
};

const asRecord = (value: unknown, field: string): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : bad(`${field} 不是对象`);

const asString = (value: unknown, field: string): string =>
  typeof value === 'string' ? value : bad(`${field} 不是字符串`);

const asNumber = (value: unknown, field: string): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : bad(`${field} 不是数字`);

const asArray = (value: unknown, field: string): unknown[] =>
  Array.isArray(value) ? value : bad(`${field} 不是数组`);

const parseProductionLine = (value: unknown, field: string): SharedProductionLine => {
  const record = asRecord(value, field);
  const grade = asString(record.grade, `${field}.grade`);
  if (!isProductionLineGrade(grade)) bad(`${field}.grade 不受支持`);
  return {
    eggGameId: asNumber(record.eggGameId, `${field}.eggGameId`),
    grade: grade as SharedProductionLine['grade'],
    natures: asArray(record.natures, `${field}.natures`).map((nature, index) =>
      asString(nature, `${field}.natures[${index}]`),
    ),
  };
};

const asGroupType = (value: unknown): CollectionGroupType => {
  if (!isCollectionGroupType(value)) bad('groupType 不受支持');
  return value as CollectionGroupType;
};

const asTargetMode = (value: unknown): CollectionTargetMode => {
  if (!isTargetMode(value)) bad('mode 不受支持');
  return value as CollectionTargetMode;
};

const retryAfterOf = (header: string | null): number | null => {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
};

/** 响应体开头（压成一行、截断）：解析失败时带进文案，方便定位是谁换了响应（2026-11-01） */
const snippetOf = (text: string): string => {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '空';
  return compact.length > 60 ? `${compact.slice(0, 60)}…` : compact;
};

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await authFetch(path, init);
  const text = await response.text().catch(() => '');
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    const code = isMotherApiErrorCode(record.code) ? record.code : 'HTTP_ERROR';
    const message = typeof record.error === 'string' ? record.error : `请求失败（${response.status}）`;
    throw new MotherGroupsApiError(
      response.status,
      code,
      message,
      retryAfterOf(response.headers.get('Retry-After')),
    );
  }
  // 2xx 却不是 JSON 对象（HTML 回退页 / 空 body / 数组）时，把「哪条请求、拿到了什么」写进文案
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    const method = (init.method ?? 'GET').toUpperCase();
    const type = response.headers.get('Content-Type') ?? '未知类型';
    throw new MotherGroupsApiError(
      200,
      'INVALID_RESPONSE',
      `响应不是接口数据（${method} ${path} → ${response.status} ${type}，开头：${snippetOf(text)}）；请刷新页面重试`,
    );
  }
  return data;
}

const jsonInit = (method: string, body?: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  ...(signal ? { signal } : {}),
});

function parseTarget(value: unknown): GroupTargetConfig | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value, 'target');
  const mode = asTargetMode(record.mode);
  const catalogVersion = asString(record.catalogVersion, 'target.catalogVersion');
  if (record.kind === 'mother') {
    const bodies = asArray(record.bodies, 'target.bodies').map((item, index) =>
      asString(item, `target.bodies[${index}]`),
    );
    const voices = asArray(record.voices, 'target.voices').map((item, index) =>
      asString(item, `target.voices[${index}]`),
    );
    const requireRecommendedNatures = record.requireRecommendedNatures === true;
    const natureOverrides =
      record.natureOverrides &&
      typeof record.natureOverrides === 'object' &&
      !Array.isArray(record.natureOverrides)
        ? (record.natureOverrides as Record<string, string[]>)
        : undefined;
    const target: MotherTargetConfig = {
      kind: 'mother',
      // 兜底也不能拿资源口径常量：组目标是旧命名空间，与 all-mothers-v3-* 不是一回事（R2-7-L07）
      criteriaId:
        typeof record.criteriaId === 'string'
          ? record.criteriaId
          : motherCriteriaIdOf({ mode, bodies, voices, requireRecommendedNatures, natureOverrides }),
      mode,
      bodies: bodies.filter((body) => (MOTHER_TARGET_BODIES as readonly string[]).includes(body)),
      voices,
      catalogVersion,
      ...(requireRecommendedNatures ? { requireRecommendedNatures: true } : {}),
      ...(natureOverrides ? { natureOverrides } : {}),
    };
    return target;
  }
  if (record.kind === 'stud') {
    const slots = asArray(record.slots, 'target.slots').map((item, index) => {
      const slot = asRecord(item, `target.slots[${index}]`);
      if (!isTargetGrade(slot.grade)) bad(`target.slots[${index}].grade 不受支持`);
      const grade = slot.grade as CollectionTargetGrade;
      return {
        groupId: asNumber(slot.groupId, 'slot.groupId'),
        natureId: asNumber(slot.natureId, 'slot.natureId'),
        natureName: asString(slot.natureName, 'slot.natureName'),
        grade,
      };
    });
    const target: StudTargetConfig = { kind: 'stud', mode, catalogVersion, slots };
    return target;
  }
  return bad('target.kind 不受支持');
}

function parseGroupInfo(value: unknown): CollectionGroupInfo {
  const record = asRecord(value, 'group');
  return {
    id: asString(record.id, 'id'),
    name: asString(record.name, 'name'),
    ownerAccountId: asString(record.ownerAccountId, 'ownerAccountId'),
    createdAt: asNumber(record.createdAt, 'createdAt'),
    groupType: asGroupType(record.groupType),
    targetRevision: asNumber(record.targetRevision, 'targetRevision'),
    resourceEpoch: asNumber(record.resourceEpoch, 'resourceEpoch'),
    target: parseTarget(record.target),
  };
}

function parseSummary(value: unknown): CollectionGroupSummary {
  const record = asRecord(value, 'group');
  return {
    id: asString(record.id, 'id'),
    name: asString(record.name, 'name'),
    ownerAccountId: asString(record.ownerAccountId, 'ownerAccountId'),
    memberCount: asNumber(record.memberCount, 'memberCount'),
    groupType: asGroupType(record.groupType),
    targetRevision: asNumber(record.targetRevision, 'targetRevision'),
    targetReady: record.targetReady === true,
  };
}

function parseMotherResource(value: unknown): PublishedMotherResource | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value, 'resource');
  const accounts: SharedMotherAccount[] = asArray(record.accounts, 'resource.accounts').map(
    (item, index) => {
      const account = asRecord(item, `accounts[${index}]`);
      return {
        accountKey: asString(account.accountKey, 'accountKey'),
        accountName: asString(account.accountName, 'accountName'),
        sourceExportedAt: asString(account.sourceExportedAt, 'sourceExportedAt'),
        eggGameIds: asArray(account.eggGameIds, 'eggGameIds').map((id, idIndex) =>
          asNumber(id, `eggGameIds[${idIndex}]`),
        ),
        // 产线必须原样保留：丢掉它会让本地预览永远认为「线上没有产线」，
        // 于是每次打开都提示「本地数据有变化」（2026-10-28）。
        lines: Array.isArray(account.lines)
          ? (account.lines as unknown[]).map((line, lineIndex) =>
              parseProductionLine(line, `lines[${lineIndex}]`),
            )
          : undefined,
      };
    },
  );
  return {
    schemaVersion: 1,
    criteriaId: asString(record.criteriaId, 'criteriaId') as PublishedMotherResource['criteriaId'],
    catalogVersion: asString(record.catalogVersion, 'catalogVersion'),
    accounts,
    revision: asNumber(record.revision, 'revision'),
    publishedAt: asNumber(record.publishedAt, 'publishedAt'),
  };
}

function parseStudResource(value: unknown): PublishedStudResource | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value, 'studResource');
  if (record.kind !== 'stud') bad('studResource.kind 不受支持');
  const mode = asTargetMode(record.mode);
  const accounts: SharedStudAccount[] = asArray(record.accounts, 'studResource.accounts').map(
    (item, index) => {
      const account = asRecord(item, `studAccounts[${index}]`);
      const slots = (field: 'covered' | 'breedable'): StudSlotCoverage[] =>
        asArray(account[field], `studAccounts[${index}].${field}`).map((slotValue) => {
          const slot = asRecord(slotValue, 'slot');
          if (!isTargetGrade(slot.grade)) bad('slot.grade 不受支持');
          const grade = slot.grade as CollectionTargetGrade;
          return {
            groupId: asNumber(slot.groupId, 'slot.groupId'),
            natureId: asNumber(slot.natureId, 'slot.natureId'),
            grade,
            gameId: asNumber(slot.gameId, 'slot.gameId'),
          };
        });
      return {
        accountKey: asString(account.accountKey, 'accountKey'),
        accountName: asString(account.accountName, 'accountName'),
        sourceExportedAt: asString(account.sourceExportedAt, 'sourceExportedAt'),
        covered: slots('covered'),
        breedable: slots('breedable'),
      };
    },
  );
  return {
    schemaVersion: 1,
    kind: 'stud',
    mode,
    catalogVersion: asString(record.catalogVersion, 'catalogVersion'),
    targetId: asString(record.targetId, 'targetId'),
    targetRevision: asNumber(record.targetRevision, 'targetRevision'),
    accounts,
    revision: asNumber(record.revision, 'revision'),
    publishedAt: asNumber(record.publishedAt, 'publishedAt'),
  };
}

function parseMember(value: unknown): CollectionGroupMember {
  const record = asRecord(value, 'member');
  return {
    accountId: asString(record.accountId, 'accountId'),
    displayName: asString(record.displayName, 'displayName'),
    joinedAt: asNumber(record.joinedAt, 'joinedAt'),
    resourceRevision: asNumber(record.resourceRevision, 'resourceRevision'),
    resource: parseMotherResource(record.resource),
    studResource: parseStudResource(record.studResource),
  };
}

function parseDetail(data: unknown): CollectionGroupDetail {
  const record = asRecord(data, '响应');
  return {
    group: parseGroupInfo(record.group),
    members: asArray(record.members, 'members').map(parseMember),
  };
}

export async function listCollectionGroups(signal?: AbortSignal): Promise<CollectionGroupSummary[]> {
  const data = asRecord(await request('/api/collection-groups', jsonInit('GET', undefined, signal)), '响应');
  return asArray(data.groups, 'groups').map(parseSummary);
}

export async function createCollectionGroup(
  input: { name: string; displayName: string; groupType: CollectionGroupType; target?: GroupTargetConfig },
  signal?: AbortSignal,
): Promise<{ group: CollectionGroupInfo; inviteCode: string }> {
  const data = asRecord(
    await request('/api/collection-groups', jsonInit('POST', input, signal)),
    '响应',
  );
  return { group: parseGroupInfo(data.group), inviteCode: asString(data.inviteCode, 'inviteCode') };
}

export async function joinCollectionGroup(
  input: { inviteCode: string; displayName: string },
  signal?: AbortSignal,
): Promise<{ groupId: string; groupType: CollectionGroupType }> {
  const data = asRecord(
    await request('/api/collection-groups/join', jsonInit('POST', input, signal)),
    '响应',
  );
  const result = {
    groupId: asString(data.groupId, 'groupId'),
    groupType: asGroupType(data.groupType),
  };
  trackGroupJoin();
  return result;
}

export interface InvitePreview {
  name: string;
  groupType: CollectionGroupType;
  targetRevision: number;
  targetReady: boolean;
  target: GroupTargetConfig | null;
}

export async function previewCollectionInvite(
  inviteCode: string,
  signal?: AbortSignal,
): Promise<InvitePreview> {
  const data = asRecord(
    await request(
      '/api/collection-groups/invite/preview',
      jsonInit('POST', { inviteCode }, signal),
    ),
    '响应',
  );
  if (!isCollectionGroupType(data.groupType)) bad('groupType 不受支持');
  return {
    name: asString(data.name, 'name'),
    groupType: asGroupType(data.groupType),
    targetRevision: asNumber(data.targetRevision, 'targetRevision'),
    targetReady: data.targetReady === true,
    target: parseTarget(data.target),
  };
}

export async function getCollectionGroup(
  groupId: string,
  signal?: AbortSignal,
): Promise<CollectionGroupDetail> {
  return parseDetail(
    await request(`/api/collection-groups/${encodeURIComponent(groupId)}`, jsonInit('GET', undefined, signal)),
  );
}

/**
 * 轻量版本号（2026-10-31）：轮询先拿这一小段，只有真变了才去拉整包详情 / 需求 / 任务。
 * 老服务端没有这个接口时会 404，调用方据此退回「整包轮询」。
 */
export interface CollectionGroupVersion {
  detail: string;
  demands: string;
  tasks: string;
}

export async function getCollectionGroupVersion(
  groupId: string,
  signal?: AbortSignal,
): Promise<CollectionGroupVersion> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/version`,
      jsonInit('GET', undefined, signal),
    ),
    '响应',
  );
  return {
    detail: asString(data.detail, 'detail'),
    demands: asString(data.demands, 'demands'),
    tasks: asString(data.tasks, 'tasks'),
  };
}

export async function publishCollectionResources(
  groupId: string,
  input: {
    baseRevision: number;
    baseTargetRevision: number;
    resource: MotherResourceDraft | StudResourceDraft;
  },
  signal?: AbortSignal,
): Promise<{ resourceRevision: number; publishedAt: number | null }> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/resources/me`,
      jsonInit('PUT', input, signal),
    ),
    '响应',
  );
  return {
    resourceRevision: asNumber(data.resourceRevision, 'resourceRevision'),
    publishedAt: data.publishedAt === null ? null : asNumber(data.publishedAt, 'publishedAt'),
  };
}

export async function updateCollectionTarget(
  groupId: string,
  input: { baseTargetRevision: number; target: GroupTargetConfig },
  signal?: AbortSignal,
): Promise<{ targetRevision: number }> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/target`,
      jsonInit('PUT', input, signal),
    ),
    '响应',
  );
  return { targetRevision: asNumber(data.targetRevision, 'targetRevision') };
}

function parseTask(value: unknown): CollectionTaskRecord {
  const record = asRecord(value, 'task');
  const status = record.status;
  if (status !== 'open' && status !== 'claimed' && status !== 'closed') {
    bad('task.status 不受支持');
  }
  const owner = record.ownerAccountId;
  return {
    groupId: asString(record.groupId, 'groupId'),
    targetRevision: asNumber(record.targetRevision, 'targetRevision'),
    targetKey: asString(record.targetKey, 'targetKey'),
    round: asNumber(record.round, 'round'),
    status: status as CollectionTaskStatus,
    ownerAccountId: owner === null || owner === undefined ? null : asString(owner, 'ownerAccountId'),
    version: asNumber(record.version, 'version'),
    updatedAt: asNumber(record.updatedAt, 'updatedAt'),
    closedAt: record.closedAt === null ? null : asNumber(record.closedAt, 'closedAt'),
  };
}

export interface CollectionTasksResponse {
  targetRevision: number;
  confirmed: boolean;
  pendingMemberIds: string[];
  tasks: CollectionTaskRecord[];
}

export async function getCollectionTasks(
  groupId: string,
  signal?: AbortSignal,
): Promise<CollectionTasksResponse> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/tasks`,
      jsonInit('GET', undefined, signal),
    ),
    '响应',
  );
  return {
    targetRevision: asNumber(data.targetRevision, 'targetRevision'),
    confirmed: data.confirmed === true,
    pendingMemberIds: asArray(data.pendingMemberIds, 'pendingMemberIds').map((item, index) =>
      asString(item, `pendingMemberIds[${index}]`),
    ),
    tasks: asArray(data.tasks, 'tasks').map(parseTask),
  };
}

async function taskAction(
  groupId: string,
  action: 'claim' | 'release' | 'transfer',
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CollectionTaskRecord> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/tasks/${action}`,
      jsonInit('POST', body, signal),
    ),
    '响应',
  );
  return parseTask(data.task);
}

export const claimCollectionTask = (
  groupId: string,
  input: { targetKey: string; version?: number },
  signal?: AbortSignal,
) => taskAction(groupId, 'claim', input, signal);

export const releaseCollectionTask = (
  groupId: string,
  input: { targetKey: string; version?: number },
  signal?: AbortSignal,
) => taskAction(groupId, 'release', input, signal);

export const transferCollectionTask = (
  groupId: string,
  input: { targetKey: string; toAccountId: string; version?: number },
  signal?: AbortSignal,
) => taskAction(groupId, 'transfer', input, signal);

/* ---------- 需求承接（2026-10-26） ---------- */

function parseDemand(value: unknown): CollectionDemand {
  const record = asRecord(value, 'demand');
  const status = record.status;
  if (status !== 'open' && status !== 'claimed' && status !== 'done') {
    bad('demand.status 不受支持');
  }
  const claimer = record.claimerAccountId;
  const gender = record.gender ?? DEFAULT_DEMAND_GENDER;
  const body = record.body ?? DEFAULT_DEMAND_BODY;
  const voice = record.voice ?? DEFAULT_DEMAND_VOICE;
  if (!isDemandGender(gender)) bad('demand.gender 不受支持');
  if (!isDemandBody(body)) bad('demand.body 不受支持');
  if (!isDemandVoice(voice)) bad('demand.voice 不受支持');
  return {
    groupId: asString(record.groupId, 'groupId'),
    demanderAccountId: asString(record.demanderAccountId, 'demanderAccountId'),
    eggGameId: asNumber(record.eggGameId, 'eggGameId'),
    nature: typeof record.nature === 'string' ? record.nature : bad('demand.nature 必须是字符串'),
    gender: gender as DemandGender,
    body: body as DemandBody,
    voice: voice as DemandVoice,
    status: status as CollectionDemandStatus,
    claimerAccountId:
      claimer === null || claimer === undefined ? null : asString(claimer, 'claimerAccountId'),
    placedAt:
      typeof record.placedAt === 'number' && Number.isFinite(record.placedAt)
        ? record.placedAt
        : null,
    version: asNumber(record.version, 'version'),
    createdAt: asNumber(record.createdAt, 'createdAt'),
    updatedAt: asNumber(record.updatedAt, 'updatedAt'),
    // 老服务端 / 旧记录没有这个字段：按「不要求绿窝」处理（2026-11-01）
    ...(record.requireGreenNest === true ? { requireGreenNest: true } : {}),
  };
}

export async function getCollectionDemands(
  groupId: string,
  signal?: AbortSignal,
): Promise<CollectionDemand[]> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/demands`,
      jsonInit('GET', undefined, signal),
    ),
    '响应',
  );
  return asArray(data.demands, 'demands').map(parseDemand);
}

/**
 * 需求中心的完整数据：未完成列表 + 已结单聚合 + 我的最近完成（2026-11-01）。
 *
 * 旧服务端没有后两个字段时按空处理，界面只是不显示计数 / 回执，不会报错。
 */
export async function getCollectionDemandFeed(
  groupId: string,
  signal?: AbortSignal,
): Promise<CollectionDemandFeed> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/demands`,
      jsonInit('GET', undefined, signal),
    ),
    '响应',
  );
  const rawCounts = asRecord(data.completedCounts ?? {}, 'completedCounts');
  const completedCounts: Record<string, number> = {};
  for (const [accountId, value] of Object.entries(rawCounts)) {
    completedCounts[accountId] = asNumber(value, `completedCounts.${accountId}`);
  }
  return {
    demands: asArray(data.demands, 'demands').map(parseDemand),
    completedCounts,
    myRecentCompleted: asArray(data.myRecentCompleted ?? [], 'myRecentCompleted').map(parseDemand),
  };
}

export interface DemandRequestCriteria {
  nature: string;
  gender: DemandGender;
  body: DemandBody;
  voice: DemandVoice;
}

export async function publishCollectionDemand(
  groupId: string,
  input: {
    eggGameId: number;
    natures: string[];
    gender: DemandGender;
    body: DemandBody;
    voice: DemandVoice;
    /** 要求这对亲本进学院小窝（绿窝）；不传按 false 处理（2026-11-01）。 */
    requireGreenNest?: boolean;
  },
  signal?: AbortSignal,
): Promise<CollectionDemand[]> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/demands`,
      jsonInit('POST', input, signal),
    ),
    '响应',
  );
  const demands = asArray(data.demands, 'demands').map(parseDemand);
  trackDemandPublish(demands.length);
  return demands;
}

export async function withdrawCollectionDemand(
  groupId: string,
  eggGameId: number,
  criteria: DemandRequestCriteria,
  signal?: AbortSignal,
): Promise<void> {
  const params = new URLSearchParams({
    nature: criteria.nature,
    gender: criteria.gender,
    body: criteria.body,
    voice: criteria.voice,
  });
  await request(
    `/api/collection-groups/${encodeURIComponent(groupId)}/demands/${eggGameId}?${params.toString()}`,
    jsonInit('DELETE', undefined, signal),
  );
  trackDemandWithdraw();
}

async function demandAction(
  groupId: string,
  eggGameId: number,
  action: 'claim' | 'release' | 'complete',
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CollectionDemand> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/demands/${eggGameId}/${action}`,
      jsonInit('POST', body, signal),
    ),
    '响应',
  );
  const demand = parseDemand(data.demand);
  // release（放开这单）不算认领，不上报；其余两个动作各记一次
  if (action === 'claim') trackDemandClaim();
  if (action === 'complete') trackDemandComplete();
  return demand;
}

export const claimCollectionDemand = (
  groupId: string,
  input: {
    demanderAccountId: string;
    eggGameId: number;
    nature: string;
    gender: DemandGender;
    body: DemandBody;
    voice: DemandVoice;
    version?: number;
  },
  signal?: AbortSignal,
) => demandAction(groupId, input.eggGameId, 'claim', input, signal);

export const releaseCollectionDemand = (
  groupId: string,
  input: {
    demanderAccountId: string;
    eggGameId: number;
    nature: string;
    gender: DemandGender;
    body: DemandBody;
    voice: DemandVoice;
    version?: number;
  },
  signal?: AbortSignal,
) => demandAction(groupId, input.eggGameId, 'release', input, signal);

export const completeCollectionDemand = (
  groupId: string,
  input: {
    demanderAccountId: string;
    eggGameId: number;
    nature: string;
    gender: DemandGender;
    body: DemandBody;
    voice: DemandVoice;
    version?: number;
  },
  signal?: AbortSignal,
) => demandAction(groupId, input.eggGameId, 'complete', input, signal);

export async function updateCollectionGroupProfile(
  groupId: string,
  displayName: string,
  signal?: AbortSignal,
): Promise<void> {
  await request(
    `/api/collection-groups/${encodeURIComponent(groupId)}/profile/me`,
    jsonInit('PUT', { displayName }, signal),
  );
}
export async function resetCollectionGroupInvite(
  groupId: string,
  signal?: AbortSignal,
): Promise<string> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/invite/reset`,
      jsonInit('POST', undefined, signal),
    ),
    '响应',
  );
  return asString(data.inviteCode, 'inviteCode');
}

export async function leaveCollectionGroup(groupId: string, signal?: AbortSignal): Promise<void> {
  await request(
    `/api/collection-groups/${encodeURIComponent(groupId)}/members/me`,
    jsonInit('DELETE', undefined, signal),
  );
}

/** 组长移除组员：会取消对方未完成的需求，已完成的接单记录保留。 */
export async function removeCollectionGroupMember(
  groupId: string,
  memberAccountId: string,
  signal?: AbortSignal,
): Promise<void> {
  await request(
    `/api/collection-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberAccountId)}`,
    jsonInit('DELETE', undefined, signal),
  );
}

export async function dissolveCollectionGroup(groupId: string, signal?: AbortSignal): Promise<void> {
  await request(`/api/collection-groups/${encodeURIComponent(groupId)}`, jsonInit('DELETE', undefined, signal));
}

/* ---------- 收集计划（2026-11-08） ---------- */

const asPlanStatus = (value: unknown): PlanStatus => {
  if (typeof value !== 'string' || !(PLAN_STATUSES as readonly string[]).includes(value)) {
    bad('plan.status 不受支持');
  }
  return value as PlanStatus;
};

const asProgressStep = (value: unknown): PlanProgressStep => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) {
    bad('plan.progressStep 不受支持');
  }
  return value as PlanProgressStep;
};

function parsePlan(value: unknown): CollectionPlan {
  const record = asRecord(value, 'plan');
  return {
    id: asString(record.id, 'plan.id'),
    groupId: asString(record.groupId, 'plan.groupId'),
    memberAccountId: asString(record.memberAccountId, 'plan.memberAccountId'),
    eggGameId: asNumber(record.eggGameId, 'plan.eggGameId'),
    note: typeof record.note === 'string' ? record.note : bad('plan.note 必须是字符串'),
    status: asPlanStatus(record.status),
    version: asNumber(record.version, 'plan.version'),
    createdAt: asNumber(record.createdAt, 'plan.createdAt'),
    updatedAt: asNumber(record.updatedAt, 'plan.updatedAt'),
  };
}

export interface CollectionPlanDemandView {
  nature: string;
  gender: DemandGender;
  body: DemandBody;
  voice: DemandVoice;
  status: 'open' | 'claimed';
  claimerAccountId: string | null;
  placedAt: number | null;
}

export interface PlanOfferView {
  offerAccountId: string;
  offerDisplayName: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionPlanView extends CollectionPlan {
  memberDisplayName: string;
  /** 0 还没发需求 / 1 待接单 / 2 已认领 / 4 待我确认 / 5 已完成。 */
  progressStep: PlanProgressStep;
  needsConfirm: boolean;
  demands: CollectionPlanDemandView[];
  offers: PlanOfferView[];
}

export interface CollectionPlansResponse {
  plans: CollectionPlanView[];
  members: { accountId: string; displayName: string }[];
  /** 「你能补的」：只给蛋 gameId，展示层再映射图鉴。 */
  matchableEggIds: number[];
  myActiveCount: number;
  maxActivePlans: number;
}

function parsePlanDemand(value: unknown): CollectionPlanDemandView {
  const record = asRecord(value, 'plan.demand');
  const status = record.status;
  if (status !== 'open' && status !== 'claimed') bad('plan.demand.status 不受支持');
  const gender = record.gender;
  const body = record.body;
  const voice = record.voice;
  if (!isDemandGender(gender)) bad('plan.demand.gender 不受支持');
  if (!isDemandBody(body)) bad('plan.demand.body 不受支持');
  if (!isDemandVoice(voice)) bad('plan.demand.voice 不受支持');
  const claimer = record.claimerAccountId;
  return {
    nature: typeof record.nature === 'string' ? record.nature : bad('plan.demand.nature 必须是字符串'),
    gender: gender as DemandGender,
    body: body as DemandBody,
    voice: voice as DemandVoice,
    status: status as 'open' | 'claimed',
    claimerAccountId: claimer == null ? null : asString(claimer, 'plan.demand.claimerAccountId'),
    placedAt:
      typeof record.placedAt === 'number' && Number.isFinite(record.placedAt)
        ? record.placedAt
        : null,
  };
}

function parsePlanView(value: unknown): CollectionPlanView {
  const record = asRecord(value, 'plan');
  return {
    ...parsePlan(record),
    memberDisplayName: asString(record.memberDisplayName, 'plan.memberDisplayName'),
    progressStep: asProgressStep(record.progressStep),
    needsConfirm: record.needsConfirm === true,
    demands: asArray(record.demands ?? [], 'plan.demands').map(parsePlanDemand),
    offers: asArray(record.offers ?? [], 'plan.offers').map((item) => {
      const offer = asRecord(item, 'plan.offer');
      return {
        offerAccountId: asString(offer.offerAccountId, 'plan.offer.offerAccountId'),
        offerDisplayName: asString(offer.offerDisplayName, 'plan.offer.offerDisplayName'),
        note: typeof offer.note === 'string' ? offer.note : bad('plan.offer.note 必须是字符串'),
        createdAt: asNumber(offer.createdAt, 'plan.offer.createdAt'),
        updatedAt: asNumber(offer.updatedAt, 'plan.offer.updatedAt'),
      };
    }),
  };
}

function parsePlanOffer(value: unknown): PlanOffer {
  const record = asRecord(value, 'offer');
  if (record.status !== 'pending') bad('offer.status 不受支持');
  return {
    id: asString(record.id, 'offer.id'),
    groupId: asString(record.groupId, 'offer.groupId'),
    planId: asString(record.planId, 'offer.planId'),
    offerAccountId: asString(record.offerAccountId, 'offer.offerAccountId'),
    note: typeof record.note === 'string' ? record.note : bad('offer.note 必须是字符串'),
    status: 'pending',
    createdAt: asNumber(record.createdAt, 'offer.createdAt'),
    updatedAt: asNumber(record.updatedAt, 'offer.updatedAt'),
  };
}

/** 按组读计划列表：含自己的计划（展示层用 `memberAccountId === 我` 标「我发布的」）。 */
export async function getCollectionPlans(
  groupId: string,
  signal?: AbortSignal,
): Promise<CollectionPlansResponse> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/plans`,
      jsonInit('GET', undefined, signal),
    ),
    '响应',
  );
  return {
    plans: asArray(data.plans, 'plans').map(parsePlanView),
    members: asArray(data.members ?? [], 'members').map((item) => {
      const member = asRecord(item, 'member');
      return {
        accountId: asString(member.accountId, 'member.accountId'),
        displayName: asString(member.displayName, 'member.displayName'),
      };
    }),
    matchableEggIds: asArray(data.matchableEggIds ?? [], 'matchableEggIds').map((id, index) =>
      asNumber(id, `matchableEggIds[${index}]`),
    ),
    myActiveCount: asNumber(data.myActiveCount, 'myActiveCount'),
    maxActivePlans: asNumber(data.maxActivePlans, 'maxActivePlans'),
  };
}

export interface CreatePlansResult {
  plans: CollectionPlan[];
  /** 已存在（任意状态）而跳过的条数。 */
  skipped: number;
  /** 其中已完成的条数。 */
  doneSkipped: number;
  /** 想直接开始但满 8 条、实际落成「想收」的条数。 */
  overflow: number;
  notice: string | null;
}

/**
 * 创建 / 批量导入计划。
 *
 * - 添加想收、批量导入缺口：`start` 不传，全部落「想收」；
 * - `bulk` 只影响埋点（导入 vs 单次添加），不影响落库口径。
 */
export async function createCollectionPlans(
  groupId: string,
  input: { eggGameIds: number[]; note?: string; start?: boolean; bulk?: boolean },
  signal?: AbortSignal,
): Promise<CreatePlansResult> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/plans`,
      jsonInit('POST', input, signal),
    ),
    '响应',
  );
  const plans = asArray(data.plans ?? [], 'plans').map(parsePlan);
  if (input.bulk) trackPlanImport(plans.length);
  else trackPlanCreate(plans.length);
  return {
    plans,
    skipped: asNumber(data.skipped, 'skipped'),
    doneSkipped: asNumber(data.doneSkipped, 'doneSkipped'),
    overflow: asNumber(data.overflow, 'overflow'),
    notice:
      typeof data.notice === 'string' && data.notice.length > 0 ? data.notice : null,
  };
}

/** 开始一条计划；满 8 条时 `overflow = true`、计划仍是「想收」，不抛错。 */
export async function startCollectionPlan(
  groupId: string,
  planId: string,
  signal?: AbortSignal,
): Promise<{ plan: CollectionPlan; overflow: boolean; notice: string | null }> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/plans/${encodeURIComponent(planId)}/start`,
      jsonInit('POST', undefined, signal),
    ),
    '响应',
  );
  const plan = parsePlan(data.plan);
  if (!data.overflow && plan.status === 'active') trackPlanStart();
  return {
    plan,
    overflow: data.overflow === true,
    notice:
      typeof data.notice === 'string' && data.notice.length > 0 ? data.notice : null,
  };
}

/** 完成：想收也能直接完成；已完成重复调用保持幂等。 */
export async function completeCollectionPlan(
  groupId: string,
  planId: string,
  signal?: AbortSignal,
): Promise<CollectionPlan> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/plans/${encodeURIComponent(planId)}/complete`,
      jsonInit('POST', undefined, signal),
    ),
    '响应',
  );
  return parsePlan(data.plan);
}

/** 删除计划：物理删除，服务端连带清掉「我能提供」标记。 */
export async function deleteCollectionPlan(
  groupId: string,
  planId: string,
  signal?: AbortSignal,
): Promise<void> {
  await request(
    `/api/collection-groups/${encodeURIComponent(groupId)}/plans/${encodeURIComponent(planId)}`,
    jsonInit('DELETE', undefined, signal),
  );
}

/** 标记 / 改备注「我能提供」（同一个入口，upsert）。 */
export async function markPlanOffer(
  groupId: string,
  planId: string,
  note = '',
  signal?: AbortSignal,
): Promise<PlanOffer> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/plans/${encodeURIComponent(planId)}/offers/me`,
      jsonInit('PUT', { note }, signal),
    ),
    '响应',
  );
  const offer = parsePlanOffer(data.offer);
  trackOfferMark();
  return offer;
}

/** 撤回「我能提供」。 */
export async function withdrawPlanOffer(
  groupId: string,
  planId: string,
  signal?: AbortSignal,
): Promise<void> {
  await request(
    `/api/collection-groups/${encodeURIComponent(groupId)}/plans/${encodeURIComponent(planId)}/offers/me`,
    jsonInit('DELETE', undefined, signal),
  );
}

export interface DemandPlacementInput {
  demanderAccountId: string;
  eggGameId: number;
  nature: string;
  gender: DemandGender;
  body: DemandBody;
  voice: DemandVoice;
  /** 上窝用的游戏账号标识（uid:<gameId>）；只落库，别人的视图不展示。 */
  accountKey?: string | null;
}

/** 认领人标记「已上窝」：发布人随后看到「已上窝 → 待我确认」。 */
export async function markCollectionDemandPlaced(
  groupId: string,
  input: DemandPlacementInput,
  signal?: AbortSignal,
): Promise<CollectionDemand> {
  const data = asRecord(
    await request(
      `/api/collection-groups/${encodeURIComponent(groupId)}/demands/${input.eggGameId}/placement`,
      jsonInit('POST', input, signal),
    ),
    '响应',
  );
  return parseDemand(data.demand);
}
