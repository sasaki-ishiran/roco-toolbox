import { describe, expect, test } from 'vitest';
import { findMotherGapFill, findStudGapFill } from './gapFill';
import type { MotherNestAccount, MotherHelpItem, MotherNestPairing, MotherNestTask } from './motherNest';
import type { NestPet, NestPlan } from './nestPlan';

const pet = (key: string, name: string, gender: '公' | '母', account = '昭昭'): NestPet => ({
  key,
  gameId: 3002,
  name,
  account,
  gender,
  nature: '大胆',
  voiceDb: 100,
  medalBody: '大块头',
  heightPercent: 100,
  weightPercent: 100,
  box: `${account} · 盒子 01 第 1 位`,
});

const pairing = (over: Partial<MotherNestPairing> = {}): MotherNestPairing => ({
  account: '昭昭',
  grade: '大婉',
  eggGameId: 3002,
  eggName: '水蓝蓝',
  groupIds: [12],
  recommendedNatures: ['聪明'],
  mother: pet('m', '水蓝蓝', '母'),
  father: pet('f', '果冻', '公'),
  natureChance: 0.3,
  femaleChance: 1,
  motherGain: 0.3,
  studGain: 0,
  expectedValue: 0.3,
  sameSpecies: false,
  nestsNeeded: 2,
  ...over,
});

const task = (over: Partial<MotherNestTask> = {}): MotherNestTask => ({
  account: '昭昭',
  grade: '大婉',
  eggGameId: 3002,
  eggName: '水蓝蓝',
  groupIds: [12],
  recommendedNatures: ['聪明'],
  sourceAccount: '云舟',
  mother: pet('m2', '水蓝蓝', '母', '云舟'),
  father: pet('f2', '果冻', '公', '云舟'),
  natureChance: 0.3,
  femaleChance: 1,
  chance: 0.3,
  sameSpecies: false,
  ...over,
});

const help = (over: Partial<MotherHelpItem> = {}): MotherHelpItem => ({
  eggGameId: 3002,
  eggName: '水蓝蓝',
  groupIds: [12],
  recommendedNatures: ['聪明'],
  bestNatureChance: 0.3,
  femaleChance: 0.5,
  ...over,
});

const account = (over: Partial<MotherNestAccount> = {}): MotherNestAccount => ({
  gapCount: 1,
  pairings: [],
  tasks: [],
  helps: [],
  nestsUsed: 0,
  ...over,
});

describe('findMotherGapFill', () => {
  test('本号有直配线时给 self，概率用真实概率（性格 × 出母）', () => {
    const fill = findMotherGapFill(
      3002,
      new Map([['昭昭', account({ pairings: [pairing({ femaleChance: 0.5, motherGain: 0.15 })] })]]),
      ['昭昭'],
    );
    expect(fill.self?.chance).toBeCloseTo(0.15);
    expect(fill.self?.account).toBe('昭昭');
    expect(fill.transfer).toBeNull();
  });

  test('别的号能做时给 transfer，并带上源号', () => {
    const fill = findMotherGapFill(
      3002,
      new Map([['昭昭', account({ tasks: [task()] })]]),
      ['昭昭'],
    );
    expect(fill.transfer?.sourceAccount).toBe('云舟');
    expect(fill.transfer?.chance).toBeCloseTo(0.3);
  });

  test('本号和跨号都有时两段都给', () => {
    const fill = findMotherGapFill(
      3002,
      new Map([['昭昭', account({ pairings: [pairing()], tasks: [task()] })]]),
      ['昭昭'],
    );
    expect(fill.self).not.toBeNull();
    expect(fill.transfer).not.toBeNull();
  });

  test('只能求助时给最好概率（性格 × 出母）', () => {
    const fill = findMotherGapFill(
      3002,
      new Map([['昭昭', account({ helps: [help({ bestNatureChance: 0.3, femaleChance: 0.2 })] })]]),
      ['昭昭'],
    );
    expect(fill.self).toBeNull();
    expect(fill.helpChance).toBeCloseTo(0.06);
  });

  test('多号时本号直配优先取排在前面的号', () => {
    const fill = findMotherGapFill(
      3002,
      new Map([
        ['昭昭', account({ pairings: [pairing({ account: '昭昭' })] })],
        ['云舟', account({ pairings: [pairing({ account: '云舟', motherGain: 0.6 })] })],
      ]),
      ['昭昭', '云舟'],
    );
    expect(fill.self?.account).toBe('昭昭');
  });

  test('别的蛋的线不会串进来；什么都没有时返回空', () => {
    const fill = findMotherGapFill(
      3003,
      new Map([['昭昭', account({ pairings: [pairing({ eggGameId: 3002 })] })]]),
      ['昭昭'],
    );
    expect(fill).toEqual({ self: null, transfer: null, helpChance: null });
  });
});

describe('findStudGapFill', () => {
  const plan = (account: string, over: Partial<NestPlan> = {}): NestPlan => ({
    account,
    pairings: [
      {
        tier: 'normal60',
        groupIds: [2],
        natureName: '固执',
        grade: '大婉',
        account,
        father: pet('f', '父兽', '公', account),
        mother: pet('m', '母兽', '母', account),
        academyParent: null,
        partner: pet('f', '父兽', '公', account),
        natureChance: 0.6,
        expectedValue: 0.6,
        distance: 8,
        fatherPosition: { x: 8, y: 0 },
        motherPosition: { x: 0, y: 0 },
        expected: { species: '火神', nature: '固执', body: '大块头', voice: '婉转声' },
      },
    ],
    blockedLinks: [],
    slots: [],
    nestsUsed: 1,
    nestsTotal: 6,
    clusters: [],
    unfilled: [],
    delegated: [],
    alternatives: [],
    ...over,
  });

  test('本号方案里有这一格 → 本号直配', () => {
    const fill = findStudGapFill({ groupId: 2, natureName: '固执', grade: '大婉' }, [plan('昭昭')], [
      '昭昭',
    ]);
    expect(fill.self?.chance).toBeCloseTo(0.6);
    expect(fill.transfer).toBeNull();
  });

  test('别的号的方案里有这一格 → 跨号传蛋', () => {
    const fill = findStudGapFill({ groupId: 2, natureName: '固执', grade: '大婉' }, [plan('云舟')], [
      '昭昭',
    ]);
    expect(fill.transfer?.sourceAccount).toBe('云舟');
    expect(fill.transfer?.account).toBe('昭昭');
  });

  test('性格 / 档位 / 蛋组对不上时不认', () => {
    const fill = findStudGapFill({ groupId: 2, natureName: '开朗', grade: '大婉' }, [plan('昭昭')], [
      '昭昭',
    ]);
    expect(fill).toEqual({ self: null, transfer: null, helpChance: null });
  });
});
