/**
 * 附近实时链路的轻量量化（2026-11-10）。
 *
 * 只记数、不改行为：用户反馈「打开后有点卡」时，先用真实数字确认是
 * 解码慢、payload 组装频繁，还是壳侧每秒重建列表 / 重绘 WebView，再决定优化点。
 * 数据保留最近 60 轮，调试时在控制台执行 `__rocoPerf.capture()` 查看。
 */
export interface CapturePerfSample {
  at: number;
  session: string;
  /** 读取增量字节耗时（ms） */
  readMs: number;
  /** Worker 解码耗时（ms） */
  decodeMs: number;
  /** 文件总字节 */
  bytes: number;
  /** 尾部窗口字节（0 = 全量） */
  windowBytes: number;
  /** 本轮是否解到真实自身坐标（307） */
  selfRaw: boolean;
  /** 本轮解到的真实自身坐标（没有 307 为 null）：用于判断 307 是不是一直同一个值 */
  selfX: number | null;
  selfY: number | null;
  pets: number;
}

const LIMIT = 60;
const samples: CapturePerfSample[] = [];
let payloadBuilds = 0;
let installed = false;

export function recordCapturePerf(sample: Omit<CapturePerfSample, 'at'>): void {
  samples.push({ ...sample, at: Date.now() });
  if (samples.length > LIMIT) samples.shift();
  install();
}

/** 悬浮窗 payload 组装次数（每轮推送一次，用来核对「每秒组装几次」）。 */
export function countPayloadBuild(): void {
  payloadBuilds += 1;
  install();
}

export function capturePerfSummary(): {
  rounds: number;
  readMsAvg: number; readMsMax: number;
  decodeMsAvg: number; decodeMsMax: number;
  bytesAvg: number; windowBytes: number;
  selfRawRate: number; petsAvg: number;
  /** 相邻两轮的平均间隔（ms）：直接回答「自适应轮询到底多久跑一轮」 */
  gapMsAvg: number;
  payloadBuilds: number;
} {
  const rounds = samples.length;
  const sum = (pick: (item: CapturePerfSample) => number) =>
    samples.reduce((total, item) => total + pick(item), 0);
  const max = (pick: (item: CapturePerfSample) => number) =>
    samples.reduce((best, item) => Math.max(best, pick(item)), 0);
  return {
    rounds,
    readMsAvg: rounds ? Math.round(sum((item) => item.readMs) / rounds) : 0,
    readMsMax: Math.round(max((item) => item.readMs)),
    decodeMsAvg: rounds ? Math.round(sum((item) => item.decodeMs) / rounds) : 0,
    decodeMsMax: Math.round(max((item) => item.decodeMs)),
    bytesAvg: rounds ? Math.round(sum((item) => item.bytes) / rounds) : 0,
    windowBytes: rounds ? samples[rounds - 1].windowBytes : 0,
    selfRawRate: rounds ? Math.round((sum((item) => (item.selfRaw ? 1 : 0)) / rounds) * 100) : 0,
    petsAvg: rounds ? Math.round(sum((item) => item.pets) / rounds) : 0,
    gapMsAvg: rounds > 1
      ? Math.round((samples[rounds - 1].at - samples[0].at) / (rounds - 1))
      : 0,
    payloadBuilds,
  };
}

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  (window as unknown as { __rocoPerf?: unknown }).__rocoPerf = {
    capture: capturePerfSummary,
    samples: () => samples.slice(),
  };
}

/** 测试用：清空计数。 */
export function resetPerfProbeForTest(): void {
  samples.length = 0;
  payloadBuilds = 0;
}
