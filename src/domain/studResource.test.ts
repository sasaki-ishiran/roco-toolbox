import { describe, expect, test } from 'vitest';
import {
  studSlotSetIdOf,
  type StudTargetConfig,
} from '../shared/collectionGroups';
import {
  FIXTURE_CATALOG_VERSION,
  catalog,
  mother,
  snapshot,
} from '../test/fixtures/motherSharing';
import type { OwnedPet, SpeciesEntry } from './types';
import {
  StudResourceError,
  buildStudResource,
  diffStudResources,
  studResourceSignature,
} from './studResource';

const targetOf = (patch: Partial<StudTargetConfig> = {}): StudTargetConfig => ({
  kind: 'stud',
  mode: 'perfect',
  catalogVersion: FIXTURE_CATALOG_VERSION,
  slots: [{ groupId: 2, natureId: 11, natureName: '开朗', grade: '大婉' }],
  ...patch,
});

const build = (
  snapshots: Parameters<typeof buildStudResource>[0]['snapshots'],
  target: StudTargetConfig = targetOf(),
  species: SpeciesEntry[] = studCatalog,
) =>
  buildStudResource({
    snapshots,
    selectedAccountKeys: snapshots.map((item) => item.accountKey ?? `uid:${item.gameId}`),
    species,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    target,
    targetRevision: 3,
  });

/** 图鉴 fixture 默认没有 maleCapable；种公判定需要它，纯母物种明确为 false。 */
const studCatalog: SpeciesEntry[] = catalog.map((entry) => ({
  ...entry,
  maleCapable: entry.gameId === 301 ? false : true,
}));

const male = (gameId: number, patch: Partial<OwnedPet> = {}): OwnedPet =>
  mother(gameId, { gender: '公', ...patch });

const errorOf = (fn: () => unknown): StudResourceError | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return error as StudResourceError;
  }
};

describe('buildStudResource：种公摘要按个体自身蛋组计算', () => {
  test('公 + 目标性格 + 档位 + 蛋组 = covered；来源物种保留', () => {
    const resource = build([snapshot(1001, '甲', [male(102)])]);
    expect(resource.accounts[0].covered).toEqual([
      { groupId: 2, natureId: 11, grade: '大婉', gameId: 102 },
    ]);
    expect(resource.accounts[0].breedable).toEqual([]);
    expect(resource.targetId).toBe(studSlotSetIdOf(targetOf()));
    expect(resource.targetRevision).toBe(3);
  });

  test('母带目标性格 + 同账号任意公 = breedable；可迭代不算 covered', () => {
    const resource = build([
      snapshot(1001, '甲', [
        mother(102, { nature: '开朗' }),
        male(101, { nature: '固执' }),
      ]),
    ]);
    expect(resource.accounts[0].covered).toEqual([]);
    expect(resource.accounts[0].breedable).toEqual([
      { groupId: 2, natureId: 11, grade: '大婉', gameId: 102 },
    ]);
  });

  test('不同账号的公不能拼成可迭代', () => {
    const resource = build([
      snapshot(1001, '甲', [mother(102, { nature: '开朗' })]),
      snapshot(1002, '乙', [male(101)]),
    ]);
    expect(resource.accounts[0].covered).toEqual([]);
    expect(resource.accounts[0].breedable).toEqual([]);
    // 乙账号自己有公 → 算它自己的 covered，但不能拿来给甲凑可迭代
    expect(resource.accounts[1].covered).toEqual([
      { groupId: 2, natureId: 11, grade: '大婉', gameId: 101 },
    ]);
    expect(resource.accounts[1].breedable).toEqual([]);
  });

  test('母方物种不能出公时不算 breedable', () => {
    const resource = build([
      snapshot(1001, '甲', [mother(301, { nature: '开朗' }), male(101)]),
    ], targetOf({ slots: [{ groupId: 4, natureId: 11, natureName: '开朗', grade: '大婉' }] }));
    expect(resource.accounts[0].breedable).toEqual([]);
  });

  test('按个体自身蛋组归格，不按 eggGameId 归并', () => {
    const sharedEgg: SpeciesEntry = {
      key: 'cross',
      gameId: 601,
      name: '跨组精灵',
      number: '099',
      eggGameId: 101,
      eggGroups: [3],
      stage: 1,
    };
    const resource = build(
      [snapshot(1001, '甲', [male(601)])],
      targetOf({
        slots: [
          { groupId: 2, natureId: 11, natureName: '开朗', grade: '大婉' },
          { groupId: 3, natureId: 11, natureName: '开朗', grade: '大婉' },
        ],
      }),
      [...catalog, sharedEgg],
    );
    expect(resource.accounts[0].covered).toEqual([
      { groupId: 3, natureId: 11, grade: '大婉', gameId: 601 },
    ]);
  });

  test('只收目标槽位；目标为空 / 图鉴不一致直接拒绝', () => {
    expect(errorOf(() => build([snapshot(1001, '甲', [male(102)])], targetOf({ slots: [] })))?.code)
      .toBe('TARGET_NOT_READY');
    expect(
      errorOf(() => build([snapshot(1001, '甲', [male(102)])], targetOf({ catalogVersion: 'test-v0' })))?.code,
    ).toBe('INVALID_CATALOG_VERSION');
  });

  test('选号缺失 / 非规范 UID / 导出时间无效都拒绝', () => {
    const ok = snapshot(1001, '甲', [male(102)]);
    expect(
      errorOf(() =>
        buildStudResource({
          snapshots: [ok],
          selectedAccountKeys: ['uid:2002'],
          species: catalog,
          catalogVersion: FIXTURE_CATALOG_VERSION,
          target: targetOf(),
          targetRevision: 0,
        }),
      )?.code,
    ).toBe('ACCOUNT_NOT_FOUND');
    expect(
      errorOf(() =>
        buildStudResource({
          snapshots: [ok],
          selectedAccountKeys: ['name:甲'],
          species: catalog,
          catalogVersion: FIXTURE_CATALOG_VERSION,
          target: targetOf(),
          targetRevision: 0,
        }),
      )?.code,
    ).toBe('INVALID_ACCOUNT_KEY');
    expect(errorOf(() => build([snapshot(1001, '甲', [male(102)], '昨天')]))?.code).toBe(
      'INVALID_EXPORTED_AT',
    );
  });
});

describe('studResourceSignature / diffStudResources', () => {
  test('签名与账号、槽位顺序无关', () => {
    const a = build([
      snapshot(1001, '甲', [male(102)]),
      snapshot(1002, '乙', [male(101)]),
    ]);
    const b = build([
      snapshot(1002, '乙', [male(101)]),
      snapshot(1001, '甲', [male(102)]),
    ]);
    expect(studResourceSignature(a)).toBe(studResourceSignature(b));
  });

  test('按人汇总新增/移除槽位；只改导出时间不算变化', () => {
    const previous = build([snapshot(1001, '甲', [male(102)])]);
    const next = build([
      snapshot(1001, '甲', [male(102), male(101, { nature: '固执' })]),
    ], targetOf({
      slots: [
        { groupId: 2, natureId: 11, natureName: '开朗', grade: '大婉' },
        { groupId: 2, natureId: 12, natureName: '固执', grade: '大婉' },
      ],
    }));
    const diff = diffStudResources(previous, next);
    expect(diff.addedSlots).toEqual(['2:12:大婉']);
    expect(diff.removedSlots).toEqual([]);
    expect(diff.unchanged).toBe(false);
  });

  test('完全相同的摘要 unchanged=true', () => {
    const previous = build([snapshot(1001, '甲', [male(102)])]);
    const next = build([snapshot(1001, '甲', [male(102)])]);
    expect(diffStudResources(previous, next).unchanged).toBe(true);
  });

  test('只改模式 / 修订 / 图鉴必须允许重新发布', () => {
    const previous = build([snapshot(1001, '甲', [male(102)])]);
    expect(diffStudResources(previous, { ...previous, mode: 'medal' }).unchanged).toBe(false);
    expect(diffStudResources(previous, { ...previous, targetRevision: 4 }).unchanged).toBe(false);
    expect(diffStudResources(previous, { ...previous, catalogVersion: 'test-v9' }).unchanged).toBe(false);
  });

  test('同一格从已覆盖变成仅可迭代要允许重新发布', () => {
    const previous = build([snapshot(1001, '甲', [male(102)])]);
    const next = build([
      snapshot(1001, '甲', [mother(102, { nature: '开朗' }), male(101, { nature: '固执' })]),
    ]);
    const diff = diffStudResources(previous, next);
    expect(diff.addedSlots).toEqual([]);
    expect(diff.removedSlots).toEqual([]);
    expect(diff.reclassifiedSlots).toEqual(['2:11:大婉']);
    expect(diff.unchanged).toBe(false);
  });
});
