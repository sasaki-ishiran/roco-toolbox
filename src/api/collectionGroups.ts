/**
 * 小组收集二期：`/api/collection-groups` 客户端。
 *
 * 与一期 `motherGroups.ts` 相同的严格解析口径：响应必须逐字段校验，
 * 不把非法响应 `as` 成组数据；失败抛 `MotherGroupsApiError`（带 status/code/retryAfter）。
 */
import {
  MOTHER_CRITERIA_ID,
  type MotherApiErrorCode,
  type MotherResourceDraft,
  type PublishedMotherResource,
  type SharedMotherAccount,
} from '../shared/motherGroups';
import {
  MOTHER_TARGET_BODIES,
  isCollectionGroupType,
  isTargetGrade,
  isTargetMode,
  type CollectionGroupDetail,
  type CollectionGroupInfo,
  type CollectionGroupMember,
  type CollectionGroupSummary,
  type CollectionGroupType,
  type CollectionTargetGrade,
  type CollectionTargetMode,
  type CollectionTaskRecord,
  type CollectionTaskStatus,
  type GroupTargetConfig,
  type MotherTargetConfig,
  type PublishedStudResource,
  type SharedStudAccount,
  type StudResourceDraft,
  type StudSlotCoverage,
  type StudTargetConfig,
} from '../shared/collectionGroups';
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

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await authFetch(path, init);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    const code = typeof record.code === 'string' ? (record.code as MotherApiErrorCode) : 'HTTP_ERROR';
    const message = typeof record.error === 'string' ? record.error : `请求失败（${response.status}）`;
    throw new MotherGroupsApiError(
      response.status,
      code,
      message,
      retryAfterOf(response.headers.get('Retry-After')),
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
    const target: MotherTargetConfig = {
      kind: 'mother',
      criteriaId: typeof record.criteriaId === 'string' ? record.criteriaId : MOTHER_CRITERIA_ID,
      mode,
      bodies: bodies.filter((body) => (MOTHER_TARGET_BODIES as readonly string[]).includes(body)),
      voices,
      catalogVersion,
      ...(record.requireRecommendedNatures === true ? { requireRecommendedNatures: true } : {}),
      ...(record.natureOverrides &&
      typeof record.natureOverrides === 'object' &&
      !Array.isArray(record.natureOverrides)
        ? { natureOverrides: record.natureOverrides as Record<string, string[]> }
        : {}),
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
  return { groupId: asString(data.groupId, 'groupId'), groupType: asGroupType(data.groupType) };
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

export async function dissolveCollectionGroup(groupId: string, signal?: AbortSignal): Promise<void> {
  await request(`/api/collection-groups/${encodeURIComponent(groupId)}`, jsonInit('DELETE', undefined, signal));
}
