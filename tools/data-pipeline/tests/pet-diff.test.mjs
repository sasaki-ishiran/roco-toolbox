import { describe, expect, test } from 'vitest';
import { diffCatalogs, renderChangeReport } from '../src/pet-diff.mjs';

const oldCatalog = {
  pet_000001: { name: '喵喵', number: '002', egg_group: [6, 9], gender_ratio: { male: 5, female: 5 }, stats: { hp: 65, atk: 66 } },
  pet_000002: { name: '水蓝蓝', number: '008', egg_group: [12], gender_ratio: { male: 0, female: 10 }, stats: { hp: 75, atk: 35 } },
};

describe('diffCatalogs', () => {
  test('找出新增的精灵并标注能不能孵蛋', () => {
    const next = { ...oldCatalog, pet_000003: { name: '小箱怪', number: '063', egg_group: [1] } };
    const diff = diffCatalogs(oldCatalog, next);
    expect(diff.added).toEqual([
      { key: 'pet_000003', name: '小箱怪', number: '063', eggGroups: [1], breedable: false },
    ]);
  });

  test('找出上游删掉的条目', () => {
    const next = { pet_000001: oldCatalog.pet_000001 };
    const diff = diffCatalogs(oldCatalog, next);
    expect(diff.removed).toEqual([{ key: 'pet_000002', name: '水蓝蓝' }]);
  });

  test('按字段路径报告数值变化', () => {
    const next = {
      pet_000001: { ...oldCatalog.pet_000001, stats: { hp: 66, atk: 66 } },
      pet_000002: oldCatalog.pet_000002,
    };
    const diff = diffCatalogs(oldCatalog, next);
    expect(diff.changed).toEqual([{ key: 'pet_000001', name: '喵喵', field: 'stats.hp', from: 65, to: 66 }]);
  });

  test('报告蛋组变化', () => {
    const next = {
      pet_000001: { ...oldCatalog.pet_000001, egg_group: [6, 9, 12] },
      pet_000002: oldCatalog.pet_000002,
    };
    const diff = diffCatalogs(oldCatalog, next);
    expect(diff.changed).toContainEqual({ key: 'pet_000001', name: '喵喵', field: 'egg_group', from: [6, 9], to: [6, 9, 12] });
  });

  test('没有变化时三个列表都是空的', () => {
    const diff = diffCatalogs(oldCatalog, { ...oldCatalog });
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });
});

describe('renderChangeReport', () => {
  const meta = { version: 's4-2026-09-24', fetchedAt: '2026-09-25T13:00:00Z', sourceUrl: 'https://wiki.biligame.com/nrc/', petCount: 626 };

  test('列出新增、变化与移除', () => {
    const diff = diffCatalogs(oldCatalog, {
      pet_000001: { ...oldCatalog.pet_000001, stats: { hp: 66, atk: 66 } },
      pet_000003: { name: '小箱怪', number: '063', egg_group: [1] },
    });
    const report = renderChangeReport(diff, meta);
    expect(report).toContain('新增 1');
    expect(report).toContain('小箱怪');
    expect(report).toContain('不可孵蛋');
    expect(report).toContain('stats.hp');
    expect(report).toContain('水蓝蓝');
    expect(report).toContain('s4-2026-09-24');
  });

  test('无变化时给出明确结论', () => {
    const report = renderChangeReport(diffCatalogs(oldCatalog, { ...oldCatalog }), meta);
    expect(report).toContain('没有变化');
  });
});
