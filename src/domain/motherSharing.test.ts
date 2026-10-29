import { describe, expect, test } from 'vitest';
import { buildEggSearchIndex } from './petFilters';
import { buildMotherCoverage, isMotherResourceComparable, selectMotherSharingViews } from './motherSharing';
import { ALL_MOTHERS_CRITERIA_ID } from '../shared/motherGroups';
import {
  FIXTURE_CATALOG_VERSION,
  catalog,
  member,
  resourceWith,
  sharedAccount,
} from '../test/fixtures/motherSharing';
import type { SpeciesEntry } from './types';

const coverage = (members: Parameters<typeof buildMotherCoverage>[0]['members']) =>
  buildMotherCoverage({ species: catalog, catalogVersion: FIXTURE_CATALOG_VERSION, members });

const rowOf = (rows: ReturnType<typeof buildMotherCoverage>, eggGameId: number) => {
  const row = rows.find((item) => item.eggGameId === eggGameId);
  if (!row) throw new Error(`缺少 eggGameId=${eggGameId} 的覆盖行`);
  return row;
};

describe('buildMotherCoverage：按人汇总的覆盖与缺口', () => {
  test('未知与已发布空资源不同：B 未知、C 已知无', () => {
    const rows = coverage([
      member('A', resourceWith([101])),
      member('B', null),
      member('C', resourceWith([])),
    ]);
    const fire = rowOf(rows, 101);
    expect(fire.holders).toEqual([{ accountId: 'A', accountKeys: ['uid:9001'] }]);
    expect(fire.missingMemberIds).toEqual(['C']);
    expect(fire.unknownMemberIds).toEqual(['B']);
    expect(selectMotherSharingViews(rows, 'B', ['A', 'C']).missingForMe).toBeNull();
  });

  test('目标全集只含可孵蛋组；未发现组/无蛋血脉不生成行', () => {
    const rows = coverage([member('A', resourceWith([101, 201, 301, 401]))]);
    expect(rows.map((row) => row.eggGameId).sort((a, b) => a - b)).toEqual([101, 201, 301]);
    expect(rows.some((row) => row.eggGameId === 401)).toBe(false);
  });

  test('同一个人多个游戏账号：覆盖计一次，来源账号全保留', () => {
    const rows = coverage([
      member(
        'A',
        resourceWith([], {
          accounts: [sharedAccount(1001, [101]), sharedAccount(1002, [101, 201])],
        }),
      ),
      member('B', resourceWith([])),
    ]);
    expect(rowOf(rows, 101).holders).toEqual([
      { accountId: 'A', accountKeys: ['uid:1001', 'uid:1002'] },
    ]);
    expect(rowOf(rows, 201).holders).toEqual([
      { accountId: 'A', accountKeys: ['uid:1002'] },
    ]);
  });

  test('成员三类互斥且合起来等于全部成员', () => {
    const rows = coverage([
      member('A', resourceWith([101])),
      member('B', resourceWith([201])),
      member('C', null),
      member('D', resourceWith([101], { catalogVersion: 'test-v0' })),
    ]);
    for (const row of rows) {
      const ids = [
        ...row.holders.map((holder) => holder.accountId),
        ...row.missingMemberIds,
        ...row.unknownMemberIds,
      ];
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(ids)).toEqual(new Set(['A', 'B', 'C', 'D']));
    }
  });

  test('图鉴版本不同 = 未知，不用旧摘要推断缺失', () => {
    const rows = coverage([
      member('A', resourceWith([101], { catalogVersion: 'test-v0' })),
      member('B', resourceWith([201])),
    ]);
    expect(rowOf(rows, 101).unknownMemberIds).toEqual(['A']);
    expect(rowOf(rows, 101).missingMemberIds).toEqual(['B']);
    expect(selectMotherSharingViews(rows, 'A', ['B']).missingForMe).toBeNull();
  });

  test('目录行为空时也不丢失发布状态：可比较成员得到空缺口数组', () => {
    const rows = buildMotherCoverage({
      species: [],
      catalogVersion: FIXTURE_CATALOG_VERSION,
      members: [member('A', resourceWith([101]))],
    });
    expect(rows).toEqual([]);
    expect(selectMotherSharingViews(rows, 'A', ['A']).missingForMe).toEqual([]);
    expect(selectMotherSharingViews(rows, 'B', []).missingForMe).toBeNull();
  });

  test('名称走官方显示名', () => {
    const official: SpeciesEntry = {
      key: 'official',
      gameId: 601,
      name: '地鼠',
      officialName: '地鼠_储水期的样子',
      number: '007',
      eggGameId: 601,
      eggGroups: [6],
    };
    const rows = buildMotherCoverage({
      species: [...catalog, official],
      catalogVersion: FIXTURE_CATALOG_VERSION,
      members: [member('A', resourceWith([]))],
    });
    expect(rowOf(rows, 601).name).toBe('地鼠_储水期的样子');
  });
});

describe('selectMotherSharingViews：我缺的 / 我能补谁 / 小组资源', () => {
  test('我缺的：有人拥有排前，无人拥有排后；未知成员不算缺', () => {
    const rows = coverage([
      member('A', resourceWith([101, 201])),
      member('B', resourceWith([101])),
      member('C', null),
    ]);
    const views = selectMotherSharingViews(rows, 'B', ['A', 'B']);
    expect(views.missingForMe?.map((row) => row.eggGameId)).toEqual([201, 301]);
    expect(views.all).toBe(rows);
    expect(rowOf(rows, 101).missingMemberIds).toEqual([]);
  });

  test('我能补谁：只看已发布且缺少的成员，未知成员不算', () => {
    const rows = coverage([
      member('A', resourceWith([101, 201])),
      member('B', resourceWith([101])),
      member('C', null),
    ]);
    const views = selectMotherSharingViews(rows, 'A', ['A', 'B']);
    expect(views.mineForOthers?.map((row) => row.eggGameId)).toEqual([201]);
  });

  test('自己的摘要无效时前两项为 null，而不是空数组', () => {
    const rows = coverage([member('A', null), member('B', resourceWith([101]))]);
    const views = selectMotherSharingViews(rows, 'A', ['B']);
    expect(views.missingForMe).toBeNull();
    expect(views.mineForOthers).toBeNull();
  });
});

describe('口径版本', () => {
  test('旧口径摘要与「全部母本」不可比较（成员需重新发布）', () => {
    const legacy = { ...resourceWith([101]), criteriaId: 'female-huge-voice100-v2' };
    expect(ALL_MOTHERS_CRITERIA_ID).toBe('all-mothers-v2');
    expect(isMotherResourceComparable(legacy, FIXTURE_CATALOG_VERSION)).toBe(false);
    expect(isMotherResourceComparable(resourceWith([101]), FIXTURE_CATALOG_VERSION)).toBe(true);
  });
});

describe('搜索索引按蛋聚合', () => {
  test('同一颗蛋的进化形态名与图鉴号都能搜到', () => {
    const index = buildEggSearchIndex(catalog);
    const fire = index.get('egg:101') ?? '';
    expect(fire).toContain('火花');
    expect(fire).toContain('火神');
    expect(fire).toContain('002');
  });
});
