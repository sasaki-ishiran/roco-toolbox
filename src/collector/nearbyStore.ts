import { createModuleStore } from '../ui/createModuleStore';
import type { LiveNearbyPet, SeasonEncounter } from './captureProgress';

/**
 * 最近一次解析到的附近精灵（2026-11-06）。
 *
 * 采集进度轮询本来只在采集页挂载时运行；附近页需要自己轮询并保留「停止采集后的最后一帧」，
 * 所以把结果放到模块级 store。只在本次前台会话有效，不写 localStorage。
 */
export interface NearbySnapshot {
  /** 采集会话（CollectorState.fileId），新会话第一次写入会整体替换旧数据 */
  session: string;
  scene: number | null;
  pets: LiveNearbyPet[];
  /** 自身世界坐标（上行 307）；缺失时雷达退回里程计估算 */
  self: { x: number; y: number } | null;
  /** 最近一次赛季奇遇战守卫的个体数据；没有奇遇战为 null */
  encounter: SeasonEncounter | null;
  /** 这段采集里抓到登录密钥没有（悬浮面板据此提示「还没拿到密钥」） */
  hasKey?: boolean;
  updatedAt: number;
}

/** 快照多久没更新就按「等待数据」处理；同一次采集里 live 解码约每秒刷新一次。 */
export const NEARBY_SNAPSHOT_TTL_MS = 3 * 60_000;

/**
 * 附近快照的新鲜度门限（2026-11-08，O-9）。
 *
 * 快照是模块级、跨页共享的，「停止采集后保留最后一帧」是有意的；但换一局采集后
 * 旧 session 的精灵/场景不能继续显示，也不能再推给悬浮窗。当前采集会话还没读到
 * （state 未就绪）时不清屏，避免刚进页面闪一下。
 */
export function freshNearbySnapshot(
  snapshot: NearbySnapshot | null,
  session: string | null | undefined,
  now = Date.now(),
  ttlMs = NEARBY_SNAPSHOT_TTL_MS,
): NearbySnapshot | null {
  if (!snapshot) return null;
  if (session != null && snapshot.session !== session) return null;
  if (now - snapshot.updatedAt > ttlMs) return null;
  return snapshot;
}

const store = createModuleStore<NearbySnapshot | null>(null);

export function writeNearbySnapshot(snapshot: NearbySnapshot): void {
  store.set(snapshot);
}

export function readNearbySnapshot(): NearbySnapshot | null {
  return store.get();
}

export function useNearbySnapshot(): NearbySnapshot | null {
  return store.use();
}

/** 测试用：清空快照。 */
export function resetNearbyStoreForTest(): void {
  store.set(null);
}
