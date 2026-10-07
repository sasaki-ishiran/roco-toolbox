import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AccountSnapshot } from '../domain/parseBackup';
import { resetSnapshotCacheForTest } from '../storage/snapshotStore';
import { clearAllSnapshots, listSnapshots } from '../storage/snapshots';
import {
  applySnapshot,
  buildSnapshot,
  decodeSnapshot,
  encodeSnapshot,
  syncNow,
  type CloudSnapshot,
} from './sync';

/** 账号名 → 稳定的假 UID（真实场景 UID 唯一；测试里按名字派生，保证不同账号不同主键） */
const gameIdOf = (name: string): number =>
  [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 7);

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const snapshotOf = (accountName: string, exportedAt: string, petName: string): AccountSnapshot => ({
  accountName,
  gameId: gameIdOf(accountName),
  exportedAt,
  importedAt: exportedAt,
  pets: [
    {
      gameId: 1,
      name: petName,
      gender: '母',
      nature: '开朗',
      voiceDb: 100,
      medalBody: '大块头',
      isShiny: false,
      account: accountName,
    },
  ],
  eggs: [],
});

describe('云同步快照', () => {
  beforeEach(async () => {
    await clearAllSnapshots();
    resetSnapshotCacheForTest();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('编码/解码往返：数据一致，且 gzip 后能还原', () => {
    const snapshot = {
      type: 'roco-toolbox-cloud' as const,
      version: 1,
      savedAt: '2026-10-06T00:00:00.000Z',
      catalogVersion: 's4',
      accounts: [snapshotOf('甲', '2026-10-01T00:00:00.000Z', '火神')],
      prefs: { 'roco.targetMode': 'medal' },
    };
    const payload = encodeSnapshot(snapshot);
    expect(payload).not.toContain('火神'); // 压缩过，不是明文
    expect(decodeSnapshot(payload)).toEqual(snapshot);
  });

  test('解码时拦掉不是本工具的数据', () => {
    const bogus = encodeSnapshot({
      type: 'other' as never,
      version: 1,
      savedAt: '',
      catalogVersion: '',
      accounts: [],
      prefs: {},
    });
    expect(() => decodeSnapshot(bogus)).toThrow(/格式不对/);
  });

  test('buildSnapshot 带上本机账号与偏好键', async () => {
    await applySnapshot(
      {
        type: 'roco-toolbox-cloud',
        version: 1,
        savedAt: '',
        catalogVersion: 's4',
        accounts: [snapshotOf('甲', '2026-10-01T00:00:00.000Z', '火神')],
        prefs: {},
      },
      undefined,
      { merge: false },
    );
    window.localStorage.setItem('roco.targetMode', 'medal');
    const built = await buildSnapshot();
    expect(built.accounts.map((item) => item.accountName)).toEqual(['甲']);
    expect(built.prefs['roco.targetMode']).toBe('medal');
  });

  test('默认合并：本机独有的账号保留，云端有而本机没有的并入', async () => {
    await applySnapshot(
      {
        type: 'roco-toolbox-cloud',
        version: 1,
        savedAt: '',
        catalogVersion: 's4',
        accounts: [snapshotOf('本机甲', '2026-10-01T00:00:00.000Z', '火神')],
        prefs: {},
      },
      undefined,
      { merge: false },
    );
    const result = await applySnapshot(
      {
        type: 'roco-toolbox-cloud',
        version: 2,
        savedAt: '',
        catalogVersion: 's4',
        accounts: [snapshotOf('云端乙', '2026-10-05T00:00:00.000Z', '水灵')],
        prefs: {},
      },
      { version: 2, updatedAt: Date.now(), bytes: 10 },
    );
    expect(result.added).toEqual(['云端乙']);
    const merged = await listSnapshots();
    expect(merged.map((item) => item.accountName).sort()).toEqual(['云端乙', '本机甲']);
    // 合并模式不覆盖本机已有的偏好
    expect(window.localStorage.getItem('roco.targetMode')).toBeNull();
  });

  test('口径类设置以云端为准；显示习惯类仍各留各的', async () => {
    window.localStorage.setItem('roco.targetMode', 'perfect');
    window.localStorage.setItem('roco.excludedAccounts', '["本机甲"]');
    window.localStorage.setItem('roco.petPageSize', '20');
    const result = await applySnapshot({
      type: 'roco-toolbox-cloud',
      version: 3,
      savedAt: '',
      catalogVersion: 's4',
      accounts: [],
      prefs: {
        'roco.targetMode': 'medal',
        'roco.excludedAccounts': '[]',
        'roco.petPageSize': '50',
      },
    });

    // 口径类：本机原有值也被云端顶掉（两台数字才对得上）
    expect(window.localStorage.getItem('roco.targetMode')).toBe('medal');
    expect(window.localStorage.getItem('roco.excludedAccounts')).toBe('[]');
    expect(result.prefsAdopted).toEqual(['roco.targetMode', 'roco.excludedAccounts']);
    // 显示习惯：本机已有，不动
    expect(window.localStorage.getItem('roco.petPageSize')).toBe('20');
  });

  test('同账号两边都有：取「数据时刻」较新的那份', async () => {
    await applySnapshot(
      {
        type: 'roco-toolbox-cloud',
        version: 1,
        savedAt: '',
        catalogVersion: 's4',
        accounts: [snapshotOf('甲', '2026-10-01T00:00:00.000Z', '旧精灵')],
        prefs: {},
      },
      undefined,
      { merge: false },
    );
    await applySnapshot({
      type: 'roco-toolbox-cloud',
      version: 1,
      savedAt: '',
      catalogVersion: 's4',
      accounts: [snapshotOf('甲', '2026-10-05T00:00:00.000Z', '新精灵')],
      prefs: {},
    });
    const merged = await listSnapshots();
    expect(merged[0].pets[0].name).toBe('新精灵');
  });

  test('云同步合并：数据时刻相同也取云端那份（否则两台设备各留各的、永远合不到一起）', async () => {
    await applySnapshot(
      {
        type: 'roco-toolbox-cloud',
        version: 1,
        savedAt: '',
        catalogVersion: 's4',
        accounts: [snapshotOf('甲', '2026-10-01T00:00:00.000Z', '本机采的')],
        prefs: {},
      },
      undefined,
      { merge: false },
    );
    await applySnapshot({
      type: 'roco-toolbox-cloud',
      version: 2,
      savedAt: '',
      catalogVersion: 's4',
      accounts: [snapshotOf('甲', '2026-10-01T00:00:00.000Z', '云端那份')],
      prefs: {},
    });
    const merged = await listSnapshots();
    expect(merged[0].pets[0].name).toBe('云端那份');
  });

  test('syncNow：拉云端 → 与本机合并 → 推回云端，并报告并入/更新', async () => {
    await applySnapshot(
      {
        type: 'roco-toolbox-cloud',
        version: 1,
        savedAt: '',
        catalogVersion: 's4',
        accounts: [snapshotOf('本机甲', '2026-10-01T00:00:00.000Z', '火神')],
        prefs: {},
      },
      undefined,
      { merge: false },
    );
    const cloud: CloudSnapshot = {
      type: 'roco-toolbox-cloud',
      version: 3,
      savedAt: '',
      catalogVersion: 's4',
      accounts: [snapshotOf('云端乙', '2026-10-05T00:00:00.000Z', '水灵')],
      prefs: { 'roco.targetMode': 'medal' },
    };
    let putBody: { baseVersion?: number; payload?: string } | null = null;
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putBody = JSON.parse(String(init.body)) as { baseVersion?: number; payload?: string };
        return Promise.resolve(jsonResponse({ ok: true, version: 4 }));
      }
      return Promise.resolve(
        jsonResponse({
          ok: true,
          snapshot: { version: 3, updatedAt: 1, bytes: 10, payload: encodeSnapshot(cloud) },
        }),
      );
    });

    const result = await syncNow();

    expect(result).toEqual({
      ok: true,
      version: 4,
      added: ['云端乙'],
      updated: [],
      // 本机没有的设置键从云端补上（这类键要刷新页面才生效，调用方据此提示）
      prefsAdopted: ['roco.targetMode'],
      seeded: false,
    });
    expect(window.localStorage.getItem('roco.targetMode')).toBe('medal');
    // 推上去的是**合并后**的完整数据，基准版本 = 刚读到的云端版本（乐观锁）
    expect(putBody!.baseVersion).toBe(3);
    expect(
      decodeSnapshot(putBody!.payload!)
        .accounts.map((item) => item.accountName)
        .sort(),
    ).toEqual(['云端乙', '本机甲']);
    // 本机也拿到了云端那份
    expect((await listSnapshots()).map((item) => item.accountName).sort()).toEqual(['云端乙', '本机甲']);
  });
});
