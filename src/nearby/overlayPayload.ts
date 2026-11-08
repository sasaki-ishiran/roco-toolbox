import type { DesktopOverlayPet, DesktopOverlayPayload } from '../collector/desktopOverlay';
import type { NearbySnapshot } from '../collector/nearbyStore';
import { buildRadar } from '../pcap/nearbyRadar';

/**
 * 手机端悬浮面板 payload 组装（2026-11-08）。
 *
 * 只做「附近快照 → 悬浮面板要显示的数据」这一段纯函数，不碰页面与原生。
 * 口径与 PC 小窗一致（见 docs/手机端悬浮窗-方案.md §7）：
 * - 字段直接复用 `DesktopOverlayPet` / `DesktopOverlayPayload`，只加手机端需要的计数与是否可见；
 * - 列表最多 8 条，按「提醒 > 稀有 > 距离」排序，超出部分截断但总数保留；
 * - 方向为 8 方位标签，距离 100 世界单位 = 1 米；
 * - 没有自身坐标时以附近精灵几何中位数为中心，并标记 `selfEstimated`。
 */

/** 悬浮面板列表上限（与 PC 小窗一致）。 */
export const OVERLAY_PET_LIMIT = 8;

/** 小于这个距离（米）时方向没有意义，返回 null 而不是随便给一个方位。 */
const MIN_BEARING_DISTANCE_M = 0.05;

export interface NearbyOverlayPayload extends DesktopOverlayPayload {
  /** 采集中才显示面板；停止采集即收起隐藏 */
  visible: boolean;
  /** 附近精灵总数（截断前的数量） */
  total: number;
  /** 稀有总数（截断前） */
  rareTotal: number;
  /** 可提醒总数（截断前） */
  alertTotal: number;
  /** true = 没有真实自身坐标，`self` 为附近精灵的估算中心 */
  selfEstimated: boolean;
}

export interface NearbyOverlaySource {
  capturing: boolean;
  hasKey: boolean;
  /** 最近一帧附近快照；null 表示还没收到数据 */
  snapshot: NearbySnapshot | null;
  /** 推送时间；不传时用快照的更新时间 */
  now?: number;
}

/** 提醒 > 稀有 > 距离近 > key 稳定排序。 */
function comparePets(left: DesktopOverlayPet, right: DesktopOverlayPet): number {
  const alert = Number(right.alert) - Number(left.alert);
  if (alert !== 0) return alert;
  const rare = Number(right.rare) - Number(left.rare);
  if (rare !== 0) return rare;
  const leftDistance = left.distanceM ?? Number.POSITIVE_INFINITY;
  const rightDistance = right.distanceM ?? Number.POSITIVE_INFINITY;
  if (leftDistance !== rightDistance) return leftDistance - rightDistance;
  return left.key.localeCompare(right.key);
}

export function buildNearbyOverlayPayload(source: NearbyOverlaySource): NearbyOverlayPayload {
  const { capturing, hasKey, snapshot } = source;
  const pets = snapshot?.pets ?? [];
  const self = snapshot?.self ?? null;
  // 有自身坐标就以它为中心；没有就用附近精灵的几何中位数（并标记估算）
  const radar = buildRadar(pets, self ? { origin: self, trustOrigin: true } : {});
  const pointByKey = new Map(radar.points.map((point) => [point.key, point]));

  const items = pets.map<DesktopOverlayPet>((item) => {
    const point = pointByKey.get(item.key);
    const distanceM = point?.distanceM ?? item.distanceM ?? null;
    return {
      key: item.key,
      name: item.name,
      level: item.level,
      kinds: item.kinds,
      rare: item.rare,
      alert: item.alertReason != null,
      nature: item.nature || null,
      gender: item.gender || null,
      distanceM,
      bearingLabel: point && point.distanceM >= MIN_BEARING_DISTANCE_M ? point.bearingLabel : null,
      x: item.pos?.x ?? null,
      y: item.pos?.y ?? null,
    };
  });

  return {
    visible: capturing,
    capturing,
    hasKey,
    scene: snapshot?.scene ?? null,
    self: radar.origin,
    pets: items.sort(comparePets).slice(0, OVERLAY_PET_LIMIT),
    total: pets.length,
    rareTotal: pets.filter((item) => item.rare).length,
    alertTotal: pets.filter((item) => item.alertReason != null).length,
    selfEstimated: self == null,
    updatedAt: source.now ?? snapshot?.updatedAt ?? Date.now(),
  };
}
