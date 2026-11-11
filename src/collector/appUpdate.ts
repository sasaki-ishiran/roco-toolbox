/**
 * 应用内更新（1.3.6）：「我的」页更新入口 A 的网页侧。
 *
 * 壳负责请求版本清单、弹提示、下载 APK 并调起安装器；网页只做三件事：
 * 读当前客户端版本、触发一次检查、接收壳推回来的检查结果。
 * 壳侧注入 `window.__rocoUpdateStatus`（MainActivity.UpdateBridge 同一份 RocoUpdate）。
 */
declare global {
  interface Window {
    RocoUpdate?: { check?: () => void; version?: () => string };
    __rocoUpdateStatus?: (detail: unknown) => void;
  }
}

export type AppUpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'failed';

export interface AppUpdateSnapshot {
  state: AppUpdateState;
  /** 当前客户端版本，如 "1.3.6"；网页版为空串 */
  current: string;
  /** 清单里的新版本号；没有新版为 null */
  latest: string | null;
  /** 检查失败的原因 */
  message: string | null;
}

const IDLE: AppUpdateSnapshot = { state: 'idle', current: '', latest: null, message: null };

let snapshot: AppUpdateSnapshot = IDLE;
const listeners = new Set<() => void>();

function emit(next: AppUpdateSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeAppUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function appUpdateSnapshot(): AppUpdateSnapshot {
  return snapshot;
}

/** 当前客户端版本号（"1.3.6"）；网页版 / 旧壳没有更新桥时返回 null。 */
export function currentAppVersion(): string | null {
  const version = window.RocoUpdate?.version;
  if (typeof version !== 'function') return null;
  try {
    const raw = String(version() ?? '');
    const matched = /^\d+\.\d+\.\d+/.exec(raw);
    return matched ? matched[0] : raw || null;
  } catch {
    return null;
  }
}

/** 首屏把「当前版本」填进快照（`version()` 是同步的）。 */
export function seedAppUpdate(): void {
  const current = currentAppVersion();
  if (!current || snapshot.current === current) return;
  emit({ ...snapshot, current });
}

/** 触发一次检查；返回 false 表示当前壳没有更新入口（网页版）。 */
export function checkAppUpdate(): boolean {
  const check = window.RocoUpdate?.check;
  if (typeof check !== 'function') return false;
  emit({ ...snapshot, state: 'checking', message: null });
  // 旧壳没有 __rocoUpdateStatus 回推：10 秒还没有结果就恢复按钮，避免一直显示「检查中」
  window.setTimeout(() => {
    if (snapshot.state === 'checking') emit({ ...snapshot, state: 'idle' });
  }, 10_000);
  try {
    check();
    return true;
  } catch {
    emit({ ...snapshot, state: 'failed', message: '检查失败，请稍后重试' });
    return false;
  }
}

/** 壳的检查结果回推（state = latest / available / failed）。 */
export function receiveAppUpdateStatus(detail: unknown): void {
  const value = (detail ?? {}) as Record<string, unknown>;
  const state: AppUpdateState =
    value.state === 'available' || value.state === 'latest' || value.state === 'failed'
      ? value.state
      : 'idle';
  emit({
    state,
    current: typeof value.currentVersion === 'string' && value.currentVersion
      ? value.currentVersion
      : snapshot.current,
    latest: typeof value.versionName === 'string' && value.versionName ? value.versionName : null,
    message: typeof value.message === 'string' && value.message ? value.message : null,
  });
}

/** 把壳的回推入口挂到 window 上（页面重载后要重新挂）。 */
export function installAppUpdateBridge(): void {
  window.__rocoUpdateStatus = receiveAppUpdateStatus;
}

/** 当前壳是否提供更新入口（网页版没有 RocoUpdate）。 */
export function hasAppUpdateShell(): boolean {
  return typeof window !== 'undefined' && typeof window.RocoUpdate?.check === 'function';
}
