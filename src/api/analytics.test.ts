import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  analyticsEnabled,
  deviceId,
  flushEvents,
  platform,
  setAnalyticsEnabled,
  track,
} from './analytics';

describe('匿名埋点', () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    window.localStorage.clear();
    // 测试环境默认不上报（canSend 只认线上构建），显式放开
    window.localStorage.setItem('roco.analyticsForce', '1');
    calls.length = 0;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    });
  });

  afterEach(() => {
    setAnalyticsEnabled(true); // 清空队列
    vi.unstubAllGlobals();
  });

  test('设备 id 生成一次后固定不变', () => {
    const first = deviceId();
    expect(first).toMatch(/[0-9a-f-]{30,}/);
    expect(deviceId()).toBe(first);
  });

  test('track 攒批后 flush 才发出去，带上设备 id 与事件名', async () => {
    track('app_open', { platform: platform() });
    expect(calls).toHaveLength(0); // 没到批大小，不立刻发
    await flushEvents();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/event');
    expect(calls[0].body.deviceId).toBe(deviceId());
    expect(calls[0].body.events).toEqual([
      expect.objectContaining({ name: 'app_open', props: { platform: 'web' } }),
    ]);
  });

  test('关掉统计后不再上报', async () => {
    setAnalyticsEnabled(false);
    expect(analyticsEnabled()).toBe(false);
    track('app_open');
    await flushEvents();
    expect(calls).toHaveLength(0);
  });

  test('上报失败不丢事件：留在队列里下次重试', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    track('app_open');
    await flushEvents();
    // 再把网络修好，事件还应该发得出去
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    });
    await flushEvents();
    expect(calls).toHaveLength(1);
    expect((calls[0].body.events as Array<{ name: string }>)[0].name).toBe('app_open');
  });
});
