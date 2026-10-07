/**
 * 洛克工具箱 API 路由（Cloudflare Pages Functions + D1）
 *
 * 为什么挂在 Pages 而不是独立 Worker：`*.workers.dev` 在国内网络被墙（实测 DNS 被污染、连接超时），
 * 而 `*.pages.dev` 可直连。API 与前端同域还能免掉 CORS。
 *
 * 路由：
 *   GET  /api/health
 *   POST /api/event                     埋点（匿名 deviceId 即可）
 *   GET  /api/stats?days=7              看板数据（只读，令牌走 Authorization 头，配在 Pages secret 里）
 *   POST /api/auth/register             开号（返回一次性恢复码 + 令牌）
 *   POST /api/auth/recover              用恢复码换令牌（换手机）
 *   POST /api/auth/rotate               重新生成恢复码（需登录）
 *   POST /api/auth/logout               撤销当前令牌
 *   GET  /api/me                        账号信息（需登录）
 *   DELETE /api/account                 注销账号（清空该账号全部云端数据）
 *   GET  /api/sync[?full=1]             取云端快照（需登录）
 *   PUT  /api/sync                      写云端快照（需登录，带 baseVersion）
 */
import { handleDeleteAccount, handleLogout, handleMe, handleRecover, handleRegister, handleRotate } from './auth';
import { handleEvent, handleStats } from './events';
import { handleSyncGet, handleSyncPut } from './sync';
import { type Env, corsHeaders, fail, json, resolveOrigin } from './util';

export async function route(request: Request, env: Env): Promise<Response> {
  const origin = resolveOrigin(request, env);

  if (request.method.toUpperCase() === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();

  if (pathname === '/api/health') return json({ ok: true, at: Date.now() }, 200, origin);
  if (pathname === '/api/stats' && method === 'GET') return handleStats(request, env);
  if (pathname === '/api/event' && method === 'POST') return handleEvent(request, env, origin);

  if (pathname === '/api/auth/register' && method === 'POST') return handleRegister(request, env, origin);
  if (pathname === '/api/auth/recover' && method === 'POST') return handleRecover(request, env, origin);
  if (pathname === '/api/auth/rotate' && method === 'POST') return handleRotate(request, env, origin);
  if (pathname === '/api/auth/logout' && method === 'POST') return handleLogout(request, env, origin);
  if (pathname === '/api/account' && method === 'DELETE') return handleDeleteAccount(request, env, origin);
  if (pathname === '/api/me' && method === 'GET') return handleMe(request, env, origin);

  if (pathname === '/api/sync' && method === 'GET') return handleSyncGet(request, env, origin);
  if (pathname === '/api/sync' && method === 'PUT') return handleSyncPut(request, env, origin);

  return fail('没有这个接口', 404, origin);
}
