import type { LiveNearbyPet } from '../collector/captureProgress';

/**
 * 附近雷达的几何计算（2026-11-06）。
 *
 * 真实抓包里没有自身坐标帧（307/348 缺失），按逆向文档 §3.3 用附近实体坐标的
 * 几何中位数近似自身位置。所有距离都是「相对估算中心」，不能当作玩家真实距离。
 *
 * 游戏世界坐标 100 单位 = 1 米（与多多工具箱一致）。
 */
export const WORLD_UNITS_PER_METER = 100;

export interface RadarVector {
  x: number;
  y: number;
}

const BEARING_LABELS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
const BEARING_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/** Weiszfeld 迭代的几何中位数；空集 → null，单点 → 自身。 */
export function geometricMedian(points: readonly RadarVector[]): RadarVector | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { x: points[0].x, y: points[0].y };
  let current: RadarVector = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
  for (let iteration = 0; iteration < 24; iteration += 1) {
    let weightX = 0;
    let weightY = 0;
    let weightSum = 0;
    for (const point of points) {
      const distance = Math.hypot(point.x - current.x, point.y - current.y);
      // 与当前点重合时给一个极大但有限的权重，避免除零；重合点本身会在下一轮收敛。
      const weight = 1 / Math.max(distance, 1e-9);
      weightX += point.x * weight;
      weightY += point.y * weight;
      weightSum += weight;
    }
    const next = { x: weightX / weightSum, y: weightY / weightSum };
    const moved = Math.hypot(next.x - current.x, next.y - current.y);
    current = next;
    if (moved < 1e-9) break;
  }
  return current;
}

/** 向上取整到 1/2/5 × 10^n，用于雷达圈距标注。 */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;
  const step = [1, 2, 5, 10].find((candidate) => candidate >= normalized) ?? 10;
  return step * power;
}

export interface RadarPoint {
  key: string;
  name: string;
  level: number;
  rare: boolean;
  alert: boolean;
  kinds: string[];
  /** 性格（宠物记录回填）；未知为 null */
  nature: string | null;
  /** 性别（宠物记录回填）；未知为 null */
  gender: string | null;
  /** 相对估算中心的方向角（0 = 北，顺时针） */
  bearingDeg: number;
  bearingLabel: string;
  bearingArrow: string;
  distanceM: number;
  /** 归一化坐标 [-1,1]，y 轴向下为南（与地图落图同一套） */
  nx: number;
  ny: number;
}

export interface RadarData {
  origin: RadarVector | null;
  maxDistanceM: number;
  points: RadarPoint[];
  /** 没有坐标、无法上雷达的精灵 */
  unplaced: LiveNearbyPet[];
  /** 超出固定视野、没有画到雷达上的精灵数量 */
  outsideRadius: number;
}

function hasPosition(pet: LiveNearbyPet): pet is LiveNearbyPet & { pos: { x: number; y: number; z: number } } {
  return Boolean(
    pet.pos
    && Number.isFinite(pet.pos.x)
    && Number.isFinite(pet.pos.y)
    && Number.isFinite(pet.pos.z),
  );
}

function bearingOf(dx: number, dy: number): { deg: number; label: string; arrow: string } {
  // 世界坐标 y 轴指向南（与 `public/maps/maps.json` 的 "y":"south" 一致）：
  // 北是 -dy，所以用 atan2(dx, -dy) 才能得到「0 = 北、顺时针」。
  const deg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const index = Math.round(deg / 45) % 8;
  return { deg, label: BEARING_LABELS[index], arrow: BEARING_ARROWS[index] };
}

export interface RadarOptions {
  /** 覆盖中心（估算自身位置）；null / 不传时退回精灵几何中位数 */
  origin?: RadarVector | null;
  /** 视野半径下限（米），避免精灵少时把点放大到失真、也便于感知靠近 */
  minRadiusM?: number;
  /**
   * 固定视野半径（米）。给了就以它为准，不再按最远精灵缩放——
   * 这样玩家走动时点位会真正向内收，而不是整张图自动重算比例。
   */
  radiusM?: number;
  /**
   * origin 是否是可信的自身坐标（上行 307）。可信时不再落回「最密集精灵」，
   * 否则玩家走动后中心会被精灵密度抢走、雷达看起来还是不动。
   */
  trustOrigin?: boolean;
}

/** 雷达默认覆盖半径（米）：与多多工具箱附近页的 120 m 视野一致。 */
export const DEFAULT_RADAR_RADIUS_M = 115;

/** 在固定视野下，选「周围精灵最多」的那只作为新的雷达中心（离玩家最近的聚集区）。 */
function densestOrigin(
  placed: readonly (LiveNearbyPet & { pos: { x: number; y: number; z: number } })[],
  radiusM: number,
): RadarVector {
  let best = { x: placed[0].pos.x, y: placed[0].pos.y };
  let bestCount = -1;
  for (const pet of placed) {
    let count = 0;
    for (const other of placed) {
      const distance = Math.hypot(pet.pos.x - other.pos.x, pet.pos.y - other.pos.y) / WORLD_UNITS_PER_METER;
      if (distance <= radiusM) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = { x: pet.pos.x, y: pet.pos.y };
    }
  }
  return best;
}

export function buildRadar(pets: readonly LiveNearbyPet[], options: RadarOptions = {}): RadarData {
  const placed = pets.filter(hasPosition);
  const unplaced = pets.filter((pet) => !hasPosition(pet));
  if (placed.length === 0) {
    return {
      origin: options.origin ?? null,
      maxDistanceM: options.radiusM ?? options.minRadiusM ?? 1,
      points: [],
      unplaced,
      outsideRadius: 0,
    };
  }
  const fixedRadius = options.radiusM != null
    ? Math.max(options.radiusM, options.minRadiusM ?? 1)
    : null;
  let origin = options.origin
    ?? geometricMedian(placed.map((pet) => ({ x: pet.pos.x, y: pet.pos.y })))!;
  // 固定视野下如果当前中心离大部分精灵太远（上一个场景残留 / 里程计漂移），
  // 就重新落到精灵最密集的位置，避免整张雷达因为一只远处实体被拉成几千米。
  if (fixedRadius != null && !options.trustOrigin) {
    const within = placed.filter((pet) =>
      Math.hypot(pet.pos.x - origin.x, pet.pos.y - origin.y) / WORLD_UNITS_PER_METER <= fixedRadius).length;
    if (within < Math.ceil(placed.length / 2)) origin = densestOrigin(placed, fixedRadius);
  }
  const rawDistances = placed.map((pet) =>
    Math.hypot(pet.pos.x - origin.x, pet.pos.y - origin.y) / WORLD_UNITS_PER_METER);
  const maxDistanceM = fixedRadius
    ?? Math.max(niceCeil(Math.max(...rawDistances)), options.minRadiusM ?? 1);
  const scale = maxDistanceM * WORLD_UNITS_PER_METER;
  const keep: number[] = [];
  for (let index = 0; index < placed.length; index += 1) {
    if (fixedRadius == null || rawDistances[index] <= maxDistanceM + 1e-9) keep.push(index);
  }
  const points = keep.map((index) => {
    const pet = placed[index];
    const dx = pet.pos.x - origin.x;
    const dy = pet.pos.y - origin.y;
    const bearing = bearingOf(dx, dy);
    return {
      key: pet.key,
      name: pet.name,
      level: pet.level,
      rare: pet.rare,
      alert: pet.alertReason != null,
      kinds: pet.kinds,
      nature: pet.nature || null,
      gender: pet.gender || null,
      bearingDeg: bearing.deg,
      bearingLabel: bearing.label,
      bearingArrow: bearing.arrow,
      distanceM: rawDistances[index],
      nx: dx / scale,
      // 渲染端是 cy = center + ny * radius（向下为正），与地图「y 向南」一致
      ny: dy === 0 ? 0 : dy / scale,
    };
  });
  return { origin, maxDistanceM, points, unplaced, outsideRadius: placed.length - keep.length };
}
