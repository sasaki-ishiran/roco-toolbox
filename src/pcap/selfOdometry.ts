import type { LiveNearbyPet } from '../collector/captureProgress';
import { geometricMedian, WORLD_UNITS_PER_METER, type RadarVector } from './nearbyRadar';

/**
 * 估算自身位置（2026-11-06）。
 *
 * 真实抓包里没有自身坐标帧（307/348 缺失），而「用附近精灵坐标的几何中位数当中心」
 * 有个致命缺陷：玩家走动时视野内精灵整体平移，中位数也同量平移，归一化后点位**看起来不动**，
 * 于是「实际靠近了但雷达没靠近」。
 *
 * 这里改用里程计：相邻两帧里同时出现的精灵，其坐标位移的中位数就是「世界相对你」的位移，
 * 取反累加到估算自身位置上。这样中心真正跟着玩家走，精灵才会随距离变化收缩/外扩。
 */
export interface SelfEstimate {
  /** 采集会话；换会话（切场景）时重新初始化 */
  session: string | null;
  /** 估算的自身世界坐标 */
  self: RadarVector | null;
  /** 上一帧各精灵坐标，用于计算帧间位移 */
  frame: Map<string, RadarVector>;
  updatedAt: number;
  /** 最近一次上行 307 的真实坐标：有它就以它为锚点，避免里程计长期漂移 */
  anchor: RadarVector | null;
  anchorAt: number;
}

/** 单帧位移超过这个米数视为切场景 / 瞬移，重新初始化而不是累加误差。 */
export const MAX_FRAME_SHIFT_M = 200;

/** 初始化时至少要有这么多只可定位精灵才敢给出中心。 */
const MIN_INIT_POINTS = 1;

export function createSelfEstimate(): SelfEstimate {
  return { session: null, self: null, frame: new Map(), updatedAt: 0, anchor: null, anchorAt: 0 };
}

function hasPosition(pet: LiveNearbyPet): pet is LiveNearbyPet & { pos: { x: number; y: number; z: number } } {
  return Boolean(
    pet.pos
    && Number.isFinite(pet.pos.x)
    && Number.isFinite(pet.pos.y)
    && Number.isFinite(pet.pos.z),
  );
}

export function updateSelfEstimate(
  previous: SelfEstimate,
  session: string,
  pets: readonly LiveNearbyPet[],
  now = Date.now(),
  /** 本帧解到的真实自身坐标（上行 307）；有就用它重锚，没有就继续累加位移 */
  anchor: RadarVector | null = null,
): SelfEstimate {
  const placed = pets.filter(hasPosition);
  const frame = new Map(placed.map((pet) => [pet.key, { x: pet.pos.x, y: pet.pos.y }]));
  const init = (): SelfEstimate => ({
    session,
    self: anchor ?? (placed.length >= MIN_INIT_POINTS
      ? geometricMedian(placed.map((pet) => ({ x: pet.pos.x, y: pet.pos.y })))
      : null),
    frame,
    updatedAt: now,
    anchor: anchor ? { ...anchor } : null,
    anchorAt: anchor ? now : 0,
  });

  if (previous.session !== session || previous.self == null) return init();
  // 新的真实坐标：直接以它为准，里程计从锚点重新起算
  if (anchor && (previous.anchor == null || previous.anchor.x !== anchor.x || previous.anchor.y !== anchor.y)) {
    return {
      session,
      self: { ...anchor },
      frame,
      updatedAt: now,
      anchor: { ...anchor },
      anchorAt: now,
    };
  }
  if (placed.length === 0) return init();

  // 相邻两帧同时出现的精灵：坐标位移中位数 = 世界相对玩家的位移
  const shifts: RadarVector[] = [];
  for (const [key, position] of frame) {
    const before = previous.frame.get(key);
    if (!before) continue;
    shifts.push({ x: position.x - before.x, y: position.y - before.y });
  }
  if (shifts.length === 0) {
    // 视野内精灵整批换掉：玩家已经走到别的区域，新精灵是在新位置附近刷出来的。
    // 继续停在上一个中心会让地图永远不动（2026-11-10 真机：self 恒定、near 从 6m 涨到 971m）。
    const overlap = [...frame.keys()].some((key) => previous.frame.has(key));
    if (!overlap && placed.length >= MIN_INIT_POINTS) return init();
    return { ...previous, session, frame, updatedAt: now };
  }
  const shift = geometricMedian(shifts)!;
  const shiftM = Math.hypot(shift.x, shift.y) / WORLD_UNITS_PER_METER;
  if (shiftM > MAX_FRAME_SHIFT_M) return init();
  return {
    session,
    // 精灵相对世界移动 = 玩家反向移动，所以取反
    self: { x: previous.self.x - shift.x, y: previous.self.y - shift.y },
    frame,
    updatedAt: now,
    anchor: previous.anchor,
    anchorAt: previous.anchorAt,
  };
}
