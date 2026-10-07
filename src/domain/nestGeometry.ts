/**
 * 家园摆位的几何模型。
 *
 * 坐标单位 = **家园地板最小移动单元**（游戏里能按它一格一格挪小窝）。1 窝 = **8 单元**。
 * 口径来源：2026-10-06 用户游戏内实测（横排并排时一只下移 7 下再右移仍冲突、8 下才不冲突，
 * 竖排同样 8）→ 小窝是 8×8 的正方形；与蛋神助手的「中心欧氏 ≤2.125 窝」一致（2.125 × 8 = 17）。
 * - 每个小窝占 8×8 单元，左上角坐标为整数（**1 单元精度** = 游戏里的微调粒度）。
 * - 两窝**中心欧氏距离 ≤ 17 单元**才能配对；斜向可连，但 (16,6) 单元 = 17.09 连不上。
 * - 小窝不可重叠：切比雪夫距离 ≥ 8 单元。
 *
 * 摆位目标（2026-10-06 用户口径修正）：**不是「簇内两两全连」**。
 * 一簇里各窝的蛋组/性格本来就不全相容，有些窝天然配不上对；把它们摆在一起只是为了
 * **尽量多连上能连的边**——M1 下每条公母连线各自独立判定，线越多命中机会越多。
 * 所以布局用**贪心密排**：每放一个新窝，都挑「与已放置的窝连线最多、其次最紧凑」的位置。
 * 簇与簇之间拉开 > 17 单元，避免跨簇串窝。
 */
export interface NestPosition {
  x: number;
  y: number;
}

/** 小窝边长（单元）：1 窝 = 8 单元。 */
export const NEST_SIZE = 8;

/** 可配对距离上限（单元）：2.125 窝 × 8 = 17。 */
export const PAIR_RANGE = 17;

/** 两个小窝中心的**欧氏**距离（传入左上角坐标，单位：单元）。 */
export const centerDistance = (a: NestPosition, b: NestPosition): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** 两个 8×8 小窝是否重叠。 */
export const nestsOverlap = (a: NestPosition, b: NestPosition): boolean =>
  Math.abs(a.x - b.x) < NEST_SIZE && Math.abs(a.y - b.y) < NEST_SIZE;

/** 两窝能否配对（中心欧氏距离 ≤ 17 单元）。 */
export const nestsConnect = (a: NestPosition, b: NestPosition): boolean =>
  centerDistance(a, b) <= PAIR_RANGE;

/**
 * 相对一个已放置的窝，所有「不压到它、又在可连范围内」的偏移（1 单元精度）。
 * 这就是游戏里把新窝挪到老窝旁边时，所有能跟它连上的落点。
 */
function ringOffsets(): NestPosition[] {
  const offsets: NestPosition[] = [];
  for (let dx = -PAIR_RANGE; dx <= PAIR_RANGE; dx += 1) {
    for (let dy = -PAIR_RANGE; dy <= PAIR_RANGE; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      if (Math.hypot(dx, dy) > PAIR_RANGE) continue;
      if (Math.abs(dx) < NEST_SIZE && Math.abs(dy) < NEST_SIZE) continue; // 压到了
      offsets.push({ x: dx, y: dy });
    }
  }
  return offsets;
}

/** 相对一个已放置的窝，所有「不压到它、又在可连范围内」的落点（1 单元精度）。 */
export const RING_OFFSETS = ringOffsets();

/** 已有的窝把周围全占满时的兜底：从原点向外找最近的空位。 */
export function nearestFreeSpot(placed: NestPosition[]): NestPosition {
  for (let radius = 1; radius <= 3 * PAIR_RANGE; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (const dy of [-radius, radius]) {
        const candidate = { x: dx, y: dy };
        if (!placed.some((p) => nestsOverlap(p, candidate))) return candidate;
      }
    }
    for (let dy = -radius + 1; dy <= radius - 1; dy += 1) {
      for (const dx of [-radius, radius]) {
        const candidate = { x: dx, y: dy };
        if (!placed.some((p) => nestsOverlap(p, candidate))) return candidate;
      }
    }
  }
  return { x: 0, y: 0 };
}

/** 把一组偏移平移到左上角为 (0,0)，方便拼多个簇。 */
function normalize(offsets: NestPosition[]): NestPosition[] {
  const minX = Math.min(...offsets.map((offset) => offset.x));
  const minY = Math.min(...offsets.map((offset) => offset.y));
  return offsets.map((offset) => ({ x: offset.x - minX, y: offset.y - minY }));
}

export interface Placement<T> {
  item: T;
  position: NestPosition;
}

/** 评分向量：**逐项按「越大越好」比较**（要「越小越好」就取负）。 */
export type PlacementScore = number[];

const isBetter = (a: PlacementScore, b: PlacementScore): boolean => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
};

/**
 * 贪心摆位（1 单元精度）：按 `ordered` 顺序逐个放窝，每个新窝都在「已放置的窝周围所有
 * 能连上的空位」里挑评分最高的。评分由调用方给（`score` 越大越好，逐项按字典序比较）。
 * 当前位置一个都放不下时，退到最近的空位。
 */
export function placeGreedy<T>(
  ordered: T[],
  score: (item: T, position: NestPosition, placed: Placement<T>[]) => PlacementScore,
): Placement<T>[] {
  const placed: Placement<T>[] = [];
  for (const item of ordered) {
    if (placed.length === 0) {
      placed.push({ item, position: { x: 0, y: 0 } });
      continue;
    }
    let best: NestPosition | null = null;
    let bestScore: PlacementScore | null = null;
    for (const anchor of placed) {
      for (const offset of RING_OFFSETS) {
        const candidate = { x: anchor.position.x + offset.x, y: anchor.position.y + offset.y };
        if (placed.some((p) => nestsOverlap(p.position, candidate))) continue;
        const candidateScore = score(item, candidate, placed);
        if (best === null || bestScore === null || isBetter(candidateScore, bestScore)) {
          best = candidate;
          bestScore = candidateScore;
        }
      }
    }
    placed.push({
      item,
      position: best ?? nearestFreeSpot(placed.map((p) => p.position)),
    });
  }
  return placed;
}

/**
 * 纯几何密排一个簇：每放一个新窝，都挑「与已放置的窝**连线数最多**、其次**总距离最小**」的位置。
 * ≤6 个窝时能做到两两相连；更多时放下尽可能多的连线。
 * （nestPlan 会用带蛋组/性格权重的评分走 `placeGreedy`，这里是不知道领域信息的通用版。）
 */
export function buildClusterOffsets(size: number): NestPosition[] {
  if (size <= 0) return [];
  const placed = placeGreedy(
    Array.from({ length: size }, (_, index) => index),
    (_item, position, already) => [
      already.filter((p) => nestsConnect(p.position, position)).length,
      -already.reduce((sum, p) => sum + centerDistance(p.position, position), 0),
    ],
  );
  return normalize(placed.map((p) => p.position));
}

/** 组间横向间距（单元）：必须 > 17，取 24（= 3 窝）留余量。 */
export const GROUP_GAP = 24;

/**
 * 把若干个簇并排摆开：每个簇内部平移到左上角 (0,0)，簇与簇横向拉开 ≥24 单元（互不连线，防串窝）。
 */
export function arrangeClusters(clusters: NestPosition[][]): NestPosition[][] {
  const arranged: NestPosition[][] = [];
  let cursor = 0;
  for (const cluster of clusters) {
    if (cluster.length === 0) {
      arranged.push([]);
      continue;
    }
    const normalized = normalize(cluster);
    arranged.push(normalized.map((position) => ({ x: cursor + position.x, y: position.y })));
    cursor += Math.max(...normalized.map((position) => position.x), 0) + GROUP_GAP;
  }
  return arranged;
}

export interface LayoutViolation {
  a: NestPosition;
  b: NestPosition;
  distance: number;
}

export interface LayoutReport {
  /** 没有跨组串连、没有重叠、且所有「本该成立」的配对边都在范围内 → true */
  ok: boolean;
  /** 跨组却 ≤17 单元的窝对（会串窝） */
  crossLinks: LayoutViolation[];
  /** 重叠的窝对 */
  overlaps: LayoutViolation[];
  /** 组内「本该成立」的配对边却超出可连范围（摆位失真，图上会画出游戏里连不上的线） */
  outOfRange: LayoutViolation[];
}

/**
 * 校验一份编组式布局。
 * - 跨组不能连线（防串窝）、同组不能重叠；
 * - 传了 `intendedPairs`（我们声称会成立的配对）时，还要逐条检查它们是否真的在可连范围内。
 */
export function checkLayout(
  clusters: NestPosition[][],
  intendedPairs: Array<[NestPosition, NestPosition]> = [],
): LayoutReport {
  const crossLinks: LayoutViolation[] = [];
  const overlaps: LayoutViolation[] = [];
  const outOfRange: LayoutViolation[] = [];
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      for (const a of clusters[i]) {
        for (const b of clusters[j]) {
          const distance = centerDistance(a, b);
          if (nestsOverlap(a, b)) overlaps.push({ a, b, distance });
          else if (distance <= PAIR_RANGE) crossLinks.push({ a, b, distance });
        }
      }
    }
    for (let m = 0; m < clusters[i].length; m += 1) {
      for (let n = m + 1; n < clusters[i].length; n += 1) {
        const a = clusters[i][m];
        const b = clusters[i][n];
        if (nestsOverlap(a, b)) overlaps.push({ a, b, distance: centerDistance(a, b) });
      }
    }
  }
  for (const [a, b] of intendedPairs) {
    if (nestsOverlap(a, b)) continue; // 重叠单独报
    const distance = centerDistance(a, b);
    if (distance > PAIR_RANGE) outOfRange.push({ a, b, distance });
  }
  return {
    ok: crossLinks.length === 0 && overlaps.length === 0 && outOfRange.length === 0,
    crossLinks,
    overlaps,
    outOfRange,
  };
}
