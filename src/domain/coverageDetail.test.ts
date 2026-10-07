import { describe, expect, test } from 'vitest';
import { describeCoverageCells } from './coverageDetail';
import type { CoverageCell } from './studCoverage';
import type { OwnedPet, SpeciesEntry } from './types';

const species: SpeciesEntry[] = [
  { key: 'a', gameId: 901, name: '母方兽', number: '901', eggGroups: [2], maleCapable: true },
  { key: 'b', gameId: 902, name: '种公兽', number: '902', eggGroups: [2], maleCapable: true },
  { key: 'c', gameId: 903, name: '别组兽', number: '903', eggGroups: [7], maleCapable: true },
];

const pet = (over: Partial<OwnedPet> & Pick<OwnedPet, 'gameId' | 'name' | 'gender'>): OwnedPet => ({
  nature: '认真',
  voiceDb: 100,
  medalBody: '大块头',
  isShiny: false,
  account: '账号甲',
  ...over,
});

const cell = (state: CoverageCell['state'], natureName = '固执'): CoverageCell => ({
  groupId: 2,
  natureId: 2,
  natureName,
  grade: '大婉',
  state,
});

describe('describeCoverageCells', () => {
  test('可直接迭代：报出那两只精灵（含账号与盒子位置）', () => {
    const mother = pet({
      gameId: 901,
      name: '母方兽',
      gender: '母',
      nature: '固执',
      account: '测试甲',
      boxGroup: '盒子03',
      slotOrder: 5,
    });
    // 配对方必须与学院那只**同账号**（2026-10-07 修）
    const father = pet({ gameId: 902, name: '种公兽', gender: '公', account: '测试甲' });
    const [detail] = describeCoverageCells({
      cells: [cell('breedable')],
      species,
      mode: 'perfect',
      owned: [mother, father],
    });

    expect(detail.mother).toEqual({
      name: '母方兽',
      account: '测试甲',
      box: '盒子03 第5位',
      gender: '母',
      voiceDb: 100,
      medalBody: '大块头',
      nature: '固执',
    });
    expect(detail.academyParent?.name).toBe('母方兽'); // 母本自带目标性格 → 她进学院小窝
    expect(detail.partner?.name).toBe('种公兽');
    expect(detail.partner?.account).toBe('测试甲');
  });

  test('跨账号不配对：两个账号各出一只，不给这对（不同账号不能一起孵蛋）', () => {
    const mother = pet({
      gameId: 901,
      name: '母方兽',
      gender: '母',
      nature: '固执',
      account: '手机',
    });
    const father = pet({ gameId: 902, name: '种公兽', gender: '公', account: '平板' });
    const [detail] = describeCoverageCells({
      cells: [cell('missingStud')],
      species,
      mode: 'perfect',
      owned: [mother, father],
    });

    expect(detail.academyParent).toBeUndefined();
    expect(detail.partner).toBeUndefined();
  });

  test('同账号里配不上就换账号找：甲账号只有学院那只，乙账号两只都齐', () => {
    // 两只母本同物种（同档位、同性格），靠账号区分选了哪一只
    const lonelyMother = pet({ gameId: 901, name: '母方兽', gender: '母', nature: '固执', account: '甲' });
    const pairedMother = pet({ gameId: 901, name: '母方兽', gender: '母', nature: '固执', account: '乙' });
    const pairedFather = pet({ gameId: 902, name: '种公兽', gender: '公', account: '乙' });
    const [detail] = describeCoverageCells({
      cells: [cell('breedable')],
      species,
      mode: 'perfect',
      owned: [lonelyMother, pairedMother, pairedFather],
    });

    // 甲账号只有学院那只、配不上 → 换到乙账号，两只都齐
    expect(detail.academyParent?.account).toBe('乙');
    expect(detail.partner?.account).toBe('乙');
    expect(detail.partner?.name).toBe('种公兽');
  });

  test('有同档位个体但没人自带目标性格：不给可迭代那一对', () => {
    const mother = pet({ gameId: 901, name: '母方兽', gender: '母', nature: '平和' });
    const father = pet({ gameId: 902, name: '种公兽', gender: '公', nature: '平和' });
    const [detail] = describeCoverageCells({
      cells: [cell('missingStud')],
      species,
      mode: 'perfect',
      owned: [mother, father],
    });

    expect(detail.academyParent).toBeUndefined();
    expect(detail.partner).toBeUndefined();
    // 母本不自带目标性格 → 她在这格上不顶用，不该报成「有母本」
    expect(detail.mother).toBeUndefined();
  });

  test('盒子字段缺失时显示「位置未知」而不是空白', () => {
    const mother = pet({ gameId: 901, name: '母方兽', gender: '母', nature: '固执' });
    const [detail] = describeCoverageCells({
      cells: [cell('breedable')],
      species,
      mode: 'perfect',
      owned: [mother],
    });
    expect(detail.mother?.box).toBe('位置未知');
  });

  test('已有种公：报出是哪只种公', () => {
    const stud = pet({ gameId: 902, name: '种公兽', gender: '公', nature: '固执', account: '测试丙' });
    const [detail] = describeCoverageCells({
      cells: [cell('covered')],
      species,
      mode: 'perfect',
      owned: [stud],
    });
    expect(detail.studs).toHaveLength(1);
    expect(detail.studs[0]?.name).toBe('种公兽');
    expect(detail.studs[0]?.account).toBe('测试丙');
  });

  test('完全空白：不给任何精灵', () => {
    const [detail] = describeCoverageCells({
      cells: [cell('empty')],
      species,
      mode: 'perfect',
      owned: [],
    });
    expect(detail.studs).toEqual([]);
    expect(detail.mother).toBeUndefined();
    expect(detail.academyParent).toBeUndefined();
    expect(detail.partner).toBeUndefined();
  });

  test('别组的精灵不算进本组', () => {
    const otherGroup = pet({ gameId: 903, name: '别组兽', gender: '母', nature: '固执' });
    const [detail] = describeCoverageCells({
      cells: [cell('breedable')],
      species,
      mode: 'perfect',
      owned: [otherGroup],
    });
    expect(detail.mother).toBeUndefined();
  });

  test('母方物种出不了公：她当不了学院亲本（M2：防「永远孵不出种公」的死路配对）', () => {
    const noMaleSpecies: SpeciesEntry[] = [
      { key: 'a', gameId: 901, name: '母方兽', number: '901', eggGroups: [2], maleCapable: false },
      { key: 'b', gameId: 902, name: '种公兽', number: '902', eggGroups: [2], maleCapable: true },
    ];
    const mother = pet({ gameId: 901, name: '母方兽', gender: '母', nature: '固执' });
    const father = pet({ gameId: 902, name: '种公兽', gender: '公', nature: '平和' });
    const [detail] = describeCoverageCells({
      cells: [cell('breedable')],
      species: noMaleSpecies,
      mode: 'perfect',
      owned: [mother, father],
    });
    expect(detail.mother).toBeUndefined();
    expect(detail.academyParent).toBeUndefined();
    expect(detail.partner).toBeUndefined();
  });
});
