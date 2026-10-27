/**
 * 多人母本共享：认证 API 客户端。
 *
 * 复用 `authFetch()`（自动带 Bearer；401 时清会话），所有请求都返回严格校验过的 DTO，
 * 不把非法响应直接 `as` 成组数据。失败抛 `MotherGroupsApiError`（带 status/code/retryAfter）。
 */
import {
  type MotherApiErrorCode,
  type MotherGroupDetail,
  type MotherGroupInfo,
  type MotherGroupMember,
  type MotherGroupSummary,
  type MotherResourceDraft,
  type PublishedMotherResource,
  type SharedProductionLine,
} from '../shared/motherGroups';
import { authFetch } from './session';

export class MotherGroupsApiError extends Error {
  readonly status: number;
  readonly code: MotherApiErrorCode | 'HTTP_ERROR' | 'INVALID_RESPONSE';
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: MotherApiErrorCode | 'HTTP_ERROR' | 'INVALID_RESPONSE',
    message: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'MotherGroupsApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const isMotherGroupsApiError = (value: unknown): value is MotherGroupsApiError =>
  value instanceof MotherGroupsApiError;

function bad(message: string): never {
  throw new MotherGroupsApiError(200, 'INVALID_RESPONSE', message);
}

const asRecord = (value: unknown, field: string): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : bad(`${field} 不是对象`);

const asString = (value: unknown, field: string): string =>
  typeof value === 'string' ? value : bad(`${field} 不是字符串`);

const asNumber = (value: unknown, field: string): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : bad(`${field} 不是数字`);

const parseProductionLine = (value: unknown, field: string): SharedProductionLine => {
  const record = asRecord(value, field);
  const natures = Array.isArray(record.natures)
    ? (record.natures as unknown[]).map((nature, index) =>
        asString(nature, `${field}.natures[${index}]`),
      )
    : bad(`${field}.natures 不是数组`);
  return {
    eggGameId: asNumber(record.eggGameId, `${field}.eggGameId`),
    grade: asString(record.grade, `${field}.grade`) as SharedProductionLine['grade'],
    natures,
  };
};

function parseResource(value: unknown): PublishedMotherResource | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value, 'resource');
  const accounts = record.accounts;
  if (!Array.isArray(accounts)) bad('resource.accounts 不是数组');
  return {
    schemaVersion: asNumber(record.schemaVersion, 'schemaVersion') as 1,
    criteriaId: asString(record.criteriaId, 'criteriaId') as PublishedMotherResource['criteriaId'],
    catalogVersion: asString(record.catalogVersion, 'catalogVersion'),
    accounts: accounts.map((item, index) => {
      const account = asRecord(item, `accounts[${index}]`);
      return {
        accountKey: asString(account.accountKey, 'accountKey'),
        accountName: asString(account.accountName, 'accountName'),
        sourceExportedAt: asString(account.sourceExportedAt, 'sourceExportedAt'),
        eggGameIds: Array.isArray(account.eggGameIds)
          ? (account.eggGameIds as unknown[]).map((id, idIndex) =>
              asNumber(id, `eggGameIds[${idIndex}]`),
            )
          : bad('eggGameIds 不是数组'),
        lines: Array.isArray(account.lines)
          ? (account.lines as unknown[]).map((line, lineIndex) =>
              parseProductionLine(line, `lines[${lineIndex}]`),
            )
          : undefined,
      };
    }),
    revision: asNumber(record.revision, 'revision'),
    publishedAt: asNumber(record.publishedAt, 'publishedAt'),
  };
}

function parseMember(value: unknown): MotherGroupMember {
  const record = asRecord(value, 'member');
  return {
    accountId: asString(record.accountId, 'accountId'),
    displayName: asString(record.displayName, 'displayName'),
    joinedAt: asNumber(record.joinedAt, 'joinedAt'),
    resourceRevision: asNumber(record.resourceRevision, 'resourceRevision'),
    resource: parseResource(record.resource),
  };
}

function parseGroupInfo(value: unknown): MotherGroupInfo {
  const record = asRecord(value, 'group');
  return {
    id: asString(record.id, 'id'),
    name: asString(record.name, 'name'),
    ownerAccountId: asString(record.ownerAccountId, 'ownerAccountId'),
    createdAt: asNumber(record.createdAt, 'createdAt'),
  };
}

function parseSummary(value: unknown): MotherGroupSummary {
  const record = asRecord(value, 'group');
  return {
    id: asString(record.id, 'id'),
    name: asString(record.name, 'name'),
    ownerAccountId: asString(record.ownerAccountId, 'ownerAccountId'),
    memberCount: asNumber(record.memberCount, 'memberCount'),
  };
}

function parseDetail(data: unknown): MotherGroupDetail {
  const record = asRecord(data, '响应');
  if (!Array.isArray(record.members)) bad('members 不是数组');
  return {
    group: parseGroupInfo(record.group),
    members: (record.members as unknown[]).map(parseMember),
  };
}

const retryAfterOf = (header: string | null): number | null => {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  // HTTP 日期形式（RFC 7231 允许 Retry-After 是日期）
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
};

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await authFetch(path, init);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    const code =
      typeof record.code === 'string' ? (record.code as MotherApiErrorCode) : 'HTTP_ERROR';
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

export async function listMotherGroups(signal?: AbortSignal): Promise<MotherGroupSummary[]> {
  const data = asRecord(await request('/api/mother-groups', jsonInit('GET', undefined, signal)), '响应');
  if (!Array.isArray(data.groups)) bad('groups 不是数组');
  return (data.groups as unknown[]).map(parseSummary);
}

export async function createMotherGroup(
  input: { name: string; displayName: string },
  signal?: AbortSignal,
): Promise<{ group: MotherGroupInfo; inviteCode: string }> {
  const data = asRecord(await request('/api/mother-groups', jsonInit('POST', input, signal)), '响应');
  return {
    group: parseGroupInfo(data.group),
    inviteCode: asString(data.inviteCode, 'inviteCode'),
  };
}

export async function joinMotherGroup(
  input: { inviteCode: string; displayName: string },
  signal?: AbortSignal,
): Promise<string> {
  const data = asRecord(
    await request('/api/mother-groups/join', jsonInit('POST', input, signal)),
    '响应',
  );
  return asString(data.groupId, 'groupId');
}

export async function getMotherGroup(
  groupId: string,
  signal?: AbortSignal,
): Promise<MotherGroupDetail> {
  return parseDetail(await request(`/api/mother-groups/${encodeURIComponent(groupId)}`, jsonInit('GET', undefined, signal)));
}

export async function publishMotherResources(
  groupId: string,
  input: { baseRevision: number; resource: MotherResourceDraft },
  signal?: AbortSignal,
): Promise<{ resourceRevision: number; publishedAt: number | null }> {
  const data = asRecord(
    await request(
      `/api/mother-groups/${encodeURIComponent(groupId)}/resources/me`,
      jsonInit('PUT', input, signal),
    ),
    '响应',
  );
  return {
    resourceRevision: asNumber(data.resourceRevision, 'resourceRevision'),
    publishedAt: data.publishedAt === null ? null : asNumber(data.publishedAt, 'publishedAt'),
  };
}

export async function updateMotherGroupProfile(
  groupId: string,
  displayName: string,
  signal?: AbortSignal,
): Promise<void> {
  await request(
    `/api/mother-groups/${encodeURIComponent(groupId)}/profile/me`,
    jsonInit('PUT', { displayName }, signal),
  );
}

export async function resetMotherGroupInvite(
  groupId: string,
  signal?: AbortSignal,
): Promise<string> {
  const data = asRecord(
    await request(
      `/api/mother-groups/${encodeURIComponent(groupId)}/invite/reset`,
      jsonInit('POST', undefined, signal),
    ),
    '响应',
  );
  return asString(data.inviteCode, 'inviteCode');
}

export async function leaveMotherGroup(groupId: string, signal?: AbortSignal): Promise<void> {
  await request(
    `/api/mother-groups/${encodeURIComponent(groupId)}/members/me`,
    jsonInit('DELETE', undefined, signal),
  );
}

export async function dissolveMotherGroup(groupId: string, signal?: AbortSignal): Promise<void> {
  await request(`/api/mother-groups/${encodeURIComponent(groupId)}`, jsonInit('DELETE', undefined, signal));
}
