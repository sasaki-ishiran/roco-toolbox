import type { LiveNearbyPet } from './captureProgress';
import { createSelfEstimate, updateSelfEstimate, type SelfEstimate } from '../pcap/selfOdometry';

/**
 * 实时自身位置的唯一里程计（2026-11-10）。
 *
 * 真实抓包里的上行 307 不是每帧都有（常常只在进场景 / 传送时来一次），
 * 只靠它会导致「走动时地图不跟着动」。这里在解码线程写快照时跑一次里程计，
 * 页面与悬浮窗都消费 `snapshot.estimatedSelf`，不再各算一套导致两边漂移。
 *
 * 会话键带上场景：传送换场景时重新初始化，避免把旧场景的位移累加到新场景坐标上。
 */
let estimate: SelfEstimate = createSelfEstimate();

export function trackNearbySelf(
  session: string,
  scene: number | null,
  pets: readonly LiveNearbyPet[],
  raw: { x: number; y: number } | null,
  now = Date.now(),
): SelfEstimate {
  estimate = updateSelfEstimate(estimate, `${session}#${scene ?? '?'}`, pets, now, raw);
  return estimate;
}

/** 测试用：清空里程计。 */
export function resetNearbySelfTrackForTest(): void {
  estimate = createSelfEstimate();
}
