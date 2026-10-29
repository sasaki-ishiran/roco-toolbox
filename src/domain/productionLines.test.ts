import { describe, expect, test } from 'vitest';
import {
  buildProductionLines,
  lineSuppliesTarget,
  linesSupplyTarget,
  type ProductionTarget,
} from './productionLines';
import type { SpeciesEntry } from './types';
import { catalog, mother, snapshot } from '../test/fixtures/motherSharing';

/** 三号蛋组的一只公；默认就是大婉（大块头 + 100dB）。 */
const male3: SpeciesEntry = {
  key: 'male-3',
  gameId: 701,
  name: '三组公',
  number: '701',
  eggGameId: 701,
  eggGroups: [3],
  stage: 1,
  maleCapable: true,
};

/** 四号蛋组的一只公，用来验证「纯母物种也能有产线，但种公需求不可用」。 */
const male4: SpeciesEntry = {
  key: 'male-4',
  gameId: 801,
  name: '四组公',
  number: '801',
  eggGameId: 801,
  eggGroups: [4],
  stage: 1,
  maleCapable: true,
};

const species: SpeciesEntry[] = [
  ...catalog.map((entry) => (entry.gameId === 201 ? { ...entry, maleCapable: true } : entry)),
  male3,
  male4,
];

const target = (patch: Partial<ProductionTarget> & Pick<ProductionTarget, 'kind'>): ProductionTarget =>
  ({
    nature: '',
    body: '大块头',
    voice: '+100',
    ...(patch.kind === 'mother' ? { eggGameId: 201 } : { groupId: 3 }),
    ...patch,
  }) as ProductionTarget;

const build = (pets: Parameters<typeof snapshot>[2]) =>
  buildProductionLines({
    snapshots: [snapshot(1001, '甲', pets)],
    species,
    mode: 'perfect',
  })[0];

describe('buildProductionLines', () => {
  test('同账号、双方大婉：产线合并母本和公的性格', () => {
    const account = build([
      mother(201, { nature: '固执' }),
      mother(701, { gender: '公', nature: '开朗' }),
    ]);
    expect(account.lines).toHaveLength(1);
    expect(account.lines[0].eggGameId).toBe(201);
    expect(account.lines[0].grade).toBe('大婉');
    expect(new Set(account.lines[0].natures)).toEqual(new Set(['固执', '开朗']));
  });

  test('公不是大婉：不生成产线', () => {
    const account = build([
      mother(201),
      mother(701, { gender: '公', nature: '开朗', medalBody: '', voiceDb: 0 }),
    ]);
    expect(account.lines).toHaveLength(0);
  });

  test('双方档位不同：不生成产线', () => {
    const account = build([
      mother(201),
      mother(701, { gender: '公', nature: '开朗', medalBody: '小不点' }),
    ]);
    expect(account.lines).toHaveLength(0);
  });

  test('身高 100% 且体重 ≥95% 才认体型', () => {
    const account = build([
      mother(201, { medalBody: '', heightPercent: 100, weightPercent: 95 }),
      mother(701, { gender: '公', medalBody: '', heightPercent: 100, weightPercent: 95 }),
    ]);
    expect(account.lines).toHaveLength(1);
    expect(account.lines[0].grade).toBe('大婉');
  });

  test('不能跨账号拼父母', () => {
    const accounts = buildProductionLines({
      snapshots: [
        snapshot(1001, '甲', [mother(201)]),
        snapshot(1002, '乙', [mother(701, { gender: '公' })]),
      ],
      species,
      mode: 'perfect',
    });
    expect(accounts.every((account) => account.lines.length === 0)).toBe(true);
  });
});

describe('lineSuppliesTarget', () => {
  const account = build([
    mother(201, { nature: '固执' }),
    mother(701, { gender: '公', nature: '开朗' }),
  ]);
  const line = account.lines[0];

  test('母本目标：指定蛋 + 性格 + 体型 + 声音都要匹配', () => {
    expect(lineSuppliesTarget(line, target({ kind: 'mother', nature: '固执' }), species, 'perfect')).toBe(true);
    expect(lineSuppliesTarget(line, target({ kind: 'mother', nature: '胆小' }), species, 'perfect')).toBe(false);
    expect(lineSuppliesTarget(line, target({ kind: 'mother', body: '小不点' }), species, 'perfect')).toBe(false);
    expect(lineSuppliesTarget(line, target({ kind: 'mother', voice: '-100' }), species, 'perfect')).toBe(false);
    expect(lineSuppliesTarget(line, target({ kind: 'mother', body: '', voice: '' }), species, 'perfect')).toBe(true);
  });

  test('种公目标：只认蛋组，不认具体物种', () => {
    expect(lineSuppliesTarget(line, target({ kind: 'stud', groupId: 3, nature: '开朗' }), species, 'perfect')).toBe(true);
    expect(lineSuppliesTarget(line, target({ kind: 'stud', groupId: 2, nature: '开朗' }), species, 'perfect')).toBe(false);
    expect(lineSuppliesTarget(line, target({ kind: 'stud', groupId: 3, nature: '胆小' }), species, 'perfect')).toBe(false);
  });

  test('档位标签互通：+100 / 婉转声、-100 / 粗嗓门 在产线判定里等价', () => {
    // 大婉产线：追双牌时用「婉转声」、追满分时用「+100」，两种写法都要认
    expect(lineSuppliesTarget(line, target({ kind: 'mother', voice: '婉转声' }), species, 'perfect')).toBe(true);
    expect(lineSuppliesTarget(line, target({ kind: 'mother', voice: '+100' }), species, 'medal')).toBe(true);

    // 大粗产线同理
    const coarse = build([
      mother(201, { nature: '固执', voiceDb: -100 }),
      mother(701, { gender: '公', nature: '开朗', voiceDb: -100 }),
    ]).lines[0];
    expect(coarse.grade).toBe('大粗');
    expect(lineSuppliesTarget(coarse, target({ kind: 'mother', voice: '-100' }), species, 'medal')).toBe(true);
    expect(lineSuppliesTarget(coarse, target({ kind: 'mother', voice: '粗嗓门' }), species, 'perfect')).toBe(true);
  });

  test('纯母物种有产线，但不能满足种公需求', () => {
    const pureMother = build([
      mother(301, { nature: '固执' }),
      mother(801, { gender: '公', nature: '开朗' }),
    ]);
    const pureLine = pureMother.lines[0];
    expect(pureLine.eggGameId).toBe(301);
    expect(
      lineSuppliesTarget(pureLine, target({ kind: 'mother', eggGameId: 301, nature: '固执' }), species, 'perfect'),
    ).toBe(true);
    expect(
      lineSuppliesTarget(pureLine, target({ kind: 'stud', groupId: 4, nature: '开朗' }), species, 'perfect'),
    ).toBe(false);
  });

  test('一组账号里任意一条产线满足即可', () => {
    const other = build([mother(201, { nature: '胆小' })]);
    expect(linesSupplyTarget([...other.lines, ...account.lines], target({ kind: 'mother', nature: '固执' }), species, 'perfect')).toBe(true);
    expect(linesSupplyTarget(other.lines, target({ kind: 'mother', nature: '固执' }), species, 'perfect')).toBe(false);
  });
});
