import { describe, expect, test } from 'vitest';
import type { OwnedPet, SpeciesEntry } from './types';
import type { CoverageSlot } from './studCoverage';
import { buildStudMatrix, representativeOf, studMatrixPickKey } from './studMatrix';

const species: SpeciesEntry[] = [
  { key: 'a', gameId: 101, name: '单组兽', number: '001', eggGroups: [2] },
  { key: 'b', gameId: 102, name: '双组兽', number: '002', eggGroups: [2, 6] },
];

const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));
const eggGroupNames = { 2: '巨灵组', 6: '动物组' };

const pet = (over: Partial<OwnedPet> & { gameId: number; nature: string }): OwnedPet => ({
  name: 'x',
  gender: '公',
  voiceDb: 100,
  medalBody: '大块头',
  isShiny: false,
  account: '甲',
  ...over,
});

const slot = (groupId: number, natureName: string, grade: '大婉' | '小婉' = '大婉'): CoverageSlot => ({
  groupId,
  natureId: 0,
  natureName,
  grade,
});

const build = (over: Partial<Parameters<typeof buildStudMatrix>[0]> = {}) =>
  buildStudMatrix({
    slots: [slot(2, '固执'), slot(2, '开朗'), slot(6, '固执')],
    owned: [pet({ gameId: 101, nature: '固执' })],
    species,
    speciesByGameId,
    eggGroupNames,
    mode: 'perfect',
    grade: '大婉',
    ...over,
  });

describe('buildStudMatrix', () => {
  test('列 = 目标性格并集，按出现次数排序', () => {
    const matrix = build();
    expect(matrix.natures).toEqual(['固执', '开朗']);
    expect(matrix.rows.map((row) => row.groupLabel)).toEqual(['巨灵组', '动物组']);
  });

  test('某组没选该性格 → 该格 targeted=false（界面淡灰），且不会算缺种公', () => {
    const matrix = build();
    const animal = matrix.rows.find((row) => row.groupId === 6)!;
    const open = animal.cells.find((cell) => cell.natureName === '开朗')!;
    expect(open.targeted).toBe(false);
    expect(open.candidates).toHaveLength(0);
  });

  test('同格多只种公按体重 / 声音排序，双组精灵两组都记', () => {
    const matrix = build({
      owned: [
        pet({ gameId: 102, nature: '固执', account: '甲', weightPercent: 80 }),
        pet({ gameId: 101, nature: '固执', account: '乙', weightPercent: 99 }),
      ],
    });
    const giant = matrix.rows.find((row) => row.groupId === 2)!;
    const cell = giant.cells.find((item) => item.natureName === '固执')!;
    expect(cell.candidates.map((item) => item.account)).toEqual(['乙', '甲']);
    // 双组兽同时在动物组的同一性格里
    const animal = matrix.rows.find((row) => row.groupId === 6)!;
    expect(animal.cells.find((item) => item.natureName === '固执')!.candidates).toHaveLength(1);
  });

  test('只统计当前 tab 的档位', () => {
    const matrix = build({
      slots: [slot(2, '固执'), slot(2, '开朗', '小婉')],
      grade: '大婉',
    });
    expect(matrix.natures).toEqual(['固执']);
  });

  test('代表选择：有本机记录且还在候选里就用它，否则自动取第一只', () => {
    const matrix = build({
      owned: [
        pet({ gameId: 101, nature: '固执', account: '甲', weightPercent: 99, captureId: 'c1' }),
        pet({ gameId: 101, nature: '固执', account: '乙', weightPercent: 80, captureId: 'c2' }),
      ],
    });
    const cell = matrix.rows[0].cells.find((item) => item.natureName === '固执')!;
    const auto = representativeOf(cell, undefined, '大婉');
    expect(auto?.account).toBe('甲');

    const picked = representativeOf(
      cell,
      { [studMatrixPickKey('大婉', 2, '固执')]: cell.candidates[1].key },
      '大婉',
    );
    expect(picked?.account).toBe('乙');

    // 记录的那只已经不在了 → 退回自动
    const missing = representativeOf(
      cell,
      { [studMatrixPickKey('大婉', 2, '固执')]: '不存在' },
      '大婉',
    );
    expect(missing?.account).toBe('甲');
  });
});
