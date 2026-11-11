import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readShared, removeShared, syncShared, writeShared } from './sharedPrefs';

type FakeBridge = { store: Map<string, string>; get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void };

function installBridge(): FakeBridge {
  const store = new Map<string, string>();
  const bridge: FakeBridge = {
    store,
    get: (key) => store.get(key) ?? null,
    set: (key, value) => { store.set(key, value); },
    remove: (key) => { store.delete(key); },
  };
  (window as unknown as { RocoPrefs?: FakeBridge }).RocoPrefs = bridge;
  return bridge;
}

describe('sharedPrefs', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete (window as unknown as { RocoPrefs?: unknown }).RocoPrefs;
  });
  afterEach(() => {
    delete (window as unknown as { RocoPrefs?: unknown }).RocoPrefs;
  });

  it('没有壳时退化为 localStorage', () => {
    writeShared('roco.deviceToken', 'token-a');
    expect(window.localStorage.getItem('roco.deviceToken')).toBe('token-a');
    expect(readShared('roco.deviceToken')).toBe('token-a');
  });

  it('切服后本地是旧值时采用壳里较新的那份', () => {
    const bridge = installBridge();
    // 模拟刚切到新 origin：localStorage 是旧登录态，没有时间戳
    window.localStorage.setItem('roco.deviceToken', 'old-token');
    bridge.set('roco.deviceToken', JSON.stringify({ v: 'new-token', at: Date.now() }));
    expect(readShared('roco.deviceToken')).toBe('new-token');
    // 读到的值回填本地，后续直接用本地即可
    expect(window.localStorage.getItem('roco.deviceToken')).toBe('new-token');
  });

  it('本地写入更晚时以本地为准', () => {
    const bridge = installBridge();
    writeShared('roco.accountId', 'local-account');
    bridge.set('roco.accountId', JSON.stringify({ v: 'stale-account', at: Date.now() - 60_000 }));
    expect(readShared('roco.accountId')).toBe('local-account');
  });

  it('首次同步把本环境已有的值写进壳', () => {
    const bridge = installBridge();
    window.localStorage.setItem('roco.tourSeen.start', '3');
    syncShared('roco.tourSeen.start');
    const packed = JSON.parse(bridge.get('roco.tourSeen.start') ?? '{}') as { v?: string };
    expect(packed.v).toBe('3');
  });

  it('删除时两侧都清掉', () => {
    const bridge = installBridge();
    writeShared('roco.deviceToken', 'token-a');
    removeShared('roco.deviceToken');
    expect(window.localStorage.getItem('roco.deviceToken')).toBeNull();
    expect(bridge.get('roco.deviceToken')).toBeNull();
  });
});
