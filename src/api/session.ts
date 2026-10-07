/**
 * 账号会话（免密：设备绑定 + 恢复码，2026-10-06）
 *
 * - 令牌存在 localStorage `roco.deviceToken`，请求带 `Authorization: Bearer`
 * - 「开启云同步」= 开号，服务端返回**一次性恢复码**（页面提醒用户存下来；丢了可在仍登录的设备上重新生成）
 * - 换设备 = 用恢复码换新令牌
 */
import { API_BASE, deviceId } from './analytics';

const TOKEN_KEY = 'roco.deviceToken';
const ACCOUNT_KEY = 'roco.accountId';
/** 本地记住的「上次同步到的云端版本」，用于检测冲突（0 = 没同步过） */
const VERSION_KEY = 'roco.syncVersion';

export interface CloudMeta {
  version: number;
  updatedAt: number;
  bytes: number;
}

export interface MeResult {
  accountId: string;
  createdAt: number;
  snapshot: CloudMeta | null;
}

/** 本地会话状态变化的订阅（账号面板用） */
const listeners = new Set<() => void>();

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function readAccountId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCOUNT_KEY);
}

/** 本地记录的云端版本（冲突判断的依据） */
export function readSyncedVersion(): number {
  if (typeof window === 'undefined') return 0;
  return Number(window.localStorage.getItem(VERSION_KEY) ?? 0) || 0;
}

export function markSynced(version: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VERSION_KEY, String(version));
  notify();
}

/** 清掉会话（退出登录 / 令牌失效）。**不动用户的本地数据。** */
export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ACCOUNT_KEY);
  window.localStorage.removeItem(VERSION_KEY);
  notify();
}

/** 带令牌的请求；令牌失效（401）时清掉本地会话并抛出可读错误 */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = readToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 401) {
    clearSession();
    throw new Error('登录已失效，请重新用恢复码登录');
  }
  return response;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.error ?? `请求失败（${response.status}）`));
  return data as T;
}

/** 读取服务端错误文案（409 之类的非 2xx 也用得到） */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后再试';
}

function remember(accountId: string, token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(ACCOUNT_KEY, accountId);
  notify();
}

/** 开启云同步：开号（服务端返回**一次性**恢复码） */
export async function registerAccount(): Promise<{ accountId: string; recoveryCode: string }> {
  const data = await post<{ accountId: string; token: string; recoveryCode: string }>('/api/auth/register', {
    deviceId: deviceId(),
  });
  remember(data.accountId, data.token);
  markSynced(0);
  return { accountId: data.accountId, recoveryCode: data.recoveryCode };
}

/** 换设备：用恢复码登录（返回账号 id，令牌已保存） */
export async function recoverAccount(recoveryCode: string): Promise<string> {
  const data = await post<{ accountId: string; token: string }>('/api/auth/recover', {
    recoveryCode,
    deviceId: deviceId(),
  });
  remember(data.accountId, data.token);
  return data.accountId;
}

/** 重新生成恢复码（旧的立即失效） */
export async function rotateRecoveryCode(): Promise<string> {
  const response = await authFetch('/api/auth/rotate', { method: 'POST' });
  const data = (await response.json()) as { recoveryCode?: string; error?: string };
  if (!response.ok || !data.recoveryCode) throw new Error(data.error ?? '生成失败');
  return data.recoveryCode;
}

/** 退出登录：撤销令牌（本地数据保留） */
export async function logoutAccount(): Promise<void> {
  try {
    await authFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    clearSession();
  }
}

/** 注销账号：云端数据全删（本地数据保留） */
export async function deleteAccount(): Promise<void> {
  try {
    await authFetch('/api/account', { method: 'DELETE' });
  } finally {
    clearSession();
  }
}

export async function fetchMe(): Promise<MeResult> {
  const response = await authFetch('/api/me');
  const data = (await response.json()) as { ok?: boolean; error?: string } & MeResult;
  if (!response.ok || !data.accountId) throw new Error(data.error ?? '读取账号失败');
  return data;
}
