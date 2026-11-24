import { describe, expect, test } from 'vitest';
import {
  individualBonusesFromRawHex,
  individualBonusesOfItem,
  sanitizeIndividualBonuses,
} from './individualStats';
import { parseBackup } from './parseBackup';

/**
 * 手搓 field 14 的 protobuf：
 * 顶层每个属性一条嵌套消息，嵌套里的 field 7 带「生命/物攻/…」的个体加成值。
 */
const nested = (bonus: number) => `38${bonus.toString(16).padStart(2, '0')}`;
const field = (index: number, payload: string) =>
  `${(index * 8 + 2).toString(16).padStart(2, '0')}${(payload.length / 2)
    .toString(16)
    .padStart(2, '0')}${payload}`;
const field14 = [
  field(1, nested(0)),
  field(2, nested(8)),
  field(3, nested(9)),
  field(4, nested(0)),
  field(5, nested(0)),
  field(6, nested(10)),
].join('');

describe('个体三维（抓包 field 14）', () => {
  test('只取加成 > 0 的三项，名字按生命/物攻/魔攻/物防/魔防/速度顺序', () => {
    expect(individualBonusesFromRawHex(field14)).toEqual([
      { name: '物攻', value: 8 },
      { name: '魔攻', value: 9 },
      { name: '速度', value: 10 },
    ]);
  });

  test('最多三项：第四项起忽略', () => {
    const hex = [
      field(1, nested(8)),
      field(2, nested(9)),
      field(3, nested(10)),
      field(6, nested(12)),
    ].join('');
    expect(individualBonusesFromRawHex(hex).map((bonus) => bonus.name)).toEqual([
      '生命',
      '物攻',
      '魔攻',
    ]);
  });

  test('坏 hex / 空值不抛错', () => {
    expect(individualBonusesFromRawHex(undefined)).toEqual([]);
    expect(individualBonusesFromRawHex('')).toEqual([]);
    expect(individualBonusesFromRawHex('zz')).toEqual([]);
    expect(individualBonusesFromRawHex('0a')).toEqual([]);
  });

  test('条目里优先用采集器导出的值，没有值再回退 rawFields', () => {
    expect(
      individualBonusesOfItem({
        individualBonuses: [{ name: '物攻', value: 8 }],
        rawFields: { bytes: { '14': [field14] } },
      }),
    ).toEqual([{ name: '物攻', value: 8 }]);
    expect(
      individualBonusesOfItem({ rawFields: { bytes: { '14': [field14] } } }),
    ).toEqual([
      { name: '物攻', value: 8 },
      { name: '魔攻', value: 9 },
      { name: '速度', value: 10 },
    ]);
  });

  test('排序固定为 生命 → 物攻 → 魔攻 → 物防 → 魔防 → 速度', () => {
    expect(
      sanitizeIndividualBonuses([
        { name: '速度', value: 10 },
        { name: '物防', value: 7 },
        { name: '生命', value: 9 },
      ]),
    ).toEqual([
      { name: '生命', value: 9 },
      { name: '物防', value: 7 },
      { name: '速度', value: 10 },
    ]);
    expect(
      sanitizeIndividualBonuses([
        { name: '魔防', value: 8 },
        { name: '魔攻', value: 9 },
        { name: '物攻', value: 10 },
      ]),
    ).toEqual([
      { name: '物攻', value: 10 },
      { name: '魔攻', value: 9 },
      { name: '魔防', value: 8 },
    ]);
  });

  test('外部数据清洗：未知属性 / 非正数 / 重复项都丢掉', () => {
    expect(
      sanitizeIndividualBonuses([
        { name: '物攻', value: 8 },
        { name: '物攻', value: 9 },
        { name: '运气', value: 3 },
        { name: '生命', value: 0 },
        { name: '速度', value: 10 },
      ]),
    ).toEqual([
      { name: '物攻', value: 8 },
      { name: '速度', value: 10 },
    ]);
    expect(sanitizeIndividualBonuses(null)).toBeUndefined();
    expect(sanitizeIndividualBonuses([])).toBeUndefined();
  });
});

describe('导入链路保留个体三维', () => {
  test('新抓包读 individualBonuses；旧 JSON 从 rawFields 的 field 14 解出来', () => {
    const rawHex = '0a023800120238081a023809220238002a0238003202380a';
    const items = [
      {
        speciesPetId: 3200,
        name: '机械方方',
        individualBonuses: [
          { name: '物攻', value: 8 },
          { name: '生命', value: 9 },
          { name: '速度', value: 10 },
        ],
      },
      { speciesPetId: 3200, name: '机械方方', rawFields: { bytes: { '14': [rawHex] } } },
      { speciesPetId: 3200, name: '机械方方' },
    ];
    const parsed = parseBackup(
      { meta: { type: 'hatch-backup', gameId: 1001 }, collections: { petBackpack: { items } } },
      'now',
    );
    expect(parsed.pets[0].individualBonuses).toEqual([
      { name: '生命', value: 9 },
      { name: '物攻', value: 8 },
      { name: '速度', value: 10 },
    ]);
    expect(parsed.pets[1].individualBonuses).toEqual([
      { name: '物攻', value: 8 },
      { name: '魔攻', value: 9 },
      { name: '速度', value: 10 },
    ]);
    expect(parsed.pets[2].individualBonuses).toBeUndefined();
  });
});
