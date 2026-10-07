/** 公共工具：CORS、JSON 响应、哈希、随机码 */
export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  STATS_TOKEN: string;
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
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
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

export async function authenticate(request: Request, env: Env): Promise<string | null> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT account_id FROM tokens WHERE token_hash = ?')
    .bind(hash)
    .first<{ account_id: string }>();
  if (!row) return null;
  await env.DB.prepare('UPDATE tokens SET last_used_at = ? WHERE token_hash = ?')
    .bind(Date.now(), hash)
    .run();
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
