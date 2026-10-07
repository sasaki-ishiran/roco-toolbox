import { describe, expect, test } from 'vitest';
import { describeStudTargets } from './studTargets';
import type { CoverageSlot } from './studCoverage';
import type { PetGrade } from './petFilters';
import type { OwnedPet, SpeciesEntry } from './types';

const species: SpeciesEntry[] = [
  { key: 'a', gameId: 101, name: '单组兽', number: '001', eggGroups: [2] },
  { key: 'b', gameId: 102, name: '双组兽', number: '002', eggGroups: [2, 9] },
  { key: 'c', gameId: 103, name: '别组兽', number: '003', eggGroups: [6] },
];

const slot = (
  groupId: number,
  natureName: string,
  grade: PetGrade = '大婉',
): CoverageSlot => ({ groupId, natureId: 0, natureName, grade });

const pet = (over: Partial<OwnedPet> & { gameId: number }): OwnedPet => ({
  name: 'x',
  gender: '公',
  nature: '固执',
  voiceDb: 100,
  medalBody: '大块头',
  isShiny: false,
  account: '甲',
  ...over,
});

const eggGroupNames = { 2: '巨灵组', 6: '动物组', 9: '拟人组' };

describe('describeStudTargets 种公实际覆盖的目标', () => {
  test('档位 + 该组目标性格 + 公 → 记一个目标（带蛋组名）', () => {
    const hits = describeStudTargets({
      owned: [pet({ gameId: 101 })],
      species,
      slots: [slot(2, '固执')],
      eggGroupNames,
      mode: 'perfect',
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].petIndex).toBe(0);
    expect(hits[0].targets).toEqual([
      { groupId: 2, groupLabel: '巨灵组', natureName: '固执', grade: '大婉' },
    ]);
  });

  test('性格不在该组的目标里 → 零覆盖（不能因为「在八大池里」就算覆盖）', () => {
    const hits = describeStudTargets({
      owned: [pet({ gameId: 101, nature: '急躁' })],
      species,
      slots: [slot(2, '固执')],
      eggGroupNames,
      mode: 'perfect',
    });

    expect(hits[0].targets).toEqual([]);
  });

  test('母本不算种公；档位不吻合也不算', () => {
    const hits = describeStudTargets({
      owned: [
        pet({ gameId: 101, gender: '母' }),
        pet({ gameId: 101, medalBody: '小不点' }),
      ],
      species,
      slots: [slot(2, '固执')],
      eggGroupNames,
      mode: 'perfect',
    });

    expect(hits[0].targets).toEqual([]);
    expect(hits[1].targets).toEqual([]);
  });

  test('双蛋组精灵在两个组各记一次；不沾的组不记', () => {
    const hits = describeStudTargets({
      owned: [pet({ gameId: 102 })],
      species,
      slots: [slot(2, '固执'), slot(9, '固执'), slot(6, '固执')],
      eggGroupNames,
      mode: 'perfect',
    });

    expect(hits[0].targets.map((target) => target.groupId)).toEqual([2, 9]);
  });

  test('排序：覆盖目标多的在前', () => {
    const hits = describeStudTargets({
      owned: [
        pet({ gameId: 101 }), // 只覆盖巨灵组
        pet({ gameId: 102 }), // 覆盖巨灵组 + 拟人组
      ],
      species,
      slots: [slot(2, '固执'), slot(9, '固执')],
      eggGroupNames,
      mode: 'perfect',
    });

    expect(hits[0].petIndex).toBe(1);
    expect(hits[0].targets).toHaveLength(2);
    expect(hits[1].targets).toHaveLength(1);
  });

  test('槽位跨两个档位时，只记与个体档位吻合的那个', () => {
    const hits = describeStudTargets({
      owned: [pet({ gameId: 101 })], // 大块头 + 100dB → 大婉
      species,
      slots: [slot(2, '固执', '大婉'), slot(2, '固执', '小婉')],
      eggGroupNames,
      mode: 'perfect',
    });

    expect(hits[0].targets.map((target) => target.grade)).toEqual(['大婉']);
  });
});