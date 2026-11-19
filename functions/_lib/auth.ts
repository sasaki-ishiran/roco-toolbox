/**
 * 账号（2026-11-18 起：用户名 + 密码）
 *
 * - 注册 → POST /api/auth/signup：建号 + 发令牌
 * - 登录 → POST /api/auth/login：用户名密码换令牌（换手机 / 重装）
 * - 老账号设置用户名密码 → POST /api/auth/setup（需登录，保留原有数据和小组）
 * - 修改密码 → POST /api/auth/password（需登录）
 *
 * 下面 register / recover / rotate 三个恢复码接口保留给还没升级的旧 APK，
 * 网页端已不再调用；忘记密码由管理员用 scripts/reset-password.mjs 重置。
 */
import {
  type Env,
  authenticate,
  clientIp,
  fail,
  hashPassword,
  isValidPassword,
  isValidUsername,
  json,
  newId,
  newRecoveryCode,
  newToken,
  normalizeRecoveryCode,
  normalizeUsername,
  rateLimit,
  readJson,
  sha256Hex,
  verifyPassword,
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

interface CredentialsBody {
  username?: string;
  password?: string;
  deviceId?: string;
}

/** 用户名/密码两列的校验与查重：注册、登录、老账号设置都走这里 */
function checkCredentials(username: string, password: string): string | null {
  if (!isValidUsername(username)) return '用户名需为 3-16 位字母、数字、下划线或中文';
  if (!isValidPassword(password)) return '密码需为 8-32 位';
  return null;
}

async function findByUsername(
  env: Env,
  usernameLower: string,
): Promise<{ id: string; username: string | null; password_hash: string | null } | null> {
  return env.DB.prepare('SELECT id, username, password_hash FROM accounts WHERE username_lower = ?')
    .bind(usernameLower)
    .first<{ id: string; username: string | null; password_hash: string | null }>();
}

/** 注册：新建账号（老用户在新设备上第一次用也走这里） */
export async function handleSignup(request: Request, env: Env, origin: string | null): Promise<Response> {
  const body = (await readJson<CredentialsBody>(request)) ?? {};
  if (!(await rateLimit(env, `signup:${clientIp(request)}`, 10, 3_600_000))) {
    return fail('太频繁了，稍后再试', 429, origin);
  }
  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  const invalid = checkCredentials(username, password);
  if (invalid) return fail(invalid, 400, origin);

  const lower = normalizeUsername(username);
  if (await findByUsername(env, lower)) return fail('这个用户名已被占用，换一个', 409, origin);

  const accountId = newId();
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO accounts (id, created_at, last_seen_at, recovery_hash, label, username, username_lower, password_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      // recovery_hash 是老账号才用的列，新账号写一个用不到的随机占位
      .bind(accountId, now, now, await sha256Hex(`unused:${newId()}`), null, username, lower, await hashPassword(password))
      .run();
  } catch {
    // 唯一索引兜底：并发注册同名时后到的这条会失败
    return fail('这个用户名已被占用，换一个', 409, origin);
  }
  await touchDevice(env, (body.deviceId ?? '').slice(0, 64) || null, accountId);
  const token = await issueToken(env, accountId);
  return json({ ok: true, accountId, token, username }, 200, origin);
}

/** 登录：用户名 + 密码换令牌 */
export async function handleLogin(request: Request, env: Env, origin: string | null): Promise<Response> {
  const body = (await readJson<CredentialsBody>(request)) ?? {};
  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  // 格式不对也回同一句，避免帮人试出「用户名存在但密码错」
  if (!isValidUsername(username) || !isValidPassword(password)) return fail('用户名或密码不对', 401, origin);

  const lower = normalizeUsername(username);
  if (
    !(await rateLimit(env, `login:${clientIp(request)}`, 60, 3_600_000)) ||
    !(await rateLimit(env, `login:user:${lower}`, 20, 3_600_000))
  ) {
    return fail('尝试太频繁，稍后再试', 429, origin);
  }

  const row = await findByUsername(env, lower);
  if (!row || !(await verifyPassword(password, row.password_hash))) return fail('用户名或密码不对', 401, origin);
  await env.DB.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').bind(Date.now(), row.id).run();
  await touchDevice(env, (body.deviceId ?? '').slice(0, 64) || null, row.id);
  const token = await issueToken(env, row.id);
  return json({ ok: true, accountId: row.id, token, username: row.username ?? username }, 200, origin);
}

/** 老账号（只有恢复码 / 令牌）在当前设备上补设用户名密码，数据和小组都保留 */
export async function handleSetup(request: Request, env: Env, origin: string | null): Promise<Response> {
  const accountId = await authenticate(request, env);
  if (!accountId) return fail('未登录', 401, origin);
  const body = (await readJson<CredentialsBody>(request)) ?? {};
  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  const invalid = checkCredentials(username, password);
  if (invalid) return fail(invalid, 400, origin);

  const account = await env.DB.prepare('SELECT username FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ username: string | null }>();
  if (!account) return fail('账号不存在', 404, origin);
  if (account.username) return fail('这个账号已经有用户名了，要换密码请用「修改密码」', 409, origin);

  const lower = normalizeUsername(username);
  const taken = await findByUsername(env, lower);
  if (taken && taken.id !== accountId) return fail('这个用户名已被占用，换一个', 409, origin);

  try {
    await env.DB.prepare('UPDATE accounts SET username = ?, username_lower = ?, password_hash = ? WHERE id = ?')
      .bind(username, lower, await hashPassword(password), accountId)
      .run();
  } catch {
    return fail('这个用户名已被占用，换一个', 409, origin);
  }
  return json({ ok: true, username }, 200, origin);
}

interface ChangePasswordBody {
  oldPassword?: string;
  newPassword?: string;
}

/** 修改密码：先验原密码 */
export async function handleChangePassword(request: Request, env: Env, origin: string | null): Promise<Response> {
  const accountId = await authenticate(request, env);
  if (!accountId) return fail('未登录', 401, origin);
  if (!(await rateLimit(env, `password:${clientIp(request)}`, 20, 3_600_000))) {
    return fail('太频繁了，稍后再试', 429, origin);
  }
  const body = (await readJson<ChangePasswordBody>(request)) ?? {};
  const row = await env.DB.prepare('SELECT password_hash FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<{ password_hash: string | null }>();
  if (!row?.password_hash) return fail('这个账号还没有设置密码', 400, origin);
  if (!(await verifyPassword(body.oldPassword ?? '', row.password_hash))) return fail('原密码不对', 401, origin);
  if (!isValidPassword(body.newPassword ?? '')) return fail('新密码需为 8-32 位', 400, origin);
  await env.DB.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(body.newPassword as string), accountId)
    .run();
  return json({ ok: true }, 200, origin);
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
  const account = await env.DB.prepare(
    'SELECT id, created_at, last_seen_at, username FROM accounts WHERE id = ?',
  )
    .bind(accountId)
    .first<{ id: string; created_at: number; last_seen_at: number; username: string | null }>();
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
      username: account.username,
      snapshot: snapshot
        ? { version: snapshot.version, updatedAt: snapshot.updated_at, bytes: snapshot.bytes }
        : null,
    },
    200,
    origin,
  );
}
