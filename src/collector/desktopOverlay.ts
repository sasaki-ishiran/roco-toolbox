/**
 * PC 附近精灵悬浮小窗（2026-11-08）。
 *
 * 主窗口「附近」页把解析好的列表 + 自身坐标推给主进程，主进程渲染一个无边框置顶小窗
 * （列表 + 小地图）。手机端没有这套接口，调用会静默跳过；安卓悬浮窗仍走 RocoCapture。
 */
export interface DesktopOverlayPet {
  key: string;
  name: string;
  level: number;
  kinds: string[];
  rare: boolean;
  alert: boolean;
  /** 命中原因：demand / alert / rare / colorful / shiny / pollution */
  reason?: string | null;
  nature: string | null;
  gender: string | null;
  /** 相对自身（或估算中心）的距离，米 */
  distanceM: number | null;
  bearingLabel: string | null;
  /** 8 方位箭头（与 bearingLabel 同源，随自身朝向旋转）；没有有效方向时为 null */
  bearingArrow?: string | null;
  /** 声音分贝（-100~100）：小窗直接显示 `+99dB`，不再用「婉转声 / 粗嗓门」分类词 */
  voiceDb?: number | null;
  /** 身高 / 体重百分位（0-100）；图鉴缺区间时为 null */
  heightPct?: number | null;
  weightPct?: number | null;
  x: number | null;
  y: number | null;
}

export interface DesktopOverlayPayload {
  capturing: boolean;
  /** 是否已拿到登录密钥（没拿到时小窗显示「等待登录」） */
  hasKey: boolean;
  scene: number | null;
  self: { x: number; y: number } | null;
  pets: DesktopOverlayPet[];
  updatedAt: number;
  /** 自身朝向（0 = 正北、顺时针，度）：小窗自身点按它旋转；null 时退回圆点 */
  selfHeading?: number | null;
  /** 地图点位（附近所有带坐标的精灵）；缺省时退回 pets */
  mapPets?: Array<{ key: string; kinds: string[]; rare: boolean; alert: boolean; x: number; y: number }>;
}

export function isDesktopOverlaySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.rocoDesktop?.updateNearbyOverlay === 'function';
}

/** 推送数据（空串表示隐藏内容，但窗口由 show/hide 控制） */
export async function pushNearbyOverlay(payload: DesktopOverlayPayload): Promise<void> {
  await window.rocoDesktop?.updateNearbyOverlay?.(JSON.stringify(payload));
}

export async function showNearbyOverlay(): Promise<void> {
  await window.rocoDesktop?.showOverlay?.();
}

export async function hideNearbyOverlay(): Promise<void> {
  await window.rocoDesktop?.hideOverlay?.();
}

export interface DesktopOverlayState {
  theme: 'dark' | 'light';
  collapsed: boolean;
  /** 高级：鼠标直接落到游戏、点不到小窗（Ctrl+Alt+O 恢复） */
  clickThrough: boolean;
}

export async function readDesktopOverlayState(): Promise<DesktopOverlayState | null> {
  if (!window.rocoDesktop?.getOverlayState) return null;
  try {
    const text = await window.rocoDesktop.getOverlayState();
    const parsed = JSON.parse(String(text ?? ''));
    return {
      theme: parsed?.theme === 'light' ? 'light' : 'dark',
      collapsed: Boolean(parsed?.collapsed),
      clickThrough: Boolean(parsed?.clickThrough),
    };
  } catch {
    return null;
  }
}

export async function setDesktopOverlayClickThrough(flag: boolean): Promise<void> {
  await window.rocoDesktop?.setOverlayClickThrough?.(flag);
}
