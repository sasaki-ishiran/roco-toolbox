import { describe, expect, test } from 'vitest';
import {
  BIG_WAN_CRITERIA,
  buildMotherChecklist,
  mergeChecklistState,
  type ChecklistState,
} from './swapChecklist';
import type { OwnedPet, SpeciesEntry } from './types';

const species = (gameId: number, extra: Partial<SpeciesEntry> = {}): SpeciesEntry => ({
  key: `pet_${gameId}`,
  gameId,
  name: `物种${gameId}`,
  number: String(gameId),
  eggGroups: [2],
  ...extra,
});

const pet = (
  gameId: number,
  account: string,
  extra: Partial<OwnedPet> = {},
): OwnedPet => ({
  gameId,
  name: `物种${gameId}`,
  gender: '母',
  nature: '固执',
  voiceDb: 100,
  medalBody: '大块头',
  isShiny: false,
  account,
  ...extra,
});

describe('buildMotherChecklist', () => {
  const catalog: SpeciesEntry[] = [
    species(100, { eggGameId: 100 }),
    species(101, { eggGameId: 100 }), // 同蛋的另一形态
    species(200, { eggGameId: 200, eggGroups: [3] }),
    species(300, { eggGameId: 300, eggGroups: [4] }),
    species(400, { eggGameId: 400, eggGroups: [5] }),
    species(500, { eggGameId: 500, eggGroups: [1] }), // 未发现组：不可孵
  ];

  test('我有 → 我能给他孵；他有 → 他能给我孵；都没有 → 双方都没有；两边都有不算', () => {
    const owned = [
      pet(101, '我号'), // 形态 → 归到蛋 100
      pet(200, '他号'),
      pet(400, '我号'),
      pet(400, '他号'), // 两边都有 → 不进清单
    ];
    const result = buildMotherChecklist({
      species: catalog,
      owned,
      mineAccounts: ['我号'],
      criteria: BIG_WAN_CRITERIA,
    });
    expect(result.iCanHatch.map((item) => item.eggGameId)).toEqual([100]);
    expect(result.heCanHatch.map((item) => item.eggGameId)).toEqual([200]);
    expect(result.neither.map((item) => item.eggGameId)).toEqual([300]);
  });

  test('母本个体记录在 accounts 里，形态合并后名字用蛋物种的显示名', () => {
    const result = buildMotherChecklist({
      species: catalog,
      owned: [pet(101, '我号')],
      mineAccounts: ['我号'],
      criteria: BIG_WAN_CRITERIA,
    });
    expect(result.iCanHatch[0]).toEqual({ eggGameId: 100, name: '物种100', accounts: ['我号'] });
  });

  test('不算达标：96dB、公的、小不点、普通声音', () => {
    const owned = [
      pet(100, '我号', { voiceDb: 96 }),
      pet(200, '我号', { gender: '公' }),
      pet(300, '我号', { medalBody: '小不点' }),
      pet(400, '我号', { voiceDb: 50 }),
    ];
    const result = buildMotherChecklist({
      species: catalog,
      owned,
      mineAccounts: ['我号'],
      criteria: BIG_WAN_CRITERIA,
    });
    expect(result.iCanHatch).toEqual([]);
  });

  test('未发现组（蛋组 1）的蛋不进清单', () => {
    const result = buildMotherChecklist({
      species: catalog,
      owned: [pet(500, '我号')],
      mineAccounts: ['我号'],
      criteria: BIG_WAN_CRITERIA,
    });
    expect(result.iCanHatch).toEqual([]);
    expect(result.heCanHatch).toEqual([]);
    expect(result.neither.map((item) => item.eggGameId)).not.toContain(500);
  });
});

describe('mergeChecklistState', () => {
  const state = (owner: 'mine' | 'theirs' | null, done: boolean, at: number) => ({
    owner,
    done,
    at,
  });

  test('按条合并：at 大的赢', () => {
    const local: ChecklistState = { '100': state('mine', false, 1000) };
    const incoming: ChecklistState = { '100': state('theirs', true, 2000) };
    expect(mergeChecklistState(local, incoming)['100']).toEqual(state('theirs', true, 2000));
  });

  test('时间相同保留本地，但对方勾了「已收」而本地没勾时取已收', () => {
    const local: ChecklistState = { '100': state('mine', false, 1000) };
    const same: ChecklistState = { '100': state('theirs', false, 1000) };
    expect(mergeChecklistState(local, same)['100']).toEqual(state('mine', false, 1000));

    const done: ChecklistState = { '100': state('mine', true, 1000) };
    expect(mergeChecklistState(local, done)['100']).toEqual(state('mine', true, 1000));
  });

  test('对方新增的条目会并进来，本地独有的保留', () => {
    const local: ChecklistState = { '100': state('mine', true, 1000) };
    const incoming: ChecklistState = { '200': state('theirs', false, 2000) };
    const merged = mergeChecklistState(local, incoming);
    expect(Object.keys(merged).sort()).toEqual(['100', '200']);
  });
});
