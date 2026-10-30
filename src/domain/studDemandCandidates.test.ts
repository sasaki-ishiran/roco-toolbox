import { describe, expect, test } from 'vitest';
import type { SpeciesEntry } from './types';
import { buildProductionIndex } from './productionLines';
import { findStudDemandCandidates, type StudCandidateMember } from './studDemandCandidates';

/**
 * 种公需求候选蛋（2026-10-30 用户口径）：
 * 下单后按组内产线算出「能孵出这颗公的蛋」，双蛋组优先，用于需求卡头像与角标。
 */
const species: SpeciesEntry[] = [
  { key: 'egg-a', gameId: 100, name: '火花', number: '001', eggGroups: [2], maleCapable: true, eggGameId: 100 },
  { key: 'form-a', gameId: 101, name: '火神', number: '002', eggGroups: [2], maleCapable: true, eggGameId: 100 },
  { key: 'egg-b', gameId: 200, name: '雪绒鸟', number: '003', eggGroups: [2, 3], maleCapable: true, eggGameId: 200 },
  { key: 'egg-c', gameId: 300, name: '纯母兽', number: '004', eggGroups: [2], maleCapable: false, eggGameId: 300 },
  { key: 'egg-d', gameId: 400, name: '水灵', number: '005', eggGroups: [3], maleCapable: true, eggGameId: 400 },
];

const index = buildProductionIndex(species);

const member = (accountId: string, over: Partial<StudCandidateMember> = {}): StudCandidateMember => ({
  accountId,
  lines: [],
  eggGameIds: new Set<number>(),
  ...over,
});

describe('findStudDemandCandidates', () => {
  test('只收蛋物种本体，形态不算独立候选，纯母物种直接排除', () => {
    const result = findStudDemandCandidates(
      { groupId: 2, nature: '固执', body: '大块头', voice: '+100' },
      species,
      index,
      [
        member('甲', {
          lines: [
            { eggGameId: 100, grade: '大婉', natures: ['固执'] },
            { eggGameId: 200, grade: '大婉', natures: ['固执'] },
            { eggGameId: 300, grade: '大婉', natures: ['固执'] },
          ],
        }),
      ],
    );
    expect(result.map((item) => item.eggGameId).sort()).toEqual([100, 200]);
  });

  test('双蛋组优先，其次能补的人数多的', () => {
    const result = findStudDemandCandidates(
      { groupId: 2, nature: '固执', body: '大块头', voice: '+100' },
      species,
      index,
      [
        member('甲', {
          lines: [
            { eggGameId: 100, grade: '大婉', natures: ['固执'] },
            { eggGameId: 200, grade: '大婉', natures: ['固执'] },
          ],
        }),
        member('乙', {
          lines: [
            { eggGameId: 100, grade: '大婉', natures: ['固执'] },
            { eggGameId: 200, grade: '大婉', natures: ['固执'] },
          ],
        }),
        member('丙', { lines: [{ eggGameId: 100, grade: '大婉', natures: ['固执'] }] }),
      ],
    );
    // 雪绒鸟是双蛋组，即使火花能补的人更多也排第一
    expect(result.map((item) => item.eggGameId)).toEqual([200, 100]);
    expect(result[0].supplierIds).toEqual(['甲', '乙']);
    expect(result[1].supplierIds).toEqual(['甲', '乙', '丙']);
  });

  test('性格 / 档位对不上的产线不算能补', () => {
    const result = findStudDemandCandidates(
      { groupId: 2, nature: '开朗', body: '大块头', voice: '+100' },
      species,
      index,
      [
        member('甲', {
          lines: [
            { eggGameId: 100, grade: '大婉', natures: ['固执'] },
            { eggGameId: 200, grade: '小婉', natures: ['开朗'] },
          ],
        }),
      ],
    );
    expect(result).toEqual([]);
  });

  test('旧摘要没有产线时按「有这枚蛋」兜底', () => {
    const result = findStudDemandCandidates(
      { groupId: 2, nature: '固执', body: '大块头', voice: '+100' },
      species,
      index,
      [member('旧', { lines: null, eggGameIds: new Set([400, 100]) })],
    );
    expect(result.map((item) => item.eggGameId)).toEqual([100]);
  });
});
