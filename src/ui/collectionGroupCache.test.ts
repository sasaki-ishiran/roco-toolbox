import { beforeEach, describe, expect, test } from 'vitest';
import { member, resourceWith } from '../test/fixtures/motherSharing';
import type { CollectionGroupDetail, CollectionGroupSummary } from '../shared/collectionGroups';
import {
  clearCollectionGroupCacheDetail,
  readCollectionGroupCache,
  saveCollectionGroupCacheDetail,
  saveCollectionGroupCacheGroups,
} from './collectionGroupCache';

const summary = (id: string, groupType: 'mother' | 'stud'): CollectionGroupSummary => ({
  id,
  name: id,
  ownerAccountId: 'A',
  memberCount: 1,
  groupType,
  targetRevision: 0,
  targetReady: true,
});

const detail = (id: string, groupType: 'mother' | 'stud'): CollectionGroupDetail => ({
  group: {
    id,
    name: id,
    ownerAccountId: 'A',
    createdAt: 1,
    groupType,
    targetRevision: 0,
    resourceEpoch: 0,
    target: null,
  },
  members: [
    {
      ...member('A', resourceWith([101])),
      studResource: null,
    },
  ],
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('小组页缓存（二期）', () => {
  test('列表与多个组的详情分别保存，切换类型不互相顶掉', () => {
    saveCollectionGroupCacheGroups('A', [summary('gm', 'mother'), summary('gs', 'stud')]);
    saveCollectionGroupCacheDetail('A', detail('gm', 'mother'));
    saveCollectionGroupCacheDetail('A', detail('gs', 'stud'));
    const cache = readCollectionGroupCache('A');
    expect(cache?.groups.map((group) => group.id)).toEqual(['gm', 'gs']);
    expect(cache?.details.gm.group.groupType).toBe('mother');
    expect(cache?.details.gs.group.groupType).toBe('stud');
  });

  test('只清指定组的详情，别的组保留', () => {
    saveCollectionGroupCacheDetail('A', detail('gm', 'mother'));
    saveCollectionGroupCacheDetail('A', detail('gs', 'stud'));
    clearCollectionGroupCacheDetail('A', 'gm');
    expect(readCollectionGroupCache('A')?.details.gm).toBeUndefined();
    expect(readCollectionGroupCache('A')?.details.gs).toBeDefined();
  });

  test('旧版本或损坏的缓存按不存在处理', () => {
    window.localStorage.setItem('roco.collectionGroupCache:A', '{bad json');
    expect(readCollectionGroupCache('A')).toBeNull();
    window.localStorage.setItem(
      'roco.collectionGroupCache:A',
      JSON.stringify({ schemaVersion: 1, groups: [], details: {}, savedAt: 1 }),
    );
    expect(readCollectionGroupCache('A')).toBeNull();
  });
});
