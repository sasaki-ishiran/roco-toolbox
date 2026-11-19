/** 公共工具：CORS、JSON 响应、哈希、随机码 */
export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  STATS_TOKEN: string;
  EGG_BOT_BRIDGE_TOKEN?: string;
  ROCOM_PATROL_API_KEY?: string;
  /** Cloudflare Pages 注入：当前部署所属分支（test / main），用于区分内测与正式 */
  CF_PAGES_BRANCH?: string;
}

/** 允许跨域的前端来源；预检与实际请求都走这里 */
export function resolveOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowed.includes(origin)) return origin;
  // Pages 的预览域名（<hash>.roco-toolbox.pages.dev）也放行
  if (/^https:\/\/[a-z0-9-]+\.roco-toolbox\.pages\.dev$/.test(origin)) return origin;
  return null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? 'https://roco-toolbox.pages.dev',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });
}

export function fail(message: string, status: number, origin: string | null): Response {
  return json({ ok: false, error: message }, status, origin);
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function newId(): string {
  return crypto.randomUUID();
}

export function newToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** 恢复码：去掉容易看错的 0/O/1/I，12 位分三段（32^12 ≈ 2^60） */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}

/** 用户输入的恢复码：统一大写、去掉分隔符与空白后再比较 */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * 密码哈希（2026-11-18）：PBKDF2-SHA256 + 16 字节随机盐。
 * 迭代次数压到 1 万，是为了守住 Pages Functions 的 CPU 上限（每次请求只有 10ms 量级）。
 * 存储格式：`pbkdf2$<迭代次数>$<盐hex>$<哈希hex>`，改算法时按前缀区分。
 */
const PASSWORD_ITERATIONS = 10_000;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function derivePasswordBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordBits(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2$${PASSWORD_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, iterations, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iterations || !saltHex || !hashHex) return false;
  const hash = await derivePasswordBits(password, fromHex(saltHex), Number(iterations));
  return timingSafeEqual(toHex(hash), hashHex);
}

/** 用户名：3-16 位字母 / 数字 / 下划线 / 中文 */
export function isValidUsername(username: string): boolean {
  return /^[A-Za-z0-9_\u4e00-\u9fa5]{3,16}$/.test(username);
}

/** 用户名唯一性按小写比较（中文不受影响） */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** 密码：8-32 位，不做复杂度强制 */
export function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 32;
}


/** 令牌最后使用时间最多 5 分钟写一次：每条请求都写会把每次读都变成一次 D1 写往返。 */
const TOKEN_TOUCH_INTERVAL_MS = 5 * 60_000;

export async function authenticate(request: Request, env: Env): Promise<string | null> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT account_id, last_used_at FROM tokens WHERE token_hash = ?')
    .bind(hash)
    .first<{ account_id: string; last_used_at: number | null }>();
  if (!row) return null;
  const now = Date.now();
  if (row.last_used_at == null || now - row.last_used_at > TOKEN_TOUCH_INTERVAL_MS) {
    await env.DB.prepare('UPDATE tokens SET last_used_at = ? WHERE token_hash = ?')
      .bind(now, hash)
      .run();
  }
  return row.account_id;
}

/**
 * 固定长度比较（避免按字符短路比较泄露信息）。
 * 长度不同直接返回 false——两个待比较值都由本服务生成，长度本身不是秘密。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let index = 0; index < aBytes.length; index += 1) diff |= aBytes[index] ^ bBytes[index];
  return diff === 0;
}

/** 取发起方 IP（Cloudflare 会填 CF-Connecting-IP；本地 dev 走兜底） */
export function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'local'
  );
}

/**
 * 固定窗口限流：一条 UPSERT 完成「计数 + 判定」，天然原子。
 * 返回 true = 放行，false = 超限（调用方回 429）。
 *
 * 用的是 `rate_limits` 表（见 functions/schema.sql），按 bucket 复用同一行，
 * 行数上限 = 不同 bucket 数（IP / deviceId），不会无限增长。
 */
export async function rateLimit(
  env: Env,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const windowStart = Date.now() - (Date.now() % windowMs);
  try {
    const row = await env.DB.prepare(
      `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(bucket) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = excluded.window_start
                      THEN rate_limits.count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count`,
    )
      .bind(bucket, windowStart)
      .first<{ count: number }>();
    return (row?.count ?? 1) <= limit;
  } catch {
    // 限流本身出问题（例如表还没建）不应该把功能打死：放行并继续
    return true;
  }
}
