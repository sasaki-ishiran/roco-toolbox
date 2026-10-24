/**
 * 多人母本共享：认证、成员权限、限流与 HTTP 错误映射。
 *
 * 所有接口都走 `authenticate()`；写入归属只取 token，正文里的 accountId 不参与。
 * 成功 `{ ok: true, ... }`，失败 `{ ok: false, code, error }`，并统一 `Cache-Control: no-store`。
 */
import {
  MotherInputError,
  parseDisplayName,
  parseGroupName,
  parseInviteCode,
  parsePublishBody,
  readJsonBody,
} from './motherGroupsValidation';
import {
  MotherStoreError,
  type MotherStoreErrorCode,
  createGroup,
  dissolveGroup,
  findGroup,
  isMember,
  joinGroup,
  leaveGroup,
  listGroupsForAccount,
  readMotherGroup,
  resetInvite,
  updateDisplayName,
} from './motherGroupsStore';
import { isMotherGroup, publishMotherResourceToGroup } from './collectionGroupsStore';
import {
  type Env,
  authenticate,
  clientIp,
  json,
  newId,
  rateLimit,
  sha256Hex,
} from './util';

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
};

const failCode = (
  origin: string | null,
  status: number,
  code: string,
  error: string,
): Response => {
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

export async function handleMotherGroups(
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
        const readLimited = await limited(env, origin, `mg-read:${accountId}`, READ_LIMIT);
        if (readLimited) return readLimited;
        return okJson(origin, { groups: await listGroupsForAccount(env.DB, accountId) });
      }
      if (method === 'POST') return await handleCreate(request, env, origin, accountId);
      return failCode(origin, 404, 'GROUP_NOT_FOUND', '没有这个接口');
    }

    if (rest.length === 1 && rest[0] === 'join' && method === 'POST') {
      return await handleJoin(request, env, origin, accountId);
    }

    const groupId = rest[0];
    if (!groupId || groupId.length > GROUP_ID_MAX) {
      return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
    }
    // 旧接口是母本组的窄门：种公组对旧客户端一律当作不存在（不能读、不能写）
    if (!(await isMotherGroup(env.DB, groupId))) {
      return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
    }

    if (rest.length === 1) {
      if (method === 'GET') {
        const readLimited = await limited(env, origin, `mg-read:${accountId}`, READ_LIMIT);
        if (readLimited) return readLimited;
        const group = await findGroup(env.DB, groupId);
        if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
        if (!(await isMember(env.DB, groupId, accountId))) {
          return failCode(origin, 403, 'NOT_MEMBER', '不是该组成员');
        }
        const detail = await readMotherGroup(env.DB, groupId);
        if (!detail) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
        return okJson(origin, { group: detail.group, members: detail.members });
      }
      if (method === 'DELETE') {
        return await handleDissolve(env, origin, accountId, groupId);
      }
      return failCode(origin, 404, 'GROUP_NOT_FOUND', '没有这个接口');
    }

    if (rest.length === 3 && rest[1] === 'resources' && rest[2] === 'me' && method === 'PUT') {
      return await handlePublish(request, env, origin, accountId, groupId);
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
    console.error('mother-groups:', error);
    return failCode(origin, 500, 'INTERNAL', '服务器出错了');
  }
}

async function handleCreate(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
): Promise<Response> {
  const accountLimited = await limited(env, origin, `mg-create:${accountId}`, OWNER_WRITE_LIMIT);
  if (accountLimited) return accountLimited;
  const ipLimited = await limited(env, origin, `mg-create-ip:${clientIp(request)}`, IP_PROBE_LIMIT);
  if (ipLimited) return ipLimited;

  const body = (await readJsonBody(request)) as Record<string, unknown>;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MotherInputError('INVALID_INPUT', '请求体必须是对象');
  }
  const name = parseGroupName(body.name);
  const displayName = parseDisplayName(body.displayName);

  const id = newId();
  const now = Date.now();
  const inviteCode = newInviteCode();
  const group = await createGroup(env.DB, {
    id,
    ownerAccountId: accountId,
    name,
    inviteHash: await sha256Hex(inviteCode),
    displayName,
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
  const accountLimited = await limited(env, origin, `mg-join:${accountId}`, OWNER_WRITE_LIMIT);
  if (accountLimited) return accountLimited;
  const ipLimited = await limited(env, origin, `mg-join-ip:${clientIp(request)}`, IP_PROBE_LIMIT);
  if (ipLimited) return ipLimited;

  const body = (await readJsonBody(request)) as Record<string, unknown>;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MotherInputError('INVALID_INPUT', '请求体必须是对象');
  }
  const inviteCode = parseInviteCode(body.inviteCode);
  const displayName = parseDisplayName(body.displayName);

  const groupId = await joinGroup(env.DB, {
    accountId,
    displayName,
    inviteHash: await sha256Hex(inviteCode),
    now: Date.now(),
  });
  return okJson(origin, { groupId });
}

async function handlePublish(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const writeLimited = await limited(env, origin, `mg-write:${accountId}`, WRITE_LIMIT);
  if (writeLimited) return writeLimited;

  const group = await findGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (!(await isMember(env.DB, groupId, accountId))) {
    return failCode(origin, 403, 'NOT_MEMBER', '不是该组成员');
  }

  const parsed = parsePublishBody(await readJsonBody(request));
  const result = await publishMotherResourceToGroup(env.DB, {
    groupId,
    accountId,
    baseRevision: parsed.baseRevision,
    resource: parsed.resource,
  });
  return okJson(origin, {
    resourceRevision: result.resourceRevision,
    publishedAt: result.publishedAt,
  });
}

async function handleProfile(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const writeLimited = await limited(env, origin, `mg-write:${accountId}`, WRITE_LIMIT);
  if (writeLimited) return writeLimited;

  const group = await findGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (!(await isMember(env.DB, groupId, accountId))) {
    return failCode(origin, 403, 'NOT_MEMBER', '不是该组成员');
  }

  const body = (await readJsonBody(request)) as Record<string, unknown>;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MotherInputError('INVALID_INPUT', '请求体必须是对象');
  }
  const displayName = parseDisplayName(body.displayName);
  await updateDisplayName(env.DB, groupId, accountId, displayName);
  return okJson(origin, {});
}

async function handleResetInvite(
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const resetLimited = await limited(env, origin, `mg-reset:${accountId}`, OWNER_WRITE_LIMIT);
  if (resetLimited) return resetLimited;

  const group = await findGroup(env.DB, groupId);
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
  const deleteLimited = await limited(env, origin, `mg-delete:${accountId}`, DELETE_LIMIT);
  if (deleteLimited) return deleteLimited;

  const group = await findGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (group.ownerAccountId === accountId) {
    return failCode(origin, 409, 'OWNER_MUST_DISSOLVE', '组长退出请使用解散小组');
  }
  await leaveGroup(env.DB, groupId, accountId);
  return okJson(origin, {});
}

async function handleDissolve(
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const deleteLimited = await limited(env, origin, `mg-delete:${accountId}`, DELETE_LIMIT);
  if (deleteLimited) return deleteLimited;

  const group = await findGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (group.ownerAccountId !== accountId) {
    return failCode(origin, 403, 'NOT_OWNER', '只有组长可以解散小组');
  }
  await dissolveGroup(env.DB, groupId, accountId);
  return okJson(origin, {});
}
