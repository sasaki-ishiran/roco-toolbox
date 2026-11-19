import { describe, expect, test } from 'vitest';
import {
  canProduceGender,
  genderFactorOf,
  genderShareOf,
  isSkewedGender,
} from './genderRatio';
import type { SpeciesEntry } from './types';

const mk = (gameId: number, male?: number, female?: number): SpeciesEntry => ({
  key: `k${gameId}`,
  gameId,
  name: `种${gameId}`,
  number: String(gameId),
  eggGroups: [2],
  ...(male === undefined ? {} : { genderRatio: { male, female: female ?? 0 } }),
});

describe('genderRatio 性别比例', () => {
  test('5:5 是基准：比例 0.5、系数 1、不算失衡', () => {
    const pet = mk(1, 5, 5);
    expect(genderShareOf(pet, '公')).toBeCloseTo(0.5);
    expect(genderFactorOf(pet, '公')).toBeCloseTo(1);
    expect(genderFactorOf(pet, '母')).toBeCloseTo(1);
    expect(isSkewedGender(pet)).toBe(false);
  });

  test('8:2 公多：出公系数 1.6、出母 0.4，两侧都还能产', () => {
    const pet = mk(2, 8, 2);
    expect(genderFactorOf(pet, '公')).toBeCloseTo(1.6);
    expect(genderFactorOf(pet, '母')).toBeCloseTo(0.4);
    expect(canProduceGender(pet, '公')).toBe(true);
    expect(canProduceGender(pet, '母')).toBe(true);
    expect(isSkewedGender(pet)).toBe(true);
  });

  test('0 公（纯母）不参与种公路线，但可以当母本来源', () => {
    const pet = mk(3, 0, 10);
    expect(canProduceGender(pet, '公')).toBe(false);
    expect(canProduceGender(pet, '母')).toBe(true);
  });

  test('2:8 少公不参与种公路线，母本侧仍可用', () => {
    const pet = mk(4, 2, 8);
    expect(canProduceGender(pet, '公')).toBe(false);
    expect(canProduceGender(pet, '母')).toBe(true);
  });

  test('10:0 全公不参与母本路线', () => {
    const pet = mk(5, 10, 0);
    expect(canProduceGender(pet, '公')).toBe(true);
    expect(canProduceGender(pet, '母')).toBe(false);
  });

  test('缺性别比例按 5:5 处理', () => {
    const pet = mk(6);
    expect(genderShareOf(pet, '公')).toBeCloseTo(0.5);
    expect(genderFactorOf(pet, '母')).toBeCloseTo(1);
    expect(canProduceGender(pet, '公')).toBe(true);
    expect(canProduceGender(pet, '母')).toBe(true);
    expect(isSkewedGender(pet)).toBe(false);
  });
});
