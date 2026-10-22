/**
 * 互换清单的云端接口（分享码即权限，不需要登录）。
 *
 * - POST /api/list           创建 → 返回 8 位分享码
 * - GET  /api/list?code=     读取
 * - PUT  /api/list           更新（带 baseVersion，冲突返回 409 + 云端那份）
 */
import { API_BASE } from './analytics';

export interface SharedListPayload {
  version: number;
  updatedAt: number;
  payload: string;
}

export interface PutResult {
  ok: boolean;
  version?: number;
  list?: SharedListPayload | null;
  error?: string;
}

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

async function parse<T>(response: Response): Promise<T & { ok?: boolean; error?: string }> {
  const data = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  return data;
}

export async function createSharedList(payload: string): Promise<{ code: string; version: number }> {
  const response = await fetch(apiUrl('/api/list'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  const data = await parse<{ code?: string; version?: number }>(response);
  if (!response.ok || !data.code) throw new Error(data.error ?? `创建失败（${response.status}）`);
  return { code: data.code, version: data.version ?? 1 };
}

export async function fetchSharedList(code: string): Promise<SharedListPayload | null> {
  const response = await fetch(apiUrl(`/api/list?code=${encodeURIComponent(code)}`));
  const data = await parse<{ list?: SharedListPayload | null }>(response);
  if (!response.ok) throw new Error(data.error ?? `读取失败（${response.status}）`);
  return data.list ?? null;
}

export async function putSharedList(
  code: string,
  baseVersion: number,
  payload: string,
): Promise<PutResult> {
  const response = await fetch(apiUrl('/api/list'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, baseVersion, payload }),
  });
  const data = await parse<{ version?: number; list?: SharedListPayload | null }>(response);
  if (response.status === 409) return { ok: false, list: data.list ?? null };
  if (!response.ok) throw new Error(data.error ?? `同步失败（${response.status}）`);
  return { ok: true, version: data.version };
}
