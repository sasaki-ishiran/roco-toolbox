/**
 * 账号（免密 / 设备绑定 + 恢复码）
 *
 * - 首次「开启云同步」→ POST /api/auth/register：建号 + 发令牌 + **只返回一次**恢复码（库里只存哈希）
 * - 换手机 → POST /api/auth/recover：用恢复码换新令牌（并记下新设备）
 * - 想换码 → POST /api/auth/rotate（需登录）
 * - 退出 → POST /api/auth/logout：撤销当前令牌
 */
import {
  type Env,
  authenticate,
  clientIp,
  fail,
  json,
  newId,
  newRecoveryCode,
  newToken,
  normalizeRecoveryCode,
  rateLimit,
  readJson,
  sha256Hex,
} from './util';

interface TokenPair {
  accountId: string;
  token: string;
}

async function issueToken(env: Env, accountId: string): Promise<string> {
  const token = newToken();
  await env.DB.prepare(
    'INSERT INTO tokens (token_hash, account_id, created_at, last_used_at) VALUES (?, ?, ?, ?)',
  )
    .bind(await sha256Hex(token), accountId, Date.now(), Date.now())
    .run();
  return token;
}

async function touchDevice(env: Env, deviceId: string | null, accountId: string | null): Promise<void> {
  if (!deviceId) return;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO devices (device_id, account_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET account_id = COALESCE(?, account_id), last_seen_at = ?`,
  )
    .bind(deviceId, accountId, now, now, accountId, now)
    .run();
}

interface RegisterBody {
  deviceId?: string;
  label?: string;
}

export async function handleRegister(request: Request, env: Env, origin: string | null): Promise<Response> {
  const body = (await readJson<RegisterBody>(request)) ?? {};
  if (!(await rateLimit(env, `register:${clientIp(request)}`, 10, 3_600_000))) {
    return fail('太频繁了，稍后再试', 429, origin);
  }
  const accountId = newId();
  const recoveryCode = newRecoveryCode();
  const now = Date.now();
  const label = (body.label ?? '').slice(0, 64);
  await env.DB.prepare(
    'INSERT INTO accounts (id, created_at, last_seen_at, recovery_hash, label) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(accountId, now, now, await sha256Hex(normalizeRecoveryCode(recoveryCode)), label || null)
    .run();
  await touchDevice(env, (body.deviceId ?? '').slice(0, 64) || null, accountId);
  const token = await issueToken(env, accountId);
  const pair: TokenPair = { accountId, token };
  return json({ ok: true, ...pair, recoveryCode }, 200, origin);
}

interface RecoverBody {
  recoveryCode?: string;
  deviceId?: string;
}

export async function handleRecover(request: Request, env: Env, origin: string | null): Promise<Response> {
  const body = (await readJson<RecoverBody>(request)) ?? {};
  if (!(await rateLimit(env, `recover:${clientIp(request)}`, 20, 3_600_000))) {
    return fail('太频繁了，稍后再试', 429, origin);
  }
  const code = normalizeRecoveryCode(body.recoveryCode ?? '');
  if (code.length !== 12) return fail('恢复码格式不对', 400, origin);
  const row = await env.DB.prepare('SELECT id FROM accounts WHERE recovery_hash = ?')
    .bind(await sha256Hex(code))
    .first<{ id: string }>();
  if (!row) return fail('恢复码不对（或用的是旧码，只有最新的有效）', 401, origin);
  await env.DB.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').bind(Date.now(), row.id).run();
  await touchDevice(env, (body.deviceId ?? '').slice(0, 64) || null, row.id);
  const token = await issueToken(env, row.id);
  return json({ ok: true, accountId: row.id, token }, 200, origin);
}

export async function handleRotate(request: Request, env: Env, origin: string | null): Promise<Response> {
  const accountId = await authenticate(request, env);
  if (!accountId) return fail('未登录', 401, origin);
  const recoveryCode = newRecoveryCode();
  await env.DB.prepare('UPDATE accounts SET recovery_hash = ? WHERE id = ?')
    .bind(await sha256Hex(normalizeRecoveryCode(recoveryCode)), accountId)
    .run();
  return json({ ok: true, recoveryCode }, 200, origin);
}

export async function handleLogout(request: Request, env: Env, origin: string | null): Promise<Response> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (token) {
    await env.DB.prepare('DELETE FROM tokens WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }
  return json({ ok: true }, 200, origin);
}

/**
 * 注销账号：把这个账号下的所有数据删干净（账号 / 令牌 / 设备关联 / 云快照 / 该账号的埋点账号字段）。
 * 前端在删除前会先让用户确认。
 */
export async function handleDeleteAccount(request: Request, env: Env, origin: string | null): Promise<Response> {
  const accountId = await authenticate(request, env);
  if (!accountId) return fail('未登录', 401, origin);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM snapshots WHERE account_id = ?').bind(accountId),
    env.DB.prepare('DELETE FROM tokens WHERE account_id = ?').bind(accountId),
    env.DB.prepare('UPDATE devices SET account_id = NULL WHERE account_id = ?').bind(accountId),
    env.DB.prepare('UPDATE events SET account_id = NULL WHERE account_id = ?').bind(accountId),
    env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(accountId),
  ]);
  return json({ ok: true }, 200, origin);
}

export async function handleMe(request: Request, env: Env, origin: string | null): Promise<Response> {
  const accountId = await authenticate(request, env);
  if (!accountId) return fail('未登录', 401, origin);
  const account = await env.DB.prepare('SELECT id, created_at, last_seen_at FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ id: string; created_at: number; last_seen_at: number }>();
  if (!account) return fail('账号不存在', 404, origin);
  await env.DB.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').bind(Date.now(), accountId).run();
  const snapshot = await env.DB.prepare('SELECT version, updated_at, bytes FROM snapshots WHERE account_id = ?')
    .bind(accountId)
    .first<{ version: number; updated_at: number; bytes: number }>();
  return json(
    {
      ok: true,
      accountId: account.id,
      createdAt: account.created_at,
      snapshot: snapshot
        ? { version: snapshot.version, updatedAt: snapshot.updated_at, bytes: snapshot.bytes }
        : null,
    },
    200,
    origin,
  );
}
