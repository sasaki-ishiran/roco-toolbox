/**
 * 采集进度快照的跨挂载缓存。
 *
 * 采集进度原本只存在 `CaptureProgressView` 的组件状态里，用户切到别的页再回来时
 * 组件重挂、进度归零，看起来像「采集重启了」。这里按会话缓存最近一次的识别结果与
 * 稳定等待进度，重挂后先显示上次结果再继续核对；原包与真实状态仍以原生桥为准。
 */
import type { CaptureAnalysis, CaptureProgress } from './captureProgress';

export interface CaptureProgressCache {
  session: string;
  progress: CaptureProgress;
  analysis: CaptureAnalysis;
  sourceBytes: number;
  error: string | null;
  checking: boolean;
  savedAt: number;
}

let cache: CaptureProgressCache | null = null;

export function readCaptureProgressCache(session: string): CaptureProgressCache | null {
  return cache && cache.session === session ? cache : null;
}

export function writeCaptureProgressCache(next: Omit<CaptureProgressCache, 'savedAt'>): void {
  cache = { ...next, savedAt: Date.now() };
}

export function clearCaptureProgressCache(): void {
  cache = null;
}
