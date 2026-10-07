import { describe, expect, test } from 'vitest';
import { computeStudCoverage, type CoverageSlot } from './studCoverage';
import type { PetGrade } from './petFilters';
import type { OwnedPet, SpeciesEntry } from './types';

// 蛋组名仅供签名使用；本测试不校验名称
const eggGroupNames: Record<number, string> = {
  2: '巨灵组',
  5: '天空组',
  6: '动物组',
};

// 只保留本测试需要的字段
const species: SpeciesEntry[] = [
  { key: 'a', gameId: 101, name: 'A', number: '001', eggGroups: [2], maleCapable: true },
  { key: 'b', gameId: 102, name: 'B', number: '002', eggGroups: [5], maleCapable: true },
  { key: 'c', gameId: 103, name: 'C', number: '003', eggGroups: [6], maleCapable: true },
  { key: 'd', gameId: 104, name: 'D', number: '004', eggGroups: [2, 6], maleCapable: true }, // 双蛋组
  { key: 'e', gameId: 105, name: 'E', number: '005', eggGroups: [6], maleCapable: true },
];

/** 槽位 = 蛋组 × 性格 × 档位（追满分下显示为「满分大婉」） */
const slot = (groupId: number, natureName: string, grade: PetGrade = '大婉'): CoverageSlot => ({
  groupId,
  natureId: 0,
  natureName,
  grade,
});

const pet = (partial: Partial<OwnedPet>): OwnedPet => ({
  gameId: 0,
  name: 'x',
  gender: '公',
  nature: '固执',
  voiceDb: 100,
  medalBody: '大块头',
  isShiny: false,
  account: '账号A',
  ...partial,
});

describe('computeStudCoverage（槽位带满分档位）', () => {
  test('covered：同蛋组 + 目标性格 + 该档位 + 公', () => {
    const result = computeStudCoverage(
      [slot(2, '固执')],
      species,
      [pet({ gameId: 101, gender: '公', nature: '固执', voiceDb: 100, medalBody: '大块头' })],
      eggGroupNames,
      'perfect',
    );
    expect(result.cells[0].state).toBe('covered');
    expect(result.covered).toBe(1);
  });

  test('breedable：该组有「同档位 + 该性格」的个体，且有同档位的异性', () => {
    const result = computeStudCoverage(
      [slot(5, '固执')],
      species,
      [
        // 学院小窝那只：同档位 + 目标性格（这里用母）
        pet({ gameId: 102, gender: '母', nature: '固执', voiceDb: 100, medalBody: '大块头' }),
        // 旁边配对的异性：只要同档位即可，性格不限
        pet({ gameId: 102, gender: '公', nature: '开朗', voiceDb: 100, medalBody: '大块头' }),
      ],
      eggGroupNames,
      'perfect',
    );
    expect(result.cells[0].state).toBe('breedable');
  });

  test('跨账号不算可迭代：母与公分属两个账号（不同账号的精灵不能配对孵蛋）', () => {
    const result = computeStudCoverage(
      [slot(5, '固执')],
      species,
      [
        // 手机上有带目标性格的母本
        pet({ gameId: 102, gender: '母', nature: '固执', voiceDb: 100, medalBody: '大块头', account: '手机' }),
        // 平板上才有同档位的公 → 配不到一起
        pet({ gameId: 102, gender: '公', nature: '开朗', voiceDb: 100, medalBody: '大块头', account: '平板' }),
      ],
      eggGroupNames,
      'perfect',
    );
    // 本账号里只有母、没有公 → 该格是「未收集」（旧实现错报成「可迭代」）
    expect(result.cells[0].state).toBe('missingStud');
  });

  test('empty：该组有同档位个体，但一只带该性格的都没有（连迭代都启动不了）', () => {
    const result = computeStudCoverage(
      [slot(6, '固执')],
      species,
      // 只有一只同档位公，性格不对 → 谁也带不了固执 → 要去弄
      [pet({ gameId: 103, gender: '公', nature: '开朗', voiceDb: 100, medalBody: '大块头' })],
      eggGroupNames,
      'perfect',
    );
    expect(result.cells[0].state).toBe('empty');
  });

  test('empty：该组连同档位个体都没有', () => {
    const result = computeStudCoverage(
      [slot(6, '固执')],
      species,
      // 大块头但只有 50dB → 不是任何满分档位
      [pet({ gameId: 103, gender: '公', nature: '固执', voiceDb: 50, medalBody: '大块头' })],
      eggGroupNames,
      'perfect',
    );
    expect(result.cells[0].state).toBe('empty');
  });

  test('档位不匹配不算：槽位要小婉时，大块头满分公不算数', () => {
    const result = computeStudCoverage(
      [slot(2, '固执', '小婉')],
      species,
      [pet({ gameId: 101, gender: '公', nature: '固执', voiceDb: 100, medalBody: '大块头' })],
      eggGroupNames,
      'perfect',
    );
    expect(result.cells[0].state).toBe('empty');
  });

  test('档位不匹配不算：粗嗓门满分的公补不了婉转声满分的格', () => {
    const result = computeStudCoverage(
      [slot(2, '固执', '大婉')],
      species,
      [pet({ gameId: 101, gender: '公', nature: '固执', voiceDb: -100, medalBody: '大块头' })],
      eggGroupNames,
      'perfect',
    );
    expect(result.cells[0].state).toBe('empty');
  });

  test('同一个格子的档位是独立的：大婉没齐不影响小婉已齐', () => {
    const result = computeStudCoverage(
      [slot(2, '固执', '大婉'), slot(2, '固执', '小婉')],
      species,
      [pet({ gameId: 101, gender: '公', nature: '固执', voiceDb: 100, medalBody: '小不点' })],
      eggGroupNames,
      'perfect',
    );
    expect(result.cells.map((c) => c.state)).toEqual(['empty', 'covered']);
    expect(result.covered).toBe(1);
  });

  test('双蛋组精灵在两个蛋组都计入', () => {
    const result = computeStudCoverage(
      [slot(2, '固执'), slot(6, '固执')],
      species,
      [pet({ gameId: 104, gender: '公', nature: '固执', voiceDb: 100, medalBody: '大块头' })],
      eggGroupNames,
      'perfect',
    );
    expect(result.cells.map((c) => c.state)).toEqual(['covered', 'covered']);
    expect(result.covered).toBe(2);
  });

  test('groupSummary 聚合：有未 covered 的格则组状态取其最差', () => {
    const result = computeStudCoverage(
      [slot(6, '固执'), slot(6, '开朗')],
      species,
      // 只有一只同档位公、性格是固执：固执那格 covered；开朗那格没人带该性格 → empty
      [pet({ gameId: 103, gender: '公', nature: '固执', voiceDb: 100, medalBody: '大块头' })],
      eggGroupNames,
      'perfect',
    );
    const summary = result.groupSummary.find((row) => row.groupId === 6);
    expect(summary?.covered).toBe(1);
    expect(summary?.total).toBe(2);
    expect(summary?.state).toBe('empty'); // 最差一格决定组状态
  });

  test('槽位为空时矩阵为空，不会报错', () => {
    const result = computeStudCoverage([], species, [], eggGroupNames, 'perfect');
    expect(result.total).toBe(0);
    expect(result.cells).toEqual([]);
  });

  test('追双牌下 97dB 大块头公能覆盖「大婉」格；追满分下不行', () => {
    const nearFull = pet({ gameId: 101, gender: '公', nature: '固执', voiceDb: 97, medalBody: '大块头' });
    const medal = computeStudCoverage([slot(2, '固执', '大婉')], species, [nearFull], eggGroupNames, 'medal');
    expect(medal.cells[0].state).toBe('covered');
    const perfect = computeStudCoverage([slot(2, '固执', '大婉')], species, [nearFull], eggGroupNames, 'perfect');
    expect(perfect.cells[0].state).toBe('empty');
  });

  test('passedGroups：组内槽位全 covered 才算「已通」', () => {
    const result = computeStudCoverage(
      [slot(2, '固执'), slot(6, '固执'), slot(6, '开朗')],
      species,
      // 精灵 D 是 2/6 双蛋组，只覆盖固执 → 巨灵组通关，动物组还差开朗
      [pet({ gameId: 104, gender: '公', nature: '固执', voiceDb: 100, medalBody: '大块头' })],
      eggGroupNames,
      'perfect',
    );
    expect(result.groupCount).toBe(2);
    expect(result.passedGroups).toBe(1);
  });

  test('passedGroups：全空时一组都不通', () => {
    const result = computeStudCoverage(
      [slot(2, '固执'), slot(6, '固执')],
      species,
      [],
      eggGroupNames,
      'perfect',
    );
    expect(result.groupCount).toBe(2);
    expect(result.passedGroups).toBe(0);
  });
});
