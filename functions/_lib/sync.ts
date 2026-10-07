/**
 * 云同步：整份数据（导入的精灵数据 + 计划/筛选偏好）打成一个快照，全量覆盖。
 *
 * - GET  /api/sync            → 只回元信息（版本/时间/大小）
 * - GET  /api/sync?full=1     → 连 payload 一起回
 * - PUT  /api/sync            → 带 baseVersion 的乐观锁写入；版本对不上返回 409 + 云端元信息，
 *                               由前端让用户选「用云端 / 用本地覆盖」
 * payload 是前端 gzip + base64 后的字符串。
 */
import { type Env, authenticate, fail, json, readJson } from './util';

const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024; // 8MB：正常快照（几千只精灵）远小于此

export async function handleSyncGet(request: Request, env: Env, origin: string | null): Promise<Response> {
  const accountId = await authenticate(request, env);
  if (!accountId) return fail('未登录', 401, origin);
  const full = new URL(request.url).searchParams.get('full') === '1';
  const row = await env.DB.prepare(
    'SELECT version, updated_at, device_id, payload, bytes FROM snapshots WHERE account_id = ?',
  )
    .bind(accountId)
    .first<{ version: number; updated_at: number; device_id: string | null; payload: string; bytes: number }>();
  if (!row) return json({ ok: true, snapshot: null }, 200, origin);
  return json(
    {
      ok: true,
      snapshot: {
        version: row.version,
        updatedAt: row.updated_at,
        deviceId: row.device_id,
        bytes: row.bytes,
        ...(full ? { payload: row.payload } : {}),
      },
    },
    200,
    origin,
  );
}

interface SyncPutBody {
  baseVersion?: number;
  payload?: string;
  deviceId?: string;
  appVersion?: string;
}

/** 云端元信息（不含 payload），用于 409 时告诉前端「云端是什么样」 */
async function cloudMeta(
  env: Env,
  accountId: string,
): Promise<{ version: number; updated_at: number; device_id: string | null } | null> {
  return (
    (await env.DB.prepare('SELECT version, updated_at, device_id FROM snapshots WHERE account_id = ?')
      .bind(accountId)
      .first<{ version: number; updated_at: number; device_id: string | null }>()) ?? null
  );
}

function conflict(
  current: { version: number; updated_at: number; device_id: string | null } | null,
  origin: string | null,
): Response {
  return json(
    {
      ok: false,
      error: 'conflict',
      cloud: current
        ? { version: current.version, updatedAt: current.updated_at, deviceId: current.device_id }
        : null,
    },
    409,
    origin,
  );
}

export async function handleSyncPut(request: Request, env: Env, origin: string | null): Promise<Response> {
  const accountId = await authenticate(request, env);
  if (!accountId) return fail('未登录', 401, origin);
  const body = (await readJson<SyncPutBody>(request)) ?? {};
  const payload = body.payload ?? '';
  if (!payload) return fail('缺少 payload', 400, origin);
  if (payload.length > MAX_PAYLOAD_BYTES) return fail('数据太大，先清理一下历史数据', 413, origin);

  const baseVersion = Number.isFinite(body.baseVersion) ? Number(body.baseVersion) : 0;
  const current = await cloudMeta(env, accountId);
  if (baseVersion !== (current?.version ?? 0)) return conflict(current, origin);

  const nextVersion = baseVersion + 1;
  const now = Date.now();
  // 乐观锁做进 SQL：只有版本仍是 baseVersion 才落库。
  // 旧的「先 SELECT 校验、再 upsert」在两次请求并发时会双双通过校验，后者静默覆盖前者。
  const result = await env.DB.prepare(
    `INSERT INTO snapshots (account_id, version, updated_at, device_id, payload, bytes) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       version = excluded.version,
       updated_at = excluded.updated_at,
       device_id = excluded.device_id,
       payload = excluded.payload,
       bytes = excluded.bytes
     WHERE snapshots.version = ?`,
  )
    .bind(accountId, nextVersion, now, body.deviceId ?? null, payload, payload.length, baseVersion)
    .run();

  if (!result.meta.changes) {
    // 版本在 SELECT 与写入之间被别的设备推走了 → 让前端走「用云端 / 用本地覆盖」
    return conflict(await cloudMeta(env, accountId), origin);
  }

  return json({ ok: true, version: nextVersion, updatedAt: now, bytes: payload.length }, 200, origin);
}
