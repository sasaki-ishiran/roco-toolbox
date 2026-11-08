import { beforeEach, describe, expect, test, vi } from 'vitest';
import { flushEvents, setAnalyticsEnabled } from '../api/analytics';
import {
  placementRowKey,
  readCollapsedAccounts,
  readPlacementChoices,
  readPlacementMarks,
  togglePlacementMark,
  writeCollapsedAccounts,
  writePlacementChoice,
  type PlacementRow,
} from './demandPlacementStore';

const row = (over: Partial<PlacementRow> = {}): PlacementRow => ({
  groupId: 'g1',
  demanderAccountId: 'm1',
  eggGameId: 100,
  nature: '固执',
  gender: '母',
  body: '大块头',
  voice: '+100',
  claimedAt: 10,
  ...over,
});

beforeEach(() => window.localStorage.clear());

describe('「已上窝」本机记忆', () => {
  test('同款需求换了接单时间就是另一行，不继承旧勾选', () => {
    expect(placementRowKey(row({ claimedAt: 10 }))).not.toBe(placementRowKey(row({ claimedAt: 20 })));
    expect(placementRowKey(row())).toContain('g1|m1');
  });

  test('勾选与取消都写在本机，且按云身份隔离', () => {
    const key = placementRowKey(row());
    expect(togglePlacementMark('me', key, true)[key]).toBe(true);
    expect(readPlacementMarks('me')[key]).toBe(true);
    expect(readPlacementMarks('other')[key]).toBeUndefined();

    expect(togglePlacementMark('me', key, false)[key]).toBeUndefined();
    expect(readPlacementMarks('me')).toEqual({});
  });

  test('标记上窝才上报 placement_mark，只带当前已标记数量（取消不报）', async () => {
    window.localStorage.setItem('roco.analyticsForce', '1');
    setAnalyticsEnabled(false);
    setAnalyticsEnabled(true);
    const batches: Array<{ events: Array<{ name: string; props?: unknown }> }> = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/event')) {
        batches.push(JSON.parse(String(init?.body ?? '{}')) as (typeof batches)[number]);
        return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    try {
      const first = placementRowKey(row({ claimedAt: 1 }));
      const second = placementRowKey(row({ claimedAt: 2 }));
      togglePlacementMark('me', first, true);
      togglePlacementMark('me', second, true);
      await flushEvents();
      expect(batches.flatMap((batch) => batch.events)).toEqual([
        expect.objectContaining({ name: 'placement_mark', props: { count: 1 } }),
        expect.objectContaining({ name: 'placement_mark', props: { count: 2 } }),
      ]);

      batches.length = 0;
      togglePlacementMark('me', second, false);
      await flushEvents();
      expect(batches).toEqual([]);
    } finally {
      setAnalyticsEnabled(false);
      vi.unstubAllGlobals();
    }
  });
});

describe('候选配对的本机记忆', () => {
  test('写入后能读回，取消选择后不再有这一行', () => {
    const key = placementRowKey(row());
    writePlacementChoice('me', key, { motherCaptureId: 'cap-m', fatherCaptureId: 'cap-f' });
    expect(readPlacementChoices('me')[key]).toEqual({
      motherCaptureId: 'cap-m',
      fatherCaptureId: 'cap-f',
    });

    writePlacementChoice('me', key, null);
    expect(readPlacementChoices('me')[key]).toBeUndefined();
  });

  test('存了坏数据时当作没挑过，不影响页面', () => {
    window.localStorage.setItem('roco.demandPlacementChoice:me', JSON.stringify({ k: { mother: 'x' } }));
    expect(readPlacementChoices('me')).toEqual({});
  });
});

describe('账号折叠状态', () => {
  test('重复添加同一账号只留一份，非字符串值被忽略，且按云身份隔离', () => {
    writeCollapsedAccounts('me', ['uid:11', 'uid:11', 'uid:12']);
    expect(readCollapsedAccounts('me')).toEqual(['uid:11', 'uid:12']);
    expect(readCollapsedAccounts('other')).toEqual([]);

    window.localStorage.setItem(
      'roco.demandCollapsedAccounts:me',
      JSON.stringify(['uid:11', 42, null]),
    );
    expect(readCollapsedAccounts('me')).toEqual(['uid:11']);
  });

  test('旧版全局折叠状态读一次迁到当前身份下，然后清掉旧键', () => {
    window.localStorage.setItem('roco.demandCollapsedAccounts', JSON.stringify(['uid:11']));
    expect(readCollapsedAccounts('me')).toEqual(['uid:11']);
    expect(window.localStorage.getItem('roco.demandCollapsedAccounts')).toBeNull();
    expect(readCollapsedAccounts('me')).toEqual(['uid:11']);
  });
});
