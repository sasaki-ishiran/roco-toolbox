/**
 * 两人共享的「互换清单」：分享码即权限，不需要账号登录。
 *
 * - POST /api/list             创建：服务端生成 8 位分享码，payload 是前端序列化好的 JSON
 * - GET  /api/list?code=XXXX   读取（不存在时返回 list: null）
 * - PUT  /api/list             更新：带 baseVersion 的乐观锁，版本对不上返回 409
 *
 * 为什么不复用 /api/sync：那是「一个账号的多台设备」，这里是「两个不同的人」，
 * 没有账号关系，只能靠分享码当能力凭证。
 */
import { type Env, clientIp, fail, json, rateLimit, readJson } from './util';

/** 正常的清单约 15–30KB，留足余量 */
const MAX_PAYLOAD_BYTES = 256 * 1024;
/** 去掉了 0/1/I/O 这些容易看错的字符 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

interface ListBody {
  code?: string;
  baseVersion?: number;
  payload?: string;
}

interface ListRow {
  version: number;
  updated_at: number;
  payload: string;
}

async function readRow(env: Env, code: string): Promise<ListRow | null> {
  return (
    (await env.DB.prepare('SELECT version, updated_at, payload FROM shared_lists WHERE code = ?')
      .bind(code)
      .first<ListRow>()) ?? null
  );
}

export async function handleListCreate(
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  if (!(await rateLimit(env, `list-create:${clientIp(request)}`, 30, 3_600_000))) {
    return fail('太频繁了，稍后再试', 429, origin);
  }
  const body = (await readJson<ListBody>(request)) ?? {};
  const payload = body.payload ?? '';
  if (!payload) return fail('缺少 payload', 400, origin);
  if (payload.length > MAX_PAYLOAD_BYTES) return fail('数据太大', 413, origin);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    const now = Date.now();
    try {
      await env.DB.prepare(
        'INSERT INTO shared_lists (code, version, updated_at, payload, bytes) VALUES (?, 1, ?, ?, ?)',
      )
        .bind(code, now, payload, payload.length)
        .run();
      return json({ ok: true, code, version: 1, updatedAt: now }, 200, origin);
    } catch {
      // 撞码（概率极低）→ 换一个重试
    }
  }
  return fail('生成分享码失败，请重试', 500, origin);
}

export async function handleListGet(
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  const code = (new URL(request.url).searchParams.get('code') ?? '').toUpperCase();
  if (!CODE_PATTERN.test(code)) return fail('分享码格式不对（8 位字母数字）', 400, origin);
  // 15 秒轮询 ≈ 240 次/小时/人，上限留到 600
  if (!(await rateLimit(env, `list-get:${clientIp(request)}`, 600, 3_600_000))) {
    return fail('太频繁了，稍后再试', 429, origin);
  }
  const row = await readRow(env, code);
  if (!row) return json({ ok: true, list: null }, 200, origin);
  return json(
    {
      ok: true,
      list: { version: row.version, updatedAt: row.updated_at, payload: row.payload },
    },
    200,
    origin,
  );
}

export async function handleListPut(
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  if (!(await rateLimit(env, `list-put:${clientIp(request)}`, 600, 3_600_000))) {
    return fail('太频繁了，稍后再试', 429, origin);
  }
  const body = (await readJson<ListBody>(request)) ?? {};
  const code = (body.code ?? '').toUpperCase();
  if (!CODE_PATTERN.test(code)) return fail('分享码格式不对', 400, origin);
  const payload = body.payload ?? '';
  if (!payload) return fail('缺少 payload', 400, origin);
  if (payload.length > MAX_PAYLOAD_BYTES) return fail('数据太大', 413, origin);

  const baseVersion = Number.isFinite(body.baseVersion) ? Number(body.baseVersion) : 0;
  const current = await readRow(env, code);
  if (!current) return fail('清单不存在（分享码不对或已被重置）', 404, origin);
  if (baseVersion !== current.version) {
    return json(
      {
        ok: false,
        error: 'conflict',
        list: { version: current.version, updatedAt: current.updated_at, payload: current.payload },
      },
      409,
      origin,
    );
  }

  const nextVersion = baseVersion + 1;
  const now = Date.now();
  // 乐观锁落在 SQL 里：版本在这期间被对方推走就不写
  const result = await env.DB.prepare(
    'UPDATE shared_lists SET version = ?, updated_at = ?, payload = ?, bytes = ? WHERE code = ? AND version = ?',
  )
    .bind(nextVersion, now, payload, payload.length, code, baseVersion)
    .run();

  if (!result.meta.changes) {
    const fresh = await readRow(env, code);
    return json(
      {
        ok: false,
        error: 'conflict',
        list: fresh ? { version: fresh.version, updatedAt: fresh.updated_at, payload: fresh.payload } : null,
      },
      409,
      origin,
    );
  }

  return json({ ok: true, version: nextVersion, updatedAt: now }, 200, origin);
}
