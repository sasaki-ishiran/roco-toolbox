import { beforeEach, describe, expect, test } from 'vitest';
import { member, resourceWith, sharedAccount } from '../test/fixtures/motherSharing';
import {
  readMotherGroupCache,
  saveMotherGroupCacheDetail,
  saveMotherGroupCacheGroups,
  clearMotherGroupCacheDetail,
} from './motherGroupCache';

const summary = { id: 'g1', name: '周末互换', ownerAccountId: 'A', memberCount: 2 };
const detail = {
  group: { id: 'g1', name: '周末互换', ownerAccountId: 'A', createdAt: 1 },
  members: [member('A', resourceWith([101], { accounts: [sharedAccount(1001, [101])] })), member('B', null)],
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('小组内容缓存', () => {
  test('先存列表再存详情，读回来两者都在', () => {
    saveMotherGroupCacheGroups('A', [summary]);
    saveMotherGroupCacheDetail('A', detail);
    const cache = readMotherGroupCache('A');
    expect(cache?.groups).toEqual([summary]);
    expect(cache?.detail?.group.name).toBe('周末互换');
    expect(cache?.savedAt).toBeGreaterThan(0);
  });

  test('缓存按身份隔离，不会串到别人账号', () => {
    saveMotherGroupCacheGroups('A', [summary]);
    expect(readMotherGroupCache('B')).toBeNull();
  });

  test('只清指定组的详情，别的组缓存保留', () => {
    saveMotherGroupCacheDetail('A', detail);
    clearMotherGroupCacheDetail('A', 'g2');
    expect(readMotherGroupCache('A')?.detail?.group.id).toBe('g1');
    clearMotherGroupCacheDetail('A', 'g1');
    expect(readMotherGroupCache('A')?.detail).toBeNull();
    expect(readMotherGroupCache('A')?.groups).toHaveLength(1);
  });

  test('损坏的缓存按不存在处理', () => {
    window.localStorage.setItem('roco.motherGroupCache:A', '{bad json');
    expect(readMotherGroupCache('A')).toBeNull();
    window.localStorage.setItem('roco.motherGroupCache:A', JSON.stringify({ groups: [{ id: 1 }], savedAt: 1 }));
    expect(readMotherGroupCache('A')).toBeNull();
  });
});
