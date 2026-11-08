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
  claimCollectionDemand,
  claimCollectionTask,
  completeCollectionDemand,
  createCollectionGroup,
  findCollectionGroup,
  joinCollectionGroup,
  leaveCollectionGroup,
  listCollectionGroups,
  listCollectionTasks,
  previewInviteGroup,
  publishCollectionDemand,
  publishMotherResourceToGroup,
  publishStudResource,
  readCollectionGroupDetail,
  readCollectionGroupVersion,
  readDemandFeed,
  releaseCollectionDemand,
  releaseCollectionTask,
  removeCollectionGroupMember,
  transferCollectionTask,
  updateCollectionTarget,
  withdrawCollectionDemand,
  autoCompletePlanAfterDemand,
  markDemandPlaced,
} from './collectionGroupsStore';
import { handleCollectionPlans } from './collectionPlans';
import {
  MotherStoreError,
  dissolveGroup,
  isMember,
  resetInvite,
  updateDisplayName,
} from './motherGroupsStore';
import { type Env, authenticate, clientIp, newId, sha256Hex } from './util';
import {
  DELETE_LIMIT,
  GROUP_ID_MAX,
  IP_PROBE_LIMIT,
  OWNER_WRITE_LIMIT,
  READ_LIMIT,
  STORE_STATUS,
  WRITE_LIMIT,
  failCode,
  limited,
  newInviteCode,
  okJson,
} from './collectionGroupsHttp';
import {
  DEFAULT_DEMAND_BODY,
  DEFAULT_DEMAND_GENDER,
  DEFAULT_DEMAND_VOICE,
  DEMAND_NATURE_MAX,
  STUD_RESOURCE_MAX_BODY_BYTES,
  isDemandBody,
  isDemandGender,
  isDemandVoice,
  isValidDemandNatures,
} from '../../src/shared/collectionGroups';
import { MOTHER_RESOURCE_MAX_BODY_BYTES } from '../../src/shared/motherGroups';

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
        // 详情本身已经带组成员表：不再额外读组 + 成员（原来同一请求里组行读了两次）
        const detail = await readCollectionGroupDetail(env.DB, groupId);
        if (!detail) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
        if (!detail.members.some((member) => member.accountId === accountId)) {
          return failCode(origin, 403, 'NOT_MEMBER', '不是该组成员');
        }
        return okJson(origin, { group: detail.group, members: detail.members });
      }
      if (method === 'DELETE') return await handleDissolve(env, origin, accountId, groupId);
      return failCode(origin, 404, 'GROUP_NOT_FOUND', '没有这个接口');
    }

    if (rest.length === 2 && rest[1] === 'version' && method === 'GET') {
      const readLimited = await limited(env, origin, `cg-read:${accountId}`, READ_LIMIT);
      if (readLimited) return readLimited;
      const denied = await requireMember(env, origin, accountId, groupId);
      if (denied) return denied;
      return okJson(origin, { ...(await readCollectionGroupVersion(env.DB, groupId)) });
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
    if (rest.length === 3 && rest[1] === 'members' && method === 'DELETE') {
      return await handleRemoveMember(env, origin, accountId, groupId, rest[2]);
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
    // 需求承接（2026-10-26）：母本组专用
    if (rest.length === 2 && rest[1] === 'demands' && method === 'GET') {
      return await handleDemandsList(env, origin, accountId, groupId);
    }
    if (rest.length === 2 && rest[1] === 'demands' && method === 'POST') {
      return await handleDemandPublish(request, env, origin, accountId, groupId);
    }
    if (rest.length === 3 && rest[1] === 'demands' && method === 'DELETE') {
      return await handleDemandWithdraw(request, env, origin, accountId, groupId, rest[2]);
    }
    if (
      rest.length === 4 &&
      rest[1] === 'demands' &&
      ['claim', 'release', 'complete'].includes(rest[3]) &&
      method === 'POST'
    ) {
      return await handleDemandAction(request, env, origin, accountId, groupId, rest[2], rest[3]);
    }
    // 认领人标记「已上窝」（2026-11-08）：记 placed_at，发布人随后看到「待我确认」
    if (rest.length === 4 && rest[1] === 'demands' && rest[3] === 'placement' && method === 'POST') {
      return await handleDemandPlacement(request, env, origin, accountId, groupId, rest[2]);
    }
    // 收集计划（2026-11-08）：创建 / 批量导入、开始、完成、删除、提供标记
    if (rest.length >= 2 && rest[1] === 'plans') {
      return await handleCollectionPlans(
        request,
        env,
        origin,
        accountId,
        groupId,
        rest.slice(2),
        method,
      );
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
    await readJsonBody(
      request,
      group.groupType === 'stud' ? STUD_RESOURCE_MAX_BODY_BYTES : MOTHER_RESOURCE_MAX_BODY_BYTES,
    ),
    group.groupType,
  );
  // 种公组分支只在「未执行 2026-10-27 迁移」的旧库上可达（见 collectionGroupsStore 的说明，R2-7-L02）
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
          baseTargetRevision: parsed.baseTargetRevision ?? undefined,
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
  // 2026-11-01：组存在性与成员身份相互独立，并行查，少一次 D1 往返
  const [group, member] = await Promise.all([
    findCollectionGroup(env.DB, groupId),
    isMember(env.DB, groupId, accountId),
  ]);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (!member) {
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

/* ---------- 需求承接（2026-10-26） ---------- */

const parseDemandEggGameId = (raw: unknown): number => {
  // 只接受规范十进制整数：`Number()` 会放过 '0x10' / '1e3' / ' 12 '（R2-7-L05）
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text !== 'string' || !/^-?[1-9]\d{0,9}$/.test(text)) {
    throw new MotherInputError('INVALID_INPUT', 'eggGameId 无效');
  }
  const id = Number(text);
  // 负数 = 种公需求，绝对值是蛋组 id（2~15）；种公组已下线，这里只为旧数据兼容保留
  if (id < 0) {
    const groupId = -id;
    if (groupId < 2 || groupId > 15) {
      throw new MotherInputError('INVALID_INPUT', '蛋组 id 无效');
    }
  }
  return id;
};

const parseDemanderAccountId = (body: Record<string, unknown>): string => {
  const value = body.demanderAccountId;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 64) {
    throw new MotherInputError('INVALID_INPUT', 'demanderAccountId 无效');
  }
  return value.trim();
};

/**
 * 「组存在 + 我是成员」一次查完（原先是 3 条 SQL：组、配置、成员）。
 * 返回成员所在组的 owner，失败时区分 404 / 403。
 */
async function requireMemberRow(
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<{ ownerAccountId: string } | Response> {
  const row = await env.DB.prepare(
    `SELECT g.owner_account_id AS owner_account_id
       FROM mother_group_members m
       JOIN mother_groups g ON g.id = m.group_id
      WHERE m.group_id = ? AND m.account_id = ?`,
  )
    .bind(groupId, accountId)
    .first<{ owner_account_id: string }>();
  if (row) return { ownerAccountId: row.owner_account_id };
  const exists = await env.DB.prepare('SELECT 1 AS found FROM mother_groups WHERE id = ?')
    .bind(groupId)
    .first<{ found: number }>();
  return exists
    ? failCode(origin, 403, 'NOT_MEMBER', '不是该组成员')
    : failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
}

async function requireMember(
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response | null> {
  const row = await requireMemberRow(env, origin, accountId, groupId);
  return row instanceof Response ? row : null;
}

async function handleDemandsList(
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const readLimited = await limited(env, origin, `cg-read:${accountId}`, READ_LIMIT);
  if (readLimited) return readLimited;
  const denied = await requireMember(env, origin, accountId, groupId);
  if (denied) return denied;
  // 未完成列表 + 已结单聚合 + 我的最近完成（2026-11-01，不再下发全量历史）
  const feed = await readDemandFeed(env.DB, groupId, accountId);
  return okJson(origin, { ...feed });
}

async function handleDemandPublish(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response> {
  const writeLimited = await limited(env, origin, `cg-write:${accountId}`, WRITE_LIMIT);
  if (writeLimited) return writeLimited;
  const denied = await requireMember(env, origin, accountId, groupId);
  if (denied) return denied;
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MotherInputError('INVALID_INPUT', '请求体必须是对象');
  }
  const eggGameId = parseDemandEggGameId(body.eggGameId);
  const natures = body.natures ?? [];
  if (!isValidDemandNatures(natures)) {
    throw new MotherInputError('INVALID_INPUT', `性格最多 ${DEMAND_NATURE_MAX} 个，且不能为空`);
  }
  const gender = body.gender ?? DEFAULT_DEMAND_GENDER;
  const demandBody = body.body ?? DEFAULT_DEMAND_BODY;
  const voice = body.voice ?? DEFAULT_DEMAND_VOICE;
  if (!isDemandGender(gender)) throw new MotherInputError('INVALID_INPUT', '性别无效');
  if (!isDemandBody(demandBody)) throw new MotherInputError('INVALID_INPUT', '体型无效');
  if (!isDemandVoice(voice)) throw new MotherInputError('INVALID_INPUT', '声音无效');
  // 要求进学院小窝（绿窝）：可选，缺省 false（2026-11-01）
  const requireGreenNest = body.requireGreenNest === true;
  const demand = await publishCollectionDemand(env.DB, {
    groupId,
    accountId,
    eggGameId,
    natures: (natures as string[]).map((nature) => nature.trim()),
    gender,
    body: demandBody,
    voice,
    requireGreenNest,
  });
  return okJson(origin, { demands: demand });
}

async function handleDemandWithdraw(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
  rawEggGameId: string | undefined,
): Promise<Response> {
  const writeLimited = await limited(env, origin, `cg-write:${accountId}`, WRITE_LIMIT);
  if (writeLimited) return writeLimited;
  const denied = await requireMember(env, origin, accountId, groupId);
  if (denied) return denied;
  const eggGameId = parseDemandEggGameId(rawEggGameId);
  // 按「蛋 + 性格 + 性别 / 体型 / 声音」单独撤回：`?nature=` 为空表示撤回「不挑性格」那一条
  const params = new URL(request.url).searchParams;
  const nature = (params.get('nature') ?? '').trim();
  if (nature.length > 8) throw new MotherInputError('INVALID_INPUT', 'nature 无效');
  // 精确操作必须带全三维：缺省不再静默补「母 / 大块头 / +100」，否则会撤错那一条（R2-7-L04）
  const gender = params.get('gender');
  const demandBody = params.get('body');
  const voice = params.get('voice');
  if (gender == null || demandBody == null || voice == null) {
    throw new MotherInputError('INVALID_INPUT', '缺少性别 / 体型 / 声音参数');
  }
  if (!isDemandGender(gender)) throw new MotherInputError('INVALID_INPUT', '性别无效');
  if (!isDemandBody(demandBody)) throw new MotherInputError('INVALID_INPUT', '体型无效');
  if (!isDemandVoice(voice)) throw new MotherInputError('INVALID_INPUT', '声音无效');
  await withdrawCollectionDemand(
    env.DB,
    groupId,
    accountId,
    eggGameId,
    nature,
    gender,
    demandBody,
    voice,
  );
  return okJson(origin, { withdrawn: { eggGameId, nature, gender, body: demandBody, voice } });
}

async function handleDemandAction(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
  rawEggGameId: string | undefined,
  action: string,
): Promise<Response> {
  const writeLimited = await limited(env, origin, `cg-write:${accountId}`, WRITE_LIMIT);
  if (writeLimited) return writeLimited;
  const memberRow = await requireMemberRow(env, origin, accountId, groupId);
  if (memberRow instanceof Response) return memberRow;
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MotherInputError('INVALID_INPUT', '请求体必须是对象');
  }
  const demanderAccountId = parseDemanderAccountId(body);
  const eggGameId = parseDemandEggGameId(rawEggGameId);
  const rawNature = body.nature ?? '';
  const nature = typeof rawNature === 'string' ? rawNature.trim() : rawNature;
  if (typeof nature !== 'string' || nature.length > 8) {
    throw new MotherInputError('INVALID_INPUT', 'nature 无效');
  }
  // 接单 / 放弃 / 结单是精确操作，三维必须显式传入（R2-7-L04）；发布路径仍保留默认值
  const gender = body.gender;
  const demandBody = body.body;
  const voice = body.voice;
  if (gender == null || demandBody == null || voice == null) {
    throw new MotherInputError('INVALID_INPUT', '缺少性别 / 体型 / 声音参数');
  }
  if (!isDemandGender(gender)) throw new MotherInputError('INVALID_INPUT', '性别无效');
  if (!isDemandBody(demandBody)) throw new MotherInputError('INVALID_INPUT', '体型无效');
  if (!isDemandVoice(voice)) throw new MotherInputError('INVALID_INPUT', '声音无效');
  const expectedVersion = parseOptionalVersion(body);
  const base = {
    groupId,
    accountId,
    demanderAccountId,
    eggGameId,
    nature,
    gender,
    body: demandBody,
    voice,
    expectedVersion,
  };

  if (action === 'claim') {
    return okJson(origin, { demand: await claimCollectionDemand(env.DB, base) });
  }
  if (action === 'release') {
    return okJson(origin, { demand: await releaseCollectionDemand(env.DB, base) });
  }
  // 结单要判断是不是组长：owner 已经在成员校验里带出来了，不再多读一次组
  const demand = await completeCollectionDemand(env.DB, {
    ...base,
    isOwner: memberRow.ownerAccountId === accountId,
  });
  // 这颗蛋关联的需求「全部结单」时计划自动完成（撤回不算；判定在 shared 纯逻辑里）
  await autoCompletePlanAfterDemand(env.DB, groupId, demanderAccountId, eggGameId);
  return okJson(origin, { demand });
}

/**
 * 认领人标记「已上窝」：把 placed_at 同步到服务端，发布人由此看到「待我确认」。
 *
 * 家园快照提示是纯前端行为，这里不参与判定；`accountKey` 只落库，别人的视图不返回。
 */
async function handleDemandPlacement(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
  rawEggGameId: string | undefined,
): Promise<Response> {
  const writeLimited = await limited(env, origin, `cg-write:${accountId}`, WRITE_LIMIT);
  if (writeLimited) return writeLimited;
  const denied = await requireMember(env, origin, accountId, groupId);
  if (denied) return denied;
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MotherInputError('INVALID_INPUT', '请求体必须是对象');
  }
  const demanderAccountId = parseDemanderAccountId(body);
  const eggGameId = parseDemandEggGameId(rawEggGameId);
  const nature = typeof body.nature === 'string' ? body.nature.trim() : body.nature ?? '';
  if (typeof nature !== 'string' || nature.length > 8) {
    throw new MotherInputError('INVALID_INPUT', 'nature 无效');
  }
  const gender = body.gender;
  const demandBody = body.body;
  const voice = body.voice;
  if (gender == null || demandBody == null || voice == null) {
    throw new MotherInputError('INVALID_INPUT', '缺少性别 / 体型 / 声音参数');
  }
  if (!isDemandGender(gender)) throw new MotherInputError('INVALID_INPUT', '性别无效');
  if (!isDemandBody(demandBody)) throw new MotherInputError('INVALID_INPUT', '体型无效');
  if (!isDemandVoice(voice)) throw new MotherInputError('INVALID_INPUT', '声音无效');
  // 上窝用的游戏账号标识（uid:<gameId>）：可选，只落库不对外展示
  const rawKey = body.accountKey;
  let accountKey: string | null = null;
  if (rawKey !== undefined && rawKey !== null) {
    if (typeof rawKey !== 'string' || !/^uid:\d{1,20}$/.test(rawKey)) {
      throw new MotherInputError('INVALID_INPUT', 'accountKey 无效');
    }
    accountKey = rawKey;
  }
  const demand = await markDemandPlaced(env.DB, {
    groupId,
    accountId,
    demanderAccountId,
    eggGameId,
    nature,
    gender,
    body: demandBody,
    voice,
    accountKey,
  });
  return okJson(origin, { demand });
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

/** 组长移除组员：不能移除自己；会取消他未完成的需求，已完成保留用于已结单计数。 */
async function handleRemoveMember(
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
  memberAccountId: string,
): Promise<Response> {
  const deleteLimited = await limited(env, origin, `cg-delete:${accountId}`, DELETE_LIMIT);
  if (deleteLimited) return deleteLimited;

  const group = await findCollectionGroup(env.DB, groupId);
  if (!group) return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  if (group.ownerAccountId !== accountId) {
    return failCode(origin, 403, 'NOT_OWNER', '只有组长可以移除组员');
  }
  if (!memberAccountId || memberAccountId.length > GROUP_ID_MAX || memberAccountId === accountId) {
    return failCode(origin, 400, 'INVALID_INPUT', '成员账号无效；不能移除组长自己');
  }
  if (!(await isMember(env.DB, groupId, memberAccountId))) {
    return failCode(origin, 404, 'MEMBER_NOT_FOUND', '该成员已经不在小组');
  }
  await removeCollectionGroupMember(env.DB, groupId, memberAccountId);
  return okJson(origin, { removed: memberAccountId });
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
