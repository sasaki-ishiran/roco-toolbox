import type { DesktopOverlayPet, DesktopOverlayPayload } from '../collector/desktopOverlay';
import type { LiveNearbyPet } from '../collector/captureProgress';
import type { DemandHit } from '../pcap/demandMatch';
import type { NearbySnapshot } from '../collector/nearbyStore';
import { battleTargetAllows, getBattleTarget, type BattleTarget } from '../collector/battleTargetStore';
import { buildRadar } from '../pcap/nearbyRadar';
import { getNearbyFilter, nearbyFilterAllows, type NearbyFilter } from './nearbyFilterStore';
import { countPayloadBuild, capturePerfSummary } from '../collector/perfProbe';

/**
 * 手机端悬浮面板 payload 组装（2026-11-08，口径 2026-11-09 改为「用户感兴趣」）。
 *
 * 只做「附近快照 → 悬浮面板要显示的数据」这一段纯函数，不碰页面与原生。
 * 列表口径（悬浮窗专用，App 内附近页与地图不受影响）：
 * - 总范围沿用附近页顶部三档：全部 / 稀有 / 需求（`nearbyFilterStore`，与页面共用同一份状态与判定）；
 * - 再叠加战斗目标那组维度筛选（性格 / 公母 / 声音 / 体型，`battleTargetStore`）：
 *   某维度没勾 = 该维度全部档位通过，勾了只放行命中项，维度之间按目标的 any / all 叠加；
 * - 命中需求中心恒放行，不受上面两层影响；
 * - 「可提醒」只是解析阶段按声音 / 体重算出的标记，不能绕过筛选单独放行；
 * - `mapPets` 仍给出附近所有带坐标的精灵（最多 24 只），地图 / 雷达照常画全部；
 * - 方向为 8 方位标签 + 箭头，距离 100 世界单位 = 1 米；
 * - 没有自身坐标时以附近精灵几何中位数为中心，并标记 `selfEstimated`。
 */

/**
 * 悬浮面板列表上限。
 * 面板里列表高度封顶在小地图高度、超出可上下滑动（2026-11-09），所以放到 24 条；
 * 再多也只是滚动看不完，仍走「还有 N 只未显示」。
 */
export const OVERLAY_PET_LIMIT = 24;

/** 地图 / 雷达点位上限：列表按筛选，地图要看整体方位，普通精灵也要给点。 */
export const OVERLAY_MAP_POINT_LIMIT = 24;

/** 列表标识用的牌子：炫彩 / 异色 / 污染。 */
const TARGET_KINDS = new Set(['colorful', 'shiny', 'pollution']);

/**
 * 精灵是否进悬浮窗列表（2026-11-09 新口径）：
 * 命中需求中心恒放行；否则先过附近页总范围（全部 / 稀有 / 需求），
 * 再过战斗目标那组维度筛选（没设维度 = 全部通过）。
 */
export function isOverlayTarget(
  pet: LiveNearbyPet,
  demandHits: readonly DemandHit[] = [],
  filter: NearbyFilter = getNearbyFilter(),
  target: BattleTarget = getBattleTarget(),
): boolean {
  if (demandHits.length > 0) return true;
  if (!nearbyFilterAllows(filter, pet, 0)) return false;
  return battleTargetAllows(target, {
    nature: pet.nature || null,
    gender: pet.gender || null,
    voiceDb: pet.voiceDb ?? null,
    weightPct: pet.weightPct ?? null,
  });
}

/** 命中原因（列表只显示最短标识）：需求 > 可提醒 > 稀有 > 炫彩 / 异色 / 污染。 */
export function overlayHitReason(pet: LiveNearbyPet, demandHits: readonly DemandHit[] = []): string | null {
  if (demandHits.length > 0) return 'demand';
  if (pet.alertReason != null) return 'alert';
  if (pet.rare) return 'rare';
  for (const kind of pet.kinds) {
    if (TARGET_KINDS.has(kind)) return kind;
  }
  return null;
}

/** 小于这个距离（米）时方向没有意义，返回 null 而不是随便给一个方位。 */
const MIN_BEARING_DISTANCE_M = 0.05;

/**
 * 悬浮面板列表项：PC 小窗字段 + 手机壳列表要用的方向箭头（2026-11-09）。
 * `bearingArrow` 与 `bearingLabel` 同源（`nearbyRadar` 的 8 方位），
 * 壳端每行渲染「距离 + 箭头」，不再自己算角度。
 */
export interface NearbyOverlayPet extends DesktopOverlayPet {
  bearingArrow: string | null;
  /** 高 / 重百分比（0-100）；壳端第二行显示「高:12.3%」，截断一位小数 */
  heightPct: number | null;
  weightPct: number | null;
  voiceDb: number | null;
}

export interface NearbyOverlayPayload extends DesktopOverlayPayload {
  /** 列表项带方向箭头；PC 小窗多这一列也无副作用 */
  pets: NearbyOverlayPet[];
  /** 采集中才显示面板；停止采集即收起隐藏 */
  visible: boolean;
  /** 附近精灵总数（截断前的数量，含未命中目标的普通精灵） */
  total: number;
  /** 命中目标总数（截断前；列表与「还有 N 只」都按它算） */
  matched: number;
  /**
   * 地图 / 雷达点位：附近所有带坐标的精灵（按距离截断到 24 只）。
   * `pets` 只给列表用（命中目标），地图要靠这份才能看到普通精灵的方位。
   */
  mapPets: NearbyOverlayMapPet[];
  /** 稀有总数（截断前） */
  rareTotal: number;
  /** 可提醒总数（截断前） */
  alertTotal: number;
  /** true = 没有真实 307，`self` 来自里程计或附近精灵的估算中心 */
  selfEstimated: boolean;
  /** 自身坐标来源（壳端排障用）：packet / odometry / stale / none */
  selfSource: SelfSource;
  /** 自身坐标解出时间（ms）；没有为 null */
  selfAt: number | null;
  /** 自身朝向（0 = 正北、顺时针，度）：列表方位与地图箭头都以它为基准；null = 没有朝向数据 */
  selfHeading: number | null;
  /**
   * 解码轮询实测（2026-11-10，随 payload 带给壳端 RocoPerf）：
   * 每轮「取增量字节」与「worker 解码」的耗时、每轮字节数、相邻两轮间隔。
   * 真机上只有这样才能判断轮询到底卡在哪一段，而不是只能靠页面控制台。
   */
  perf: NearbyOverlayPerf;
}

/** 一轮解码的实测耗时（壳端只打印，不参与渲染）。 */
export interface NearbyOverlayPerf {
  /** 取增量字节平均 / 最大耗时（ms） */
  readAvg: number;
  readMax: number;
  /** Worker 解码平均 / 最大耗时（ms） */
  decodeAvg: number;
  decodeMax: number;
  /** 每轮平均送入 worker 的字节数 */
  bytes: number;
  /** 相邻两轮的平均间隔（ms） */
  gapAvg: number;
  /** 统计到的轮数（0 = 还没跑过一轮） */
  rounds: number;
}

/** 自身坐标来源：真实 307 / 里程计 / 沿用上一帧 / 没有。 */
export type SelfSource = 'packet' | 'odometry' | 'stale' | 'none';

/** 地图 / 雷达只需要落点与标识，不带名字 / 等级等列表字段。 */
export interface NearbyOverlayMapPet {
  key: string;
  kinds: string[];
  rare: boolean;
  alert: boolean;
  reason: string | null;
  x: number;
  y: number;
  /** 相对自身坐标的距离（米）；壳端 RocoPerf 用最短距离判断地图是否在跟随 */
  distanceM: number | null;
}

export interface NearbyOverlaySource {
  capturing: boolean;
  hasKey: boolean;
  /** 最近一帧附近快照；null 表示还没收到数据 */
  snapshot: NearbySnapshot | null;
  /** 推送时间；不传时用快照的更新时间 */
  now?: number;
  /**
   * 需求中心命中（精灵 key → 命中的需求），由页面用与 PC 相同的 `demandHitsForPet` 算好。
   * 命中需求的精灵恒进悬浮窗列表。
   */
  demandHits?: ReadonlyMap<string, DemandHit[]> | null;
  /** 附近页顶部总范围档位；不传时读共享状态（与页面同一份） */
  filter?: NearbyFilter;
  /** 战斗目标维度筛选（性格 / 公母 / 声音 / 体型）；不传时读共享状态 */
  target?: BattleTarget;
}

/** 命中需求 > 提醒 > 稀有 > 距离近 > key 稳定排序。 */
function comparePets(left: DesktopOverlayPet, right: DesktopOverlayPet): number {
  const demand = Number(right.reason === 'demand') - Number(left.reason === 'demand');
  if (demand !== 0) return demand;
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
  countPayloadBuild();
  const { capturing, hasKey, snapshot, demandHits } = source;
  const filter = source.filter ?? getNearbyFilter();
  const target = source.target ?? getBattleTarget();
  const pets = snapshot?.pets ?? [];
  const hitsOf = (pet: LiveNearbyPet): readonly DemandHit[] => demandHits?.get(pet.key) ?? [];
  // 地图仍画全部附近精灵；列表按「总范围 + 维度筛选」，命中需求恒放行
  const targets = pets.filter((pet) => isOverlayTarget(pet, hitsOf(pet), filter, target));
  // 307 是稀疏帧：真实坐标缺失时用里程计估算，保证地图 / 雷达随走动更新（2026-11-10）
  const rawSelf = snapshot?.self ?? null;
  const self = rawSelf ?? snapshot?.estimatedSelf ?? null;
  // 坏的自身坐标（NaN/Infinity）经 JSON 会变成 null，壳算出的中心会是 NaN；
  // 与 PC 端 overlay.js 同一口径：非有限数就当没有自身坐标。
  const hasSelf = self != null && Number.isFinite(self.x) && Number.isFinite(self.y);
  // selfSource 是解码线程写入的来源（2026-11-10）：旧快照没有该字段时按「有 self 就是 307」兼容
  const selfSource: SelfSource = snapshot?.selfSource
    ?? (rawSelf ? 'packet' : snapshot?.estimatedSelf ? 'odometry' : 'none');
  const hasRawSelf = selfSource === 'packet' && hasSelf;
  // 有自身坐标就以它为中心；没有就用附近精灵的几何中位数（并标记估算）
  const radar = buildRadar(
    pets,
    hasSelf ? { origin: self, trustOrigin: hasRawSelf, heading: snapshot?.selfHeading ?? null } : {},
  );
  const pointByKey = new Map(radar.points.map((point) => [point.key, point]));
  const distanceOf = (pet: LiveNearbyPet) =>
    pointByKey.get(pet.key)?.distanceM ?? pet.distanceM ?? Number.POSITIVE_INFINITY;

  // 地图 / 雷达点位：附近所有带坐标的精灵（普通精灵也画），按距离截断
  const mapPets = [...pets]
    .filter((pet) => pet.pos != null && Number.isFinite(pet.pos.x) && Number.isFinite(pet.pos.y))
    .sort((left, right) => distanceOf(left) - distanceOf(right) || left.key.localeCompare(right.key))
    .slice(0, OVERLAY_MAP_POINT_LIMIT)
    .flatMap<NearbyOverlayMapPet>((pet) => {
      const pos = pet.pos;
      if (pos == null) return [];
      return [{
        key: pet.key,
        kinds: pet.kinds,
        rare: pet.rare,
        alert: pet.alertReason != null,
        reason: overlayHitReason(pet, hitsOf(pet)),
        x: pos.x,
        y: pos.y,
        distanceM: Number.isFinite(distanceOf(pet)) ? Math.round(distanceOf(pet) * 10) / 10 : null,
      }];
    });

  const items = targets.map<NearbyOverlayPet>((item) => {
    const point = pointByKey.get(item.key);
    const distanceM = point?.distanceM ?? item.distanceM ?? null;
    const hasBearing = point != null && point.distanceM >= MIN_BEARING_DISTANCE_M;
    return {
      key: item.key,
      name: item.name,
      level: item.level,
      kinds: item.kinds,
      rare: item.rare,
      alert: item.alertReason != null,
      reason: overlayHitReason(item, hitsOf(item)),
      nature: item.nature || null,
      gender: item.gender || null,
      distanceM,
      bearingLabel: hasBearing ? point.bearingLabel : null,
      bearingArrow: hasBearing ? point.bearingArrow : null,
      heightPct: item.heightPct ?? null,
      weightPct: item.weightPct ?? null,
      voiceDb: item.voiceDb ?? null,
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
    matched: items.length,
    mapPets,
    rareTotal: pets.filter((item) => item.rare).length,
    alertTotal: pets.filter((item) => item.alertReason != null).length,
    selfEstimated: !hasRawSelf,
    selfSource,
    selfAt: snapshot?.selfAt ?? null,
    selfHeading: snapshot?.selfHeading ?? null,
    perf: perfOf(),
    updatedAt: source.now ?? snapshot?.updatedAt ?? Date.now(),
  };
}

/** 解码轮询实测（页面内存里的最新 60 轮）→ payload 里的一行小字段。 */
function perfOf(): NearbyOverlayPerf {
  const perf = capturePerfSummary();
  return {
    readAvg: perf.readMsAvg,
    readMax: perf.readMsMax,
    decodeAvg: perf.decodeMsAvg,
    decodeMax: perf.decodeMsMax,
    bytes: perf.bytesAvg,
    gapAvg: perf.gapMsAvg,
    rounds: perf.rounds,
  };
}
