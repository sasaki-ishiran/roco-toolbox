import { describe, expect, test } from 'vitest';
import {
  studSlotSetIdOf,
  type CollectionGroupMember,
  type PublishedStudResource,
  type StudSlotCoverage,
  type StudTargetConfig,
} from '../shared/collectionGroups';
import { FIXTURE_CATALOG_VERSION, FIXTURE_TIME } from '../test/fixtures/motherSharing';
import {
  buildStudCoverage,
  isStudResourceComparable,
  selectStudSharingViews,
} from './studSharing';

const target: StudTargetConfig = {
  kind: 'stud',
  mode: 'perfect',
  catalogVersion: FIXTURE_CATALOG_VERSION,
  slots: [
    { groupId: 2, natureId: 11, natureName: '开朗', grade: '大婉' },
    { groupId: 3, natureId: 12, natureName: '固执', grade: '大婉' },
  ],
};

const slot = (groupId: number, natureId: number, grade = '大婉'): StudSlotCoverage => ({
  groupId,
  natureId,
  grade: grade as StudSlotCoverage['grade'],
  gameId: groupId === 2 ? 102 : 201,
});

const studResource = (
  covered: StudSlotCoverage[] = [],
  breedable: StudSlotCoverage[] = [],
  patch: Partial<PublishedStudResource> = {},
): PublishedStudResource => ({
  schemaVersion: 1,
  kind: 'stud',
  mode: 'perfect',
  catalogVersion: FIXTURE_CATALOG_VERSION,
  targetId: studSlotSetIdOf(target),
  targetRevision: 3,
  accounts: [
    {
      accountKey: 'uid:9001',
      accountName: '账号9001',
      sourceExportedAt: FIXTURE_TIME,
      covered,
      breedable,
    },
  ],
  revision: 1,
  publishedAt: Date.parse(FIXTURE_TIME),
  ...patch,
});

const member = (
  id: string,
  resource: PublishedStudResource | null,
): CollectionGroupMember => ({
  accountId: id,
  displayName: id,
  joinedAt: Date.parse(FIXTURE_TIME),
  resourceRevision: resource?.revision ?? 0,
  resource: null,
  studResource: resource,
});

const build = (members: CollectionGroupMember[]) =>
  buildStudCoverage({
    target,
    targetRevision: 3,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    members,
  });

describe('buildStudCoverage：槽位覆盖与未知/缺失', () => {
  test('未知成员不算缺；空摘要的成员算缺', () => {
    const rows = build([
      member('A', studResource([slot(2, 11)])),
      member('B', null),
      member('C', studResource([])),
    ]);
    const fire = rows.find((row) => row.key === '2:11:大婉');
    expect(fire?.holders).toEqual([{ accountId: 'A', accountKeys: ['uid:9001'] }]);
    expect(fire?.missingMemberIds).toEqual(['C']);
    expect(fire?.unknownMemberIds).toEqual(['B']);
  });

  test('可迭代单独列出，不算已覆盖也不会进 holders', () => {
    const rows = build([
      member('A', studResource([], [slot(2, 11)])),
      member('B', studResource([])),
    ]);
    const fire = rows.find((row) => row.key === '2:11:大婉');
    expect(fire?.holders).toEqual([]);
    expect(fire?.breedableHolders).toEqual([{ accountId: 'A', accountKeys: ['uid:9001'] }]);
    expect(fire?.missingMemberIds).toEqual(['B']);
  });

  test('目标修订 / 模式 / 图鉴不一致都算未知', () => {
    expect(isStudResourceComparable(studResource(), target, 3, FIXTURE_CATALOG_VERSION)).toBe(true);
    expect(isStudResourceComparable(studResource(), target, 4, FIXTURE_CATALOG_VERSION)).toBe(false);
    expect(
      isStudResourceComparable(studResource([], [], { mode: 'medal' }), target, 3, FIXTURE_CATALOG_VERSION),
    ).toBe(false);
    expect(isStudResourceComparable(studResource(), target, 3, 'test-v0')).toBe(false);

    const rows = build([member('A', studResource([slot(2, 11)], [], { targetRevision: 2 }))]);
    expect(rows[0].unknownMemberIds).toEqual(['A']);
  });

  test('三个分类互斥且覆盖全部成员', () => {
    const rows = build([
      member('A', studResource([slot(2, 11)])),
      member('B', studResource([], [slot(3, 12)])),
      member('C', studResource([])),
      member('D', null),
    ]);
    for (const row of rows) {
      const ids = [
        ...row.holders.map((item) => item.accountId),
        ...row.breedableHolders.map((item) => item.accountId),
        ...row.missingMemberIds,
        ...row.unknownMemberIds,
      ];
      expect(new Set(ids)).toEqual(new Set(['A', 'B', 'C', 'D']));
    }
  });
});

describe('selectStudSharingViews', () => {
  test('我缺的：组内有来源排前；可迭代不算我有', () => {
    const rows = build([
      member('A', studResource([slot(2, 11)])),
      member('B', studResource([], [slot(2, 11)])),
      member('C', studResource([slot(3, 12)])),
    ]);
    const views = selectStudSharingViews(rows, 'B', ['A', 'B', 'C']);
    expect(views.missingForMe?.map((row) => row.key)).toEqual(['2:11:大婉', '3:12:大婉']);
    expect(views.missingForMe?.[0].holders.length).toBeGreaterThan(0);
  });

  test('自己的摘要不可比时前两项为 null', () => {
    const rows = build([member('A', null), member('B', studResource([slot(2, 11)]))]);
    const views = selectStudSharingViews(rows, 'A', ['B']);
    expect(views.missingForMe).toBeNull();
    expect(views.mineForOthers).toBeNull();
  });
});
