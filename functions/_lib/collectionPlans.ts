/**
 * 收集计划（2026-11-08）：`/api/collection-groups/{groupId}/plans/**` 的 HTTP 层。
 *
 * 职责只有三件：登录 / 成员校验、参数校验、把结果包成统一响应。
 * 状态与额度判定全部在 `src/shared/collectionPlans.ts` 的纯函数里，
 * D1 读写见 `collectionGroupsStore.ts` 的「收集计划」段落。
 *
 * 路由（全部要求是组员）：
 *   GET    /plans                      按组读计划列表（含自己的，前端标「我发布的」）
 *   POST   /plans                      创建 / 批量导入（{ eggGameIds, note?, start? }）
 *   POST   /plans/{planId}/start       开始（不设数量上限，想收 → 进行中）
 *   POST   /plans/{planId}/complete    完成（想收也能直接完成）
 *   DELETE /plans/{planId}             删除（连带 plan_offers）
 *   PUT    /plans/{planId}/offers/me   标记 / 改备注「我能提供」
 *   DELETE /plans/{planId}/offers/me   撤回「我能提供」
 */
import { type Env } from './util';
import {
  DELETE_LIMIT,
  READ_LIMIT,
  WRITE_LIMIT,
  failCode,
  limited,
  okJson,
} from './collectionGroupsHttp';
import {
  PLAN_NOTE_MAX,
  completeCollectionPlan,
  createCollectionPlans,
  deleteCollectionPlan,
  markPlanOffer,
  readCollectionPlans,
  startCollectionPlan,
  withdrawPlanOffer,
} from './collectionGroupsStore';
import { MotherInputError, readJsonBody } from './motherGroupsValidation';

const GROUP_ID_MAX = 64;
const PLAN_ID_MAX = 64;
const PLAN_EGGS_MAX = 50;
const EGG_GAME_ID_MAX = 2_000_000_000;

const asBody = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MotherInputError('INVALID_INPUT', '请求体必须是对象');
  }
  return value as Record<string, unknown>;
};

const parsePlanId = (raw: string | undefined): string => {
  if (!raw || raw.length > PLAN_ID_MAX) {
    throw new MotherInputError('INVALID_INPUT', 'planId 无效');
  }
  return raw;
};

const parseEggGameId = (raw: unknown): number => {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > EGG_GAME_ID_MAX) {
    throw new MotherInputError('INVALID_INPUT', 'eggGameId 无效');
  }
  return raw;
};

const parseEggGameIds = (body: Record<string, unknown>): number[] => {
  if (!Array.isArray(body.eggGameIds) || body.eggGameIds.length === 0) {
    throw new MotherInputError('INVALID_INPUT', '至少要选一颗蛋');
  }
  if (body.eggGameIds.length > PLAN_EGGS_MAX) {
    throw new MotherInputError('INVALID_INPUT', `一次最多添加 ${PLAN_EGGS_MAX} 颗蛋`);
  }
  return body.eggGameIds.map(parseEggGameId);
};

const parseNote = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new MotherInputError('INVALID_INPUT', 'note 必须是字符串');
  const note = value.trim();
  if (note.length > PLAN_NOTE_MAX) {
    throw new MotherInputError('INVALID_INPUT', `备注最多 ${PLAN_NOTE_MAX} 个字`);
  }
  return note;
};

/** 组存在 + 当前身份是组员（404 / 403 分开，和需求接口一致）。 */
async function requireMember(
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
): Promise<Response | null> {
  const row = await env.DB.prepare(
    'SELECT 1 AS found FROM mother_group_members WHERE group_id = ? AND account_id = ?',
  )
    .bind(groupId, accountId)
    .first<{ found: number }>();
  if (row) return null;
  const exists = await env.DB.prepare('SELECT 1 AS found FROM mother_groups WHERE id = ?')
    .bind(groupId)
    .first<{ found: number }>();
  return exists
    ? failCode(origin, 403, 'NOT_MEMBER', '不是该组成员')
    : failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
}

export async function handleCollectionPlans(
  request: Request,
  env: Env,
  origin: string | null,
  accountId: string,
  groupId: string,
  rest: string[],
  method: string,
): Promise<Response> {
  if (!groupId || groupId.length > GROUP_ID_MAX) {
    return failCode(origin, 404, 'GROUP_NOT_FOUND', '小组不存在');
  }
  const denied = await requireMember(env, origin, accountId, groupId);
  if (denied) return denied;

  if (rest.length === 0 && method === 'GET') {
    const readLimited = await limited(env, origin, `cg-read:${accountId}`, READ_LIMIT);
    if (readLimited) return readLimited;
    return okJson(origin, { ...(await readCollectionPlans(env.DB, groupId, accountId)) });
  }

  if (rest.length === 0 && method === 'POST') {
    const writeLimited = await limited(env, origin, `cg-write:${accountId}`, WRITE_LIMIT);
    if (writeLimited) return writeLimited;
    const body = asBody(await readJsonBody(request));
    const result = await createCollectionPlans(env.DB, {
      groupId,
      accountId,
      eggGameIds: parseEggGameIds(body),
      note: parseNote(body.note),
      start: body.start === true,
    });
    return okJson(origin, { ...result });
  }

  const planId = parsePlanId(rest[0]);

  if (rest.length === 2 && rest[1] === 'start' && method === 'POST') {
    const writeLimited = await limited(env, origin, `cg-write:${accountId}`, WRITE_LIMIT);
    if (writeLimited) return writeLimited;
    return okJson(origin, { plan: await startCollectionPlan(env.DB, { groupId, accountId, planId }) });
  }

  if (rest.length === 2 && rest[1] === 'complete' && method === 'POST') {
    const writeLimited = await limited(env, origin, `cg-write:${accountId}`, WRITE_LIMIT);
    if (writeLimited) return writeLimited;
    return okJson(origin, { plan: await completeCollectionPlan(env.DB, { groupId, accountId, planId }) });
  }

  if (rest.length === 1 && method === 'DELETE') {
    const deleteLimited = await limited(env, origin, `cg-delete:${accountId}`, DELETE_LIMIT);
    if (deleteLimited) return deleteLimited;
    await deleteCollectionPlan(env.DB, { groupId, accountId, planId });
    return okJson(origin, {});
  }

  if (rest.length === 3 && rest[1] === 'offers' && rest[2] === 'me') {
    if (method === 'PUT') {
      const writeLimited = await limited(env, origin, `cg-write:${accountId}`, WRITE_LIMIT);
      if (writeLimited) return writeLimited;
      const body = asBody(await readJsonBody(request));
      const offer = await markPlanOffer(env.DB, {
        groupId,
        accountId,
        planId,
        note: parseNote(body.note),
      });
      return okJson(origin, { offer });
    }
    if (method === 'DELETE') {
      const deleteLimited = await limited(env, origin, `cg-delete:${accountId}`, DELETE_LIMIT);
      if (deleteLimited) return deleteLimited;
      await withdrawPlanOffer(env.DB, { groupId, accountId, planId });
      return okJson(origin, {});
    }
  }

  return failCode(origin, 404, 'GROUP_NOT_FOUND', '没有这个接口');
}
