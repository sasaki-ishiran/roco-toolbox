/**
 * 跨环境共享的本地偏好（2026-11-09）。
 *
 * 测试站与正式站是两个 origin，localStorage 天然隔离：切服后新手教程会重弹、
 * 账号登录态也会丢。安卓壳提供 `window.RocoPrefs`，把值存进 App 自己的
 * SharedPreferences，网页按「谁最后一次写入」合并：
 * - 写：同时写 localStorage（带时间戳）与壳（带时间戳）；
 * - 读：两边时间戳取较新的那份，并把结果回填 localStorage。
 *
 * 浏览器里没有壳，退化为纯 localStorage，行为与以前一致。
 */

interface PrefsBridge {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** 本地记录时间戳的键前缀（不出现在界面文案里，只内部用）。 */
const AT_PREFIX = '__roco.sharedAt.';

interface Packed {
  v: string;
  at: number;
}

export function prefsBridge(): PrefsBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { RocoPrefs?: Partial<PrefsBridge> }).RocoPrefs;
  if (!bridge || typeof bridge.get !== 'function' || typeof bridge.set !== 'function') return null;
  return bridge as PrefsBridge;
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 隐私模式写不了：壳里那份仍然有效
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 同上
  }
}

function parsePacked(raw: string | null): Packed | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Packed>;
    if (typeof parsed.v !== 'string' || typeof parsed.at !== 'number') return null;
    return { v: parsed.v, at: parsed.at };
  } catch {
    return null;
  }
}

/** 读一个可跨环境共享的值：localStorage 与壳里的时间戳取新者。 */
export function readShared(key: string): string | null {
  if (typeof window === 'undefined') return null;
  const local = safeGet(key);
  const bridge = prefsBridge();
  if (!bridge) return local;
  let packed: Packed | null = null;
  try {
    packed = parsePacked(bridge.get(key));
  } catch {
    packed = null;
  }
  if (!packed) return local;
  const localAt = Number(safeGet(AT_PREFIX + key) ?? 0) || 0;
  if (packed.at > localAt) {
    safeSet(key, packed.v);
    safeSet(AT_PREFIX + key, String(packed.at));
    return packed.v;
  }
  return local;
}

/** 写一个可跨环境共享的值：localStorage 与壳同时写，切服后仍是这份。 */
export function writeShared(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  const at = Date.now();
  safeSet(key, value);
  const bridge = prefsBridge();
  if (!bridge) return;
  safeSet(AT_PREFIX + key, String(at));
  try {
    bridge.set(key, JSON.stringify({ v: value, at }));
  } catch {
    // 壳写失败就只留本地，不影响当前页面
  }
}

/** 把一个键在本环境已有的值同步进壳（首次装新版时调用，之后切服两边一致）。 */
export function syncShared(key: string): void {
  const value = readShared(key);
  if (value != null) writeShared(key, value);
}

/** 删掉一个共享值（退出登录等）。 */
export function removeShared(key: string): void {
  if (typeof window === 'undefined') return;
  safeRemove(key);
  safeRemove(AT_PREFIX + key);
  const bridge = prefsBridge();
  if (!bridge || typeof bridge.remove !== 'function') return;
  try {
    bridge.remove(key);
  } catch {
    // 壳删失败不阻塞退出流程
  }
}
