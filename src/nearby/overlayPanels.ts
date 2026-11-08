import { createModuleStore } from '../ui/createModuleStore';

/**
 * 手机端悬浮球「展开后显示哪些面板」配置（2026-11-08）。
 *
 * 口径见 docs/手机端悬浮窗-方案.md §2.1 / §7：
 * - 只有一个球，展开后顶部是战斗命中、下面是附近面板（地图 + 紧凑列表）；
 * - 两项可自由组合，至少保留一项；默认两个都开；
 * - 只存本机（`roco.nearbyOverlayPanels`），不跟随账号、不与 PC 同步。
 */
export interface NearbyOverlayPanels {
  /** 展开后顶部一行战斗命中（命中数量 + 当前目标） */
  battle: boolean;
  /** 展开后下方的附近面板（地图 + 紧凑列表） */
  nearby: boolean;
}

export type NearbyOverlayPanelKey = keyof NearbyOverlayPanels;

export const NEARBY_OVERLAY_PANELS_KEY = 'roco.nearbyOverlayPanels';

export const DEFAULT_NEARBY_OVERLAY_PANELS: NearbyOverlayPanels = { battle: true, nearby: true };

/**
 * 缺字段 / 非布尔 / 坏数据一律按「开启」处理：
 * 旧 APK、旧网页或早期本机记忆缺字段时，行为与「两个都开」一致。
 */
export function normalizeNearbyOverlayPanels(value: unknown): NearbyOverlayPanels {
  if (!value || typeof value !== 'object') return { ...DEFAULT_NEARBY_OVERLAY_PANELS };
  const record = value as Record<string, unknown>;
  const battle = typeof record.battle === 'boolean' ? record.battle : true;
  const nearby = typeof record.nearby === 'boolean' ? record.nearby : true;
  // 两项都关没有意义（展开后什么都没有），回退默认
  if (!battle && !nearby) return { ...DEFAULT_NEARBY_OVERLAY_PANELS };
  return { battle, nearby };
}

const store = createModuleStore<NearbyOverlayPanels>({ ...DEFAULT_NEARBY_OVERLAY_PANELS }, {
  persistKey: NEARBY_OVERLAY_PANELS_KEY,
  migrate: normalizeNearbyOverlayPanels,
});

export function readNearbyOverlayPanels(): NearbyOverlayPanels {
  return normalizeNearbyOverlayPanels(store.get());
}

/** 「附近」页设置区的 hook：配置变化时触发重渲染（写入时已归一化，直接返回引用） */
export function useNearbyOverlayPanels(): NearbyOverlayPanels {
  return store.use();
}

export function setNearbyOverlayPanels(panels: NearbyOverlayPanels): NearbyOverlayPanels {
  const next = normalizeNearbyOverlayPanels(panels);
  store.set(next);
  return next;
}

/** 切换单项；关掉最后一项时不生效（返回当前值）。 */
export function setNearbyOverlayPanel(key: NearbyOverlayPanelKey, enabled: boolean): NearbyOverlayPanels {
  const current = readNearbyOverlayPanels();
  const next = { ...current, [key]: enabled };
  if (!next.battle && !next.nearby) return current;
  store.set(next);
  return next;
}

/** 这项是不是「最后一个还开着的」：是则界面置灰，避免两个都关。 */
export function isLastEnabledNearbyOverlayPanel(
  panels: NearbyOverlayPanels,
  key: NearbyOverlayPanelKey,
): boolean {
  const other: NearbyOverlayPanelKey = key === 'battle' ? 'nearby' : 'battle';
  return panels[key] && !panels[other];
}

/** 测试用：恢复默认（两个都开）。 */
export function resetNearbyOverlayPanelsForTest(): void {
  store.set({ ...DEFAULT_NEARBY_OVERLAY_PANELS });
}
