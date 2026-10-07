import { describe, expect, test } from 'vitest';
import { extractNatures } from '../src/natures.mjs';

const fixture = {
  labels: {
    blood: { 1: { name: '普通', icon: 'Blood_1.png' } },
    nature: {
      1: { name: '大胆', detail: '物攻↑ / 物防↓' },
      23: { name: '开朗', detail: '速度↑ / 魔攻↓' },
      30: { name: '踏实', detail: '生命↑ / 速度↓' },
    },
  },
  skill: { 7020360: { name: '抓挠' } },
};

describe('extractNatures', () => {
  test('抽出性格并按 id 排序，拆出加成与减益', () => {
    expect(extractNatures(fixture)).toEqual([
      { id: 1, name: '大胆', plus: '物攻', minus: '物防', detail: '物攻↑ / 物防↓' },
      { id: 23, name: '开朗', plus: '速度', minus: '魔攻', detail: '速度↑ / 魔攻↓' },
      { id: 30, name: '踏实', plus: '生命', minus: '速度', detail: '生命↑ / 速度↓' },
    ]);
  });

  test('没有性格数据时返回空数组', () => {
    expect(extractNatures({})).toEqual([]);
    expect(extractNatures({ labels: {} })).toEqual([]);
  });
});
