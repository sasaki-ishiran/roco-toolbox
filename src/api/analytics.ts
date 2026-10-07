/**
 * 匿名使用统计（自建埋点，2026-10-06）
 *
 * 只上报「随机设备 id + 事件名 + 少量参数」：不采集精灵内容、不做用户画像、不用 cookie。
 * 用户可以在「导入数据」页关掉（localStorage `roco.analyticsOff`）。
 *
 * 攒批上报：满 20 条 / 每 15 秒 / 页面切到后台时各发一次；失败就留在队列里下次重试
 * （不影响任何功能，网络不通时静默丢弃）。
 */
const DEVICE_KEY = 'roco.deviceId';
const OPT_OUT_KEY = 'roco.analyticsOff';
const TOKEN_KEY = 'roco.deviceToken';
const MAX_QUEUE = 200;
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 15_000;

/** 本地 dev 时前端跑在 vite（没有 /api），指向线上 Pages；线上与 API 同域，走相对路径 */
export const API_BASE = import.meta.env.DEV ? 'https://roco-toolbox.pages.dev' : '';

interface QueuedEvent {
  name: string;
  props?: Record<string, unknown>;
  ts: number;
}

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

/** 匿名设备 id：首次使用时生成并长期保存（换设备/清数据就是新设备） */
export function deviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function analyticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(OPT_OUT_KEY) !== '1';
}

/**
 * 只有线上构建才上报：本地 dev / e2e（vite dev）不上报，免得把测试流量算进真实数据。
 * 想本地调试时，控制台执行 localStorage.setItem('roco.analyticsForce', '1') 即可放开。
 */
function canSend(): boolean {
  if (typeof window === 'undefined') return false;
  return import.meta.env.PROD || window.localStorage.getItem('roco.analyticsForce') === '1';
}

export function setAnalyticsEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OPT_OUT_KEY, enabled ? '0' : '1');
  if (!enabled) queue = [];
}

/** 运行环境：装了壳的 APK / 装成 PWA / 普通浏览器 */
export function platform(): 'apk' | 'pwa' | 'web' {
  if (typeof window === 'undefined') return 'web';
  if (window.RocoShare) return 'apk';
  if (window.matchMedia?.('(display-mode: standalone)').matches) return 'pwa';
  return 'web';
}

export function track(name: string, props?: Record<string, unknown>): void {
  if (!analyticsEnabled() || !canSend() || typeof fetch === 'undefined') return;
  queue.push({ name, props, ts: Date.now() });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  if (queue.length >= BATCH_SIZE) {
    void flushEvents();
    return;
  }
  if (timer === null) {
    timer = setInterval(() => {
      void flushEvents();
    }, FLUSH_INTERVAL_MS);
  }
}

/** 上报队列里的事件（可手动调用；页面切到后台时也会调） */
export async function flushEvents(): Promise<void> {
  if (queue.length === 0 || !analyticsEnabled() || !canSend()) return;
  const batch = queue.slice(0, BATCH_SIZE);
  queue = queue.slice(batch.length);
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    const response = await fetch(`${API_BASE}/api/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        deviceId: deviceId(),
        appVersion: typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : '',
        platform: platform(),
        events: batch,
      }),
      keepalive: true,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    // 上报失败不打扰用户：把没发出去的塞回队首，下次再试（队列有上限）
    queue = [...batch, ...queue].slice(-MAX_QUEUE);
  }
}

/** App 启动时挂一次：切到后台/关页面前把队列发出去 */
export function installFlushOnHide(): () => void {
  if (typeof document === 'undefined') return () => {};
  const onHidden = () => {
    if (document.visibilityState === 'hidden') void flushEvents();
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onHidden);
  return () => {
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', onHidden);
  };
}
