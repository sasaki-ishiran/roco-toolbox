import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  SHARE_CACHE,
  SHARE_PAYLOAD_KEY,
  putSharedFile,
  resetShareTargetForTest,
  takeSharedFile,
} from './shareTarget';

/**
 * jsdom 没有 Cache API，用一个内存替身验证读写逻辑。
 * 真实环境里读写的是同一个 Cache Storage，Service Worker 写、页面读。
 */
function installFakeCaches(): Map<string, Map<string, Response>> {
  const cachesByName = new Map<string, Map<string, Response>>();
  const fake = {
    async open(name: string) {
      if (!cachesByName.has(name)) cachesByName.set(name, new Map());
      const entries = cachesByName.get(name)!;
      return {
        async put(key: string, value: Response) {
          entries.set(key, value);
        },
        async match(key: string) {
          const found = entries.get(key);
          return found ? found.clone() : undefined;
        },
        async delete(key: string) {
          return entries.delete(key);
        },
      };
    },
  };
  (globalThis as unknown as { caches: unknown }).caches = fake;
  return cachesByName;
}

beforeEach(() => {
  resetShareTargetForTest();
});

afterEach(() => {
  delete (globalThis as unknown as { caches?: unknown }).caches;
});

describe('分享进来的采集文件', () => {
  test('没有分享文件时返回 null', async () => {
    installFakeCaches();
    expect(await takeSharedFile()).toBeNull();
  });

  test('分享进来的文件能被取走，取走后再取一次是 null（不会重复导入）', async () => {
    installFakeCaches();
    await putSharedFile(
      new File(['{"accounts":[]}'], 'hatch-backup.json', { type: 'application/json' }),
    );

    const taken = await takeSharedFile();
    expect(taken?.name).toBe('hatch-backup.json');
    expect(await taken?.blob.text()).toBe('{"accounts":[]}');
    expect(await takeSharedFile()).toBeNull();
  });

  test('二进制抓包按字节保存，不会被文本解码破坏', async () => {
    installFakeCaches();
    // 经典 PCAP 小端魔数 0xd4c3b2a1 —— 当文本读会变成替换字符
    const bytes = new Uint8Array([0xd4, 0xc3, 0xb2, 0xa1, 0x02, 0x00, 0x04, 0x00, 0xff, 0x80]);
    await putSharedFile(new File([bytes], 'capture.pcap'));

    const taken = await takeSharedFile();
    expect(taken?.name).toBe('capture.pcap');
    const out = new Uint8Array(await taken!.blob.arrayBuffer());
    expect([...out]).toEqual([...bytes]);
  });

  test('读取失败时不算「已取走」，刷新或重新分享还能再试', async () => {
    const cachesByName = installFakeCaches();
    await putSharedFile(new File(['{"accounts":[]}'], 'a.json'));

    // 让第一次 match 抛错
    const originalOpen = (globalThis as unknown as { caches: { open: (n: string) => unknown } }).caches
      .open;
    (globalThis as unknown as { caches: { open: (n: string) => unknown } }).caches.open = async () => {
      throw new Error('cache boom');
    };
    expect(await takeSharedFile()).toBeNull();

    (globalThis as unknown as { caches: { open: (n: string) => unknown } }).caches.open = originalOpen;
    expect(cachesByName.size).toBe(1);
    expect(await takeSharedFile()).not.toBeNull();
  });

  test('取字节失败时不能先删缓存条目（否则这次分享被静默丢掉）', async () => {
    const cachesByName = installFakeCaches();
    const cache = await (
      globalThis as unknown as { caches: { open: (n: string) => Promise<unknown> } }
    ).caches.open(SHARE_CACHE);
    // 塞一个「读 body 会失败」的响应，模拟缓存条目损坏
    await (
      cache as { put: (k: string, v: unknown) => Promise<void> }
    ).put(SHARE_PAYLOAD_KEY, {
      headers: { get: () => null },
      blob: async () => {
        throw new Error('read boom');
      },
      clone() {
        return this;
      },
    });

    expect(await takeSharedFile()).toBeNull();

    // 关键：条目必须还在——不然用户看到「分享过来什么都没发生」，数据永久丢失
    expect(cachesByName.get(SHARE_CACHE)?.has(SHARE_PAYLOAD_KEY)).toBe(true);

    // 换成正常内容后仍能取到（说明这次分享没有丢）
    await putSharedFile(new File(['{"accounts":[]}'], 'ok.json'));
    expect((await takeSharedFile())?.name).toBe('ok.json');
  });
});