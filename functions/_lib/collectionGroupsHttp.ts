/**
 * 小组接口共用的 HTTP 辅助：限流常量、错误码 → 状态码、统一响应与邀请码生成。
 *
 * 两个 handler（`/api/collection-groups` 与旧 `/api/mother-groups`）原来各抄一份，
 * 新增错误码必须同时改两处、漏一处会让同一错误在两个入口返回不同状态（R2-7-M03 / 原 B4-M02）。
 * 以 `_` 开头，Pages 不把它当路由。
 */
import type { MotherStoreErrorCode } from './motherGroupsStore';
import { type Env, json, rateLimit } from './util';

export const HOUR = 3_600_000;
export const READ_LIMIT = 1800;
export const WRITE_LIMIT = 120;
export const OWNER_WRITE_LIMIT = 30;
export const DELETE_LIMIT = 30;
export const IP_PROBE_LIMIT = 120;

export const STORE_STATUS: Record<MotherStoreErrorCode, number> = {
  GROUP_NOT_FOUND: 404,
  NOT_MEMBER: 403,
  MEMBER_NOT_FOUND: 404,
  GROUP_TYPE_MISMATCH: 409,
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
  DEMAND_UNSUPPORTED: 409,
  DEMAND_NOT_FOUND: 404,
  DEMAND_LIMIT: 409,
  DEMAND_TAKEN: 409,
  DEMAND_SELF: 409,
  DEMAND_ALREADY_DONE: 409,
  DEMAND_NOT_CLAIMED: 409,
  DEMAND_NOT_YOURS: 403,
  PLAN_NOT_FOUND: 404,
  PLAN_NOT_YOURS: 403,
  PLAN_ALREADY_DONE: 409,
  PLAN_OFFER_SELF: 409,
  PLAN_OFFER_NOT_FOUND: 404,
};

export const failCode = (
  origin: string | null,
  status: number,
  code: string,
  error: string,
): Response => {
  const response = json({ ok: false, code, error }, status, origin);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

export const okJson = (origin: string | null, data: Record<string, unknown>): Response => {
  const response = json({ ok: true, ...data }, 200, origin);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

export async function limited(
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

export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_LENGTH));
  return [...bytes].map((byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join('');
}

export const GROUP_ID_MAX = 64;
