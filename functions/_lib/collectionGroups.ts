/**
 * 小组收集二期：统一接口 `/api/collection-groups`。
 *
 * 与旧 `/api/mother-groups` 共用 `mother_groups`、成员与身份服务；
 * 旧接口只读写母本组（见 motherGroups.ts 的类型门禁），本接口同时支持母本组与种公组。
 */
import {
  MotherInputError,
  parseDisplayName,
  parseGroupName,
  parseInviteCode,
  readJsonBody,
} from './motherGroupsValidation';
import {
  parseCollectionCreateBody,
  parseCollectionPublishBody,
  parseTargetUpdateBody,
} from './collectionGroupsValidation';
import {
  claimCollectionTask,
  createCollectionGroup,
  findCollectionGroup,
  joinCollectionGroup,
  leaveCollectionGroup,
  listCollectionGroups,
  listCollectionTasks,
  previewInviteGroup,
  publishMotherResourceToGroup,
  publishStudResource,
  readCollectionGroupDetail,
  releaseCollectionTask,
  transferCollectionTask,
  updateCollectionTarget,
} from './collectionGroupsStore';
import {
  MotherStoreError,
  type MotherStoreErrorCode,
  dissolveGroup,
  isMember,
  resetInvite,
  updateDisplayName,
} from './motherGroupsStore';
import { type Env, authenticate, clientIp, json, newId, rateLimit, sha256Hex } from './util';
import { STUD_RESOURCE_MAX_BODY_BYTES } from '../../src/shared/collectionGroups';

const HOUR = 3_600_000;
const READ_LIMIT = 1800;
const WRITE_LIMIT = 120;
const OWNER_WRITE_LIMIT = 30;
const DELETE_LIMIT = 30;
const IP_PROBE_LIMIT = 120;

const STORE_STATUS: Record<MotherStoreErrorCode, number> = {
  GROUP_NOT_FOUND: 404,
  NOT_MEMBER: 403,
  NOT_OWNER: 403,
  GROUP_FULL: 409,
  REVISION_CONFLICT: 409,
  STALE_SOURCE: 409,
  SOURCE_MISMATCH: 409,
  GAME_ACCOUNT_ALREADY_SHARED: 409,
  OWNER_MUST_DISSOLVE: 409,
  TARGET_CHANGED: 409,
  TARGET_NOT_READY: 409,
  TASK_TAKEN: 409,
  TASK_ALREADY_COVERED: 409,
  TASKS_NOT_CONFIRMED: 409,
  TASK_NOT_FOUND: 404,
  TASK_NOT_YOURS: 403,
};

const failCode = (origin: string | null, status: number, code: string, error: string): Response => {
  const response = json({ ok: false, code, error }, status, origin);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

const okJson = (origin: string | null, data: Record<string, unknown>): Response => {
  const response = json({ ok: true, ...data }, 200, origin);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

async function limited(
  env: Env,
  origin: string | null,
  bucket: string,
  limit: number,
): Promise<Response | null> {
  if (await rateLimit(env, bucket, limit, HOUR)) return null;
  const response = failCode(origin, 429, 'RATE_LIMITED', '太频繁了，稍后再试');
  response.headers.set('Retry-After', '60');
  return response;
}

const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const INVITE_LENGTH = 8;

function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_LENGTH));
  return [...bytes].map((byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join('');
}

const GROUP_ID_MAX = 64;

export async function handleCollectionGroups(
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  try {
    const accountId = await authenticate(request, env);
    if (!accountId) return failCode(origin, 401, 'UNAUTHENTICATED', '未登录');

    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();
    const rest = pathname.split('/').filter(Boolean).slice(2);

    if (rest.length === 0) {
      if (method === 'GET') {
        const readLimited = await limited(env, origin, `cg-read:${accountId}`, READ_LIMIT);
        if (readLimited) return readLimited;
        return okJson(origin, { groups: await listCollectionGroups(env.DB, accountId) });
      }
      if (method === 'POST') return await handleCreate(request, env, origin, accountId);
      return failCode(origin, 404, 'GROUP_NOT_FOUND', '没有这个接口');
    }

    if (rest.length === 1 && rest[0] === 'join' && method === 'POST') {
      return await handleJoin(request, env, origin, accountId);
    }
    if (rest.length === 2 && rest[0] === 'invite' && rest[1] === 'preview' && method === 'POST') {
      return await handlePreviewInvite(request, env, origin, accountId);
    }

    const groupId = rest[0];
    if (!groupId || groupId.length > GROUP_ID_MAX) {
      return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
    }

    if (rest.length === 1) {
      if (method === 'GET') {
        const readLimited = await limited(env, origin, `cg-read:${accountId}`, READ_LIMIT);
        if (readLimited) return readLimited;
        const group = await findCollectionGroup(env.DB, groupId);
        if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
        if (!(await isMember(env.DB, groupId, accountId))) {
          return failCode(origin, 403, 'NOT_MEMBER', '不是该组成员');
        }
        const detail = await readCollectionGroupDetail(env.DB, groupId);
        if (!detail) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
        return okJson(origin, { group: detail.group, members: detail.members });
      }
      if (method === 'DELETE') return await handleDissolve(env, origin, accountId, groupId);
      return failCode(origin, 404, 'GROUP_NOT_FOUND', '没有这个接口');
    }

    if (rest.length === 3 && rest[1] === 'resources' && rest[2] === 'me' && method === 'PUT') {
      return await handlePublish(request, env, origin, accountId, groupId);
    }
    if (rest.length === 2 && rest[1] === 'target' && method === 'PUT') {
      return await handleTargetUpdate(request, env, origin, accountId, groupId);
    }
    if (rest.length === 3 && rest[1] === 'profile' && rest[2] === 'me' && method === 'PUT') {
      return await handleProfile(request, env, origin, accountId, groupId);
    }
    if (rest.length === 3 && rest[1] === 'invite' && rest[2] === 'reset' && method === 'POST') {
      return await handleResetInvite(env, origin, accountId, groupId);
    }
    if (rest.length === 3 && rest[1] === 'members' && rest[2] === 'me' && method === 'DELETE') {
      return await handleLeave(env, origin, accountId, groupId);
    }
    if (rest.length === 2 && rest[1] === 'tasks' && method === 'GET') {
      return await handleTasks(env, origin, accountId, groupId);
    }
    if (
      rest.length === 3 &&
      rest[1] === 'tasks' &&
      ['claim', 'release', 'transfer'].includes(rest[2]) &&
      method === 'POST'
    ) {
      return await handleTaskAction(request, env, origin, accountId, groupId, rest[2]);
    }
    return failCode(origin, 404, 'GROUP_NOT_FOUND', '没有这个接口');
  } catch (error) {
    if (error instanceof MotherInputError) {
      return failCode(
        origin,
        error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400,
        error.code,
        error.message,
      );
    }
    if (error instanceof MotherStoreError) {
      return failCode(origin, STORE_STATUS[error.code], error.code, error.message);
    }
    console.error('collection-groups:', error);
    return failCode(origin, 500, 'INTERNAL', '服务器出错了');
  }
}

async function handleCreate(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
): Promise<Response> {
  const accountLimited = await limited(env, origin, `cg-create:${accountId}`, OWNER_WRITE_LIMIT);
  if (accountLimited) return accountLimited;
  const ipLimited = await limited(env, origin, `cg-create-ip:${clientIp(request)}`, IP_PROBE_LIMIT);
  if (ipLimited) return ipLimited;

  const body = parseCollectionCreateBody(await readJsonBody(request));
  const id = newId();
  const now = Date.now();
  const inviteCode = newInviteCode();
  const group = await createCollectionGroup(env.DB, {
    id,
    ownerAccountId: accountId,
    name: parseGroupName(body.name),
    inviteHash: await sha256Hex(inviteCode),
    displayName: parseDisplayName(body.displayName),
    groupType: body.groupType,
    target: body.target,
    now,
  });
  return okJson(origin, { group, inviteCode });
}

async function handleJoin(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
): Promise<Response> {
  const accountLimited = await limited(env, origin, `cg-join:${accountId}`, OWNER_WRITE_LIMIT);
  if (accountLimited) return accountLimited;
  const ipLimited = await limited(env, origin, `cg-join-ip:${clientIp(request)}`, IP_PROBE_LIMIT);
  if (ipLimited) return ipLimited;

  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const inviteCode = parseInviteCode(body.inviteCode);
  const displayName = parseDisplayName(body.displayName);
  const joined = await joinCollectionGroup(env.DB, {
    accountId,
    displayName,
    inviteHash: await sha256Hex(inviteCode),
    now: Date.now(),
  });
  return okJson(origin, joined);
}

async function handlePreviewInvite(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
): Promise<Response> {
  const ipLimited = await limited(env, origin, `cg-preview-ip:${clientIp(request)}`, IP_PROBE_LIMIT);
  if (ipLimited) return ipLimited;
  const readLimited = await limited(env, origin, `cg-preview:${accountId}`, READ_LIMIT);
  if (readLimited) return readLimited;

  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const inviteCode = parseInviteCode(body.inviteCode);
  const preview = await previewInviteGroup(env.DB, await sha256Hex(inviteCode));
  if (!preview) return failCode(origin, 404, 'GROUP_NOT_FOUND', '邀请码不对或小组已解散');
  return okJson(origin, preview);
}

async function handlePublish(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const writeLimited = await limited(env, origin, `cg-write:${accountId}`, WRITE_LIMIT);
  if (writeLimited) return writeLimited;

  const group = await findCollectionGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (!(await isMember(env.DB, groupId, accountId))) {
    return failCode(origin, 403, 'NOT_MEMBER', '不是该组成员');
  }

  const parsed = parseCollectionPublishBody(
    await readJsonBody(request, STUD_RESOURCE_MAX_BODY_BYTES),
    group.groupType,
  );
  const result =
    group.groupType === 'stud'
      ? await publishStudResource(env.DB, {
          groupId,
          accountId,
          baseRevision: parsed.baseRevision,
          resource: parsed.resource as Parameters<typeof publishStudResource>[1]['resource'],
        })
      : await publishMotherResourceToGroup(env.DB, {
          groupId,
          accountId,
          baseRevision: parsed.baseRevision,
          resource: parsed.resource as Parameters<typeof publishMotherResourceToGroup>[1]['resource'],
        });
  return okJson(origin, {
    resourceRevision: result.resourceRevision,
    publishedAt: result.publishedAt,
  });
}

async function handleTargetUpdate(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const ownerLimited = await limited(env, origin, `cg-owner:${accountId}`, OWNER_WRITE_LIMIT);
  if (ownerLimited) return ownerLimited;

  const group = await findCollectionGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (group.ownerAccountId !== accountId) {
    return failCode(origin, 403, 'NOT_OWNER', '只有组长可以修改本组目标');
  }
  const { baseTargetRevision, target } = parseTargetUpdateBody(
    await readJsonBody(request),
    group.groupType,
  );
  const result = await updateCollectionTarget(env.DB, {
    groupId,
    ownerAccountId: accountId,
    baseTargetRevision,
    target,
    now: Date.now(),
  });
  return okJson(origin, result);
}

async function handleTasks(
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const readLimited = await limited(env, origin, `cg-read:${accountId}`, READ_LIMIT);
  if (readLimited) return readLimited;
  const group = await findCollectionGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (!(await isMember(env.DB, groupId, accountId))) {
    return failCode(origin, 403, 'NOT_MEMBER', '不是该组成员');
  }
  const view = await listCollectionTasks(env.DB, groupId);
  return okJson(origin, { ...view });
}

const parseTaskKey = (body: Record<string, unknown>): string => {
  const key = body.targetKey;
  if (typeof key !== 'string' || key.trim().length === 0 || key.length > 120) {
    throw new MotherInputError('INVALID_INPUT', 'targetKey 无效');
  }
  return key.trim();
};

const parseOptionalVersion = (body: Record<string, unknown>): number | undefined => {
  const version = body.version;
  if (version === undefined || version === null) return undefined;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new MotherInputError('INVALID_INPUT', 'version 必须是非负整数');
  }
  return version;
};

async function handleTaskAction(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
  action: string,
): Promise<Response> {
  const writeLimited = await limited(env, origin, `cg-write:${accountId}`, WRITE_LIMIT);
  if (writeLimited) return writeLimited;
  const group = await findCollectionGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (!(await isMember(env.DB, groupId, accountId))) {
    return failCode(origin, 403, 'NOT_MEMBER', '不是该组成员');
  }
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MotherInputError('INVALID_INPUT', '请求体必须是对象');
  }
  const targetKey = parseTaskKey(body);
  const expectedVersion = parseOptionalVersion(body);

  if (action === 'claim') {
    const task = await claimCollectionTask(env.DB, {
      groupId,
      accountId,
      targetKey,
      expectedVersion,
    });
    return okJson(origin, { task });
  }
  if (action === 'release') {
    const task = await releaseCollectionTask(env.DB, {
      groupId,
      accountId,
      targetKey,
      expectedVersion,
    });
    return okJson(origin, { task });
  }
  const toAccountId = body.toAccountId;
  if (typeof toAccountId !== 'string' || toAccountId.length === 0 || toAccountId.length > 64) {
    throw new MotherInputError('INVALID_INPUT', 'toAccountId 无效');
  }
  const task = await transferCollectionTask(env.DB, {
    groupId,
    actorAccountId: accountId,
    targetKey,
    toAccountId,
    expectedVersion,
  });
  return okJson(origin, { task });
}

async function handleProfile(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const writeLimited = await limited(env, origin, `cg-write:${accountId}`, WRITE_LIMIT);
  if (writeLimited) return writeLimited;

  const group = await findCollectionGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (!(await isMember(env.DB, groupId, accountId))) {
    return failCode(origin, 403, 'NOT_MEMBER', '不是该组成员');
  }
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  await updateDisplayName(env.DB, groupId, accountId, parseDisplayName(body.displayName));
  return okJson(origin, {});
}

async function handleResetInvite(
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const resetLimited = await limited(env, origin, `cg-reset:${accountId}`, OWNER_WRITE_LIMIT);
  if (resetLimited) return resetLimited;

  const group = await findCollectionGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (group.ownerAccountId !== accountId) {
    return failCode(origin, 403, 'NOT_OWNER', '只有组长可以重置邀请码');
  }
  const inviteCode = newInviteCode();
  await resetInvite(env.DB, groupId, accountId, await sha256Hex(inviteCode));
  return okJson(origin, { inviteCode });
}

async function handleLeave(
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const deleteLimited = await limited(env, origin, `cg-delete:${accountId}`, DELETE_LIMIT);
  if (deleteLimited) return deleteLimited;

  const group = await findCollectionGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (group.ownerAccountId === accountId) {
    return failCode(origin, 409, 'OWNER_MUST_DISSOLVE', '组长退出请使用解散小组');
  }
  await leaveCollectionGroup(env.DB, groupId, accountId);
  return okJson(origin, {});
}

async function handleDissolve(
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const deleteLimited = await limited(env, origin, `cg-delete:${accountId}`, DELETE_LIMIT);
  if (deleteLimited) return deleteLimited;

  const group = await findCollectionGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (group.ownerAccountId !== accountId) {
    return failCode(origin, 403, 'NOT_OWNER', '只有组长可以解散小组');
  }
  await dissolveGroup(env.DB, groupId, accountId);
  return okJson(origin, {});
}
