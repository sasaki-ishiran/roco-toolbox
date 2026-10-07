import { describe, expect, test } from 'vitest';
import { speciesDisplayName } from './speciesName';
import type { SpeciesEntry } from './types';

const entry = (over: Partial<SpeciesEntry>): SpeciesEntry => ({
  key: 'k',
  gameId: 1,
  name: '雪绒鸟',
  number: '018',
  eggGroups: [5],
  ...over,
});

describe('speciesDisplayName 官方名优先', () => {
  test('有官方名就用官方名（游戏自己的写法）', () => {
    expect(
      speciesDisplayName(
        entry({ form: '夏天的样子', officialName: '雪绒鸟_夏天的样子' }),
        '兜底',
      ),
    ).toBe('雪绒鸟_夏天的样子');
  });

  test('官方名可能与图鉴的形态文字不同：地鼠 储水时 → 储水期', () => {
    expect(
      speciesDisplayName(
        entry({ name: '地鼠', form: '储水时的样子', officialName: '地鼠_储水期的样子' }),
        '兜底',
      ),
    ).toBe('地鼠_储水期的样子');
  });

  test('官方名可能不带形态后缀：只有一个形态的物种', () => {
    expect(
      speciesDisplayName(entry({ name: '护主犬', form: '本来的样子', officialName: '护主犬' }), '兜底'),
    ).toBe('护主犬');
  });

  test('没有官方名时自己拼，分隔符与官方一致（下划线）', () => {
    expect(speciesDisplayName(entry({ form: '秋天的样子' }), '兜底')).toBe('雪绒鸟_秋天的样子');
  });

  test('没有形态就是物种名', () => {
    expect(speciesDisplayName(entry({}), '兜底')).toBe('雪绒鸟');
  });

  test('查不到图鉴条目时退回兜底名（通常是抓包里的 pet.name）', () => {
    expect(speciesDisplayName(undefined, '未知精灵')).toBe('未知精灵');
  });
});