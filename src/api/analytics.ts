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

/**
 * 换蛋核心链路事件名（2026-11-08）。
 *
 * 与 `docs/superpowers/plans/2026-11-08-整合重构第一批-执行文档.md` §3-A 事件表一一对应；
 * 后端 events 表只存 name/props，不需要为新事件改结构。
 * props 只带数量与状态，不带精灵 / 性格 / 成员等任何内容（沿用现有隐私口径）。
 */
export const ANALYTICS_EVENT = {
  demandPublish: 'demand_publish',
  demandClaim: 'demand_claim',
  demandComplete: 'demand_complete',
  demandWithdraw: 'demand_withdraw',
  placementMark: 'placement_mark',
  groupJoin: 'group_join',
  planCreate: 'plan_create',
  planImport: 'plan_import',
  planStart: 'plan_start',
  offerMark: 'offer_mark',
  demandFail: 'demand_fail',
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT)[keyof typeof ANALYTICS_EVENT];

/** 发布需求成功：count = 本次真正落库的需求条数（一个性格一条）。 */
export function trackDemandPublish(count: number): void {
  track(ANALYTICS_EVENT.demandPublish, { count });
}

/** 认领需求成功：一次一条，只报数量。 */
export function trackDemandClaim(count = 1): void {
  track(ANALYTICS_EVENT.demandClaim, { count });
}

/** 发布人结单成功：一次一条，只报数量。 */
export function trackDemandComplete(count = 1): void {
  track(ANALYTICS_EVENT.demandComplete, { count });
}

/** 撤回自己发布的需求：一次一条，只报数量。 */
export function trackDemandWithdraw(count = 1): void {
  track(ANALYTICS_EVENT.demandWithdraw, { count });
}

/** 需求/计划动作失败（2026-11-08）：只报步骤与错误码，不带用户文案，失败路径也能查到。 */
export function trackDemandFail(step: string, code: string): void {
  track(ANALYTICS_EVENT.demandFail, { step, code });
}

/** 家园需求上窝页里勾「已上窝」：count = 勾完这一下之后已标记的总行数（取消勾选不报）。 */
export function trackPlacementMark(count: number): void {
  track(ANALYTICS_EVENT.placementMark, { count });
}

/** 加入小组成功：不带任何参数（组名 / 邀请码都不上报）。 */
export function trackGroupJoin(): void {
  track(ANALYTICS_EVENT.groupJoin);
}

/* ---------- 收集计划（Track C 使用；2026-11-08 预定义，Track A 不触发） ---------- */

/** 创建收集计划：count = 本次创建条数，bulk = 是否来自批量导入入口。 */
export function trackPlanCreate(count: number, bulk = false): void {
  track(ANALYTICS_EVENT.planCreate, { count, bulk });
}

/** 批量导入缺口到计划：count = 导入条数。 */
export function trackPlanImport(count: number): void {
  track(ANALYTICS_EVENT.planImport, { count });
}

/** 计划从「想收」变「进行中」：count = 本次开始条数。 */
export function trackPlanStart(count = 1): void {
  track(ANALYTICS_EVENT.planStart, { count });
}

/** 点「我能提供」：count = 本次标记条数。 */
export function trackOfferMark(count = 1): void {
  track(ANALYTICS_EVENT.offerMark, { count });
}
