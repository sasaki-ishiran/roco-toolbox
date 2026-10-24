import { describe, expect, test } from 'vitest';
import { nextCaptureProgress, type CaptureAnalysis } from './captureProgress';

const complete: CaptureAnalysis = { fingerprint: 'content-a', hasGameTraffic: true, hasKey: true, hasProfile: true, accountCount: 1, boxes: 2, records: 3, missingRecords: 0, hasEggInventory: true, eggInventoryComplete: true, eggRecords: 0, completionCandidate: true, truncated: false, flowErrors: 0, stableWaitMs: 12000 };
const observe = (previous: ReturnType<typeof nextCaptureProgress> | null, analysis = complete, now = 1000, session = 'capture-1.pcap') => nextCaptureProgress(previous, analysis, now, session);

describe('采集内容稳定判定', () => {
  test('空流量和缺少登录密钥不会因等待够久而成功', () => {
    const empty = { ...complete, hasGameTraffic: false, hasKey: false, hasProfile: false, completionCandidate: false, records: 0 };
    expect(observe(null, empty).stage).toBe('waiting');
    expect(observe(null, { ...complete, hasKey: false }, 999999).stage).toBe('login');
  });
  test.each([
    { ...complete, missingRecords: 1 },
    { ...complete, hasEggInventory: false },
    { ...complete, eggInventoryComplete: false },
    { ...complete, truncated: true },
    { ...complete, flowErrors: 1 },
    { ...complete, completionCandidate: false },
  ])('缺少完整性证据不得进入稳定倒计时 %#', (analysis) => {
    const first = observe(null, analysis);
    expect(observe(first, analysis, 999999).stage).not.toBe('ready');
    expect(first.stableSince).toBeNull();
  });
  test('已识别内容不变持续 12 秒才提示可停止，心跳不延长等待', () => {
    const first = observe(null);
    expect(first.stage).toBe('stabilizing');
    expect(observe(first, complete, 12999).remainingMs).toBe(1);
    expect(observe(first, complete, 13000).stage).toBe('ready');
  });
  test('同数量的新属性或蛋变化仍会重新等待', () => {
    const first = observe(null);
    const changed = observe(first, { ...complete, fingerprint: 'content-b' }, 12000);
    expect(changed.stage).toBe('stabilizing');
    expect(changed.remainingMs).toBe(12000);
  });
  test('新会话与长时间无检查必须重新计时，防止后台盲等成功', () => {
    const first = observe(null);
    expect(observe(first, complete, 13000).stage).toBe('ready');
    expect(observe(first, complete, 13000, 'capture-2.pcap').stage).toBe('stabilizing');
    expect(observe(first, complete, 100000).remainingMs).toBe(12000);
  });
  test('多个角色必须重新采集，不能用最后一个角色伪装成功', () => {
    expect(observe(null, { ...complete, accountCount: 2 }).stage).toBe('multiple');
  });
});
