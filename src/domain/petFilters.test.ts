import { describe, expect, test } from 'vitest';
import {
  buildChainSearchIndex,
  buildTagIndex,
  chainKeyOf,
  classifyGrade,
  classifyMother,
  computeFacetCounts,
  filterByTags,
  gradeLabel,
  groupMothersByEgg,
} from './petFilters';
import { species as realSpecies } from '../data/catalog';
import type { OwnedPet, SpeciesEntry } from './types';

const speciesByGameId = new Map<number, SpeciesEntry>([
  { key: 'a', gameId: 101, name: 'A', number: '001', eggGroups: [2], eggGameId: 101 },
  { key: 'b', gameId: 102, name: 'B', number: '002', eggGroups: [5, 6], eggGameId: 102 }, // 双蛋组
  { key: 'c', gameId: 103, name: 'C', number: '003', eggGroups: [1], eggGameId: 103 }, // 未发现组
].map((s) => [s.gameId, s] as const));

const eggGroupNames: Record<number, string> = {
  1: '未发现',
  2: '巨灵组',
  5: '天空组',
  6: '动物组',
};

const pet = (partial: Partial<OwnedPet>): OwnedPet => ({
  gameId: 101,
  name: 'x',
  gender: '公',
  nature: '固执',
  voiceDb: 0,
  medalBody: '',
  isShiny: false,
  account: '账号A',
  ...partial,
});

const owned: OwnedPet[] = [
  pet({ gameId: 101, gender: '公', nature: '固执', voiceDb: 100, medalBody: '大块头', account: '账号A' }),
  pet({ gameId: 102, gender: '母', nature: '开朗', voiceDb: 96, medalBody: '', account: '账号B' }),
  pet({ gameId: 103, gender: '未知', nature: '踏实', voiceDb: 40, medalBody: '小不点', account: '账号A' }),
];

describe('buildTagIndex', () => {
  test('账号标签按账号分组', () => {
    const result = buildTagIndex(owned, speciesByGameId, eggGroupNames);
    expect(result.index['account:账号A']).toEqual([0, 2]);
    expect(result.index['account:账号B']).toEqual([1]);
  });

  test('体型 / 声音 / 性别 / 异色标签', () => {
    const result = buildTagIndex(owned, speciesByGameId, eggGroupNames);
    expect(result.index['body:大块头']).toEqual([0]);
    expect(result.index['voice:+100']).toEqual([0]); // 满分按方向拆开
    expect(result.index['voice:婉转声']).toEqual([0, 1]); // 96~100
    expect(result.index['gender:公']).toEqual([0]);
    expect(result.index['gender:母']).toEqual([1]);
    expect(result.index['gender:未知']).toBeUndefined(); // 2026-10-04 去掉「未知」性别标签
    expect(result.index['shiny:异色']).toEqual([]); // 无命中但标签仍存在
  });

  test('粗嗓门标签命中 ≤-96 分贝，且 -100 单独成一档（2026-10-05 修正过宽）', () => {
    const rough = pet({ gameId: 101, gender: '公', nature: '固执', voiceDb: -100, medalBody: '大块头', account: '账号C' });
    // -50 不是粗嗓门（旧实现 voiceDb<0 会误标）
    const harsh = pet({ gameId: 104, gender: '母', nature: '开朗', voiceDb: -50, medalBody: '', account: '账号D' });
    const edge = pet({ gameId: 105, gender: '母', nature: '踏实', voiceDb: -96, medalBody: '', account: '账号E' });
    const result = buildTagIndex([...owned, rough, harsh, edge], speciesByGameId, eggGroupNames);
    expect(result.index['voice:-100']).toEqual([3]);
    expect(result.index['voice:粗嗓门']).toEqual([3, 5]); // -100 与 -96；-50 不算
  });

  test('双蛋组精灵在两个蛋组标签都命中', () => {
    const result = buildTagIndex(owned, speciesByGameId, eggGroupNames);
    expect(result.index['eggGroup:5']).toEqual([1]);
    expect(result.index['eggGroup:6']).toEqual([1]);
    expect(result.index['eggGroup:1']).toBeUndefined(); // 未发现组被排除
  });

  test('性格标签按性格分组', () => {
    const result = buildTagIndex(owned, speciesByGameId, eggGroupNames);
    expect(result.index['nature:固执']).toEqual([0]);
    expect(result.index['nature:开朗']).toEqual([1]);
    expect(result.index['nature:踏实']).toEqual([2]);
  });

  test('命中数为 0 的固定标签仍出现在 tags 且 tagCounts 为 0', () => {
    const result = buildTagIndex(owned, speciesByGameId, eggGroupNames);
    const shiny = result.tags.find((t) => t.id === 'shiny:异色');
    expect(shiny).toBeDefined();
    expect(result.tagCounts['shiny:异色']).toBe(0);
  });
});

describe('filterByTags', () => {
  test('叠加筛选取交集', () => {
    const result = buildTagIndex(owned, speciesByGameId, eggGroupNames);
    expect(filterByTags(result.index, ['body:大块头', 'voice:+100'])).toEqual([0]);
    expect(filterByTags(result.index, ['account:账号A', 'nature:固执'])).toEqual([0]);
  });

  test('未选任何标签时返回空数组', () => {
    const result = buildTagIndex(owned, speciesByGameId, eggGroupNames);
    expect(filterByTags(result.index, [])).toEqual([]);
  });

  test('同类标签取并集：同时选多个账号不再得到空结果', () => {
    const result = buildTagIndex(owned, speciesByGameId, eggGroupNames);
    expect(filterByTags(result.index, ['account:账号A', 'account:账号B'])).toEqual([0, 1, 2]);
  });

  test('不同类之间仍是交集', () => {
    const result = buildTagIndex(owned, speciesByGameId, eggGroupNames);
    expect(filterByTags(result.index, ['account:账号A', 'account:账号B', 'gender:公'])).toEqual([0]);
  });

  test('蛋组同类多选取并集', () => {
    const result = buildTagIndex(owned, speciesByGameId, eggGroupNames);
    expect(filterByTags(result.index, ['eggGroup:5', 'eggGroup:6'])).toEqual([1]);
  });
});

describe('computeFacetCounts（动态标签数量）', () => {
  const result = buildTagIndex(owned, speciesByGameId, eggGroupNames);

  test('没选任何标签时等于全库计数', () => {
    const counts = computeFacetCounts(result.index, []);
    expect(counts['gender:公']).toBe(1);
    expect(counts['gender:母']).toBe(1);
    expect(counts['body:大块头']).toBe(1);
  });

  test('选中「大块头」后，公母数量变成大块头里的公母数量', () => {
    const counts = computeFacetCounts(result.index, ['body:大块头']);
    expect(counts['gender:公']).toBe(1);
    expect(counts['gender:母']).toBe(0); // 0 的标签由界面置灰
    expect(counts['voice:+100']).toBe(1);
    expect(counts['shiny:异色']).toBe(0);
  });

  test('同类计数排除本类已选，方便在同类里切换或多选', () => {
    const counts = computeFacetCounts(result.index, ['account:账号A']);
    expect(counts['account:账号A']).toBe(2);
    expect(counts['account:账号B']).toBe(1);
  });

  test('同时选中多个账号时，其他类的计数按并集结果算', () => {
    const counts = computeFacetCounts(result.index, ['account:账号A', 'account:账号B']);
    expect(counts['gender:母']).toBe(1);
    expect(counts['body:小不点']).toBe(1);
  });
});

describe('classifyMother（母本分级）', () => {
  test('大块头 + 100dB、追满分 = 大婉', () => {
    expect(classifyMother(pet({ gender: '母', medalBody: '大块头', voiceDb: 100 }), 'perfect')).toBe(
      '大婉',
    );
  });

  test('追满分 4 档按体型与声音方向细分（都要求 |dB| == 100）', () => {
    expect(classifyMother(pet({ gender: '母', medalBody: '大块头', voiceDb: 100 }), 'perfect')).toBe('大婉');
    expect(classifyMother(pet({ gender: '母', medalBody: '小不点', voiceDb: 100 }), 'perfect')).toBe('小婉');
    expect(classifyMother(pet({ gender: '母', medalBody: '大块头', voiceDb: -100 }), 'perfect')).toBe('大粗');
    expect(classifyMother(pet({ gender: '母', medalBody: '小不点', voiceDb: -100 }), 'perfect')).toBe('小粗');
  });

  test('追满分下不够满分的一律算其他（96~99 那类不统计）', () => {
    expect(classifyMother(pet({ gender: '母', medalBody: '大块头', voiceDb: 99 }), 'perfect')).toBe('其他');
    expect(classifyMother(pet({ gender: '母', medalBody: '大块头', voiceDb: 98 }), 'perfect')).toBe('其他');
    expect(classifyMother(pet({ gender: '母', medalBody: '小不点', voiceDb: 96 }), 'perfect')).toBe('其他');
    expect(classifyMother(pet({ gender: '母', medalBody: '大块头', voiceDb: -97 }), 'perfect')).toBe('其他');
  });

  test('追双牌下 96~99 也够档（拿声音牌即可）', () => {
    expect(classifyMother(pet({ gender: '母', medalBody: '大块头', voiceDb: 97 }), 'medal')).toBe('大婉');
    expect(classifyMother(pet({ gender: '母', medalBody: '小不点', voiceDb: 96 }), 'medal')).toBe('小婉');
    expect(classifyMother(pet({ gender: '母', medalBody: '大块头', voiceDb: -99 }), 'medal')).toBe('大粗');
  });

  test('只有单牌或没有牌的算其他', () => {
    expect(classifyMother(pet({ gender: '母', medalBody: '大块头', voiceDb: 40 }), 'perfect')).toBe('其他');
    expect(classifyMother(pet({ gender: '母', medalBody: '', voiceDb: 100 }), 'perfect')).toBe('其他');
    expect(classifyMother(pet({ gender: '母', medalBody: '小不点', voiceDb: 0 }), 'perfect')).toBe('其他');
    // 追双牌同样要求体型牌
    expect(classifyMother(pet({ gender: '母', medalBody: '', voiceDb: 100 }), 'medal')).toBe('其他');
  });

  test('非母本返回 null', () => {
    expect(classifyMother(pet({ gender: '公', medalBody: '大块头', voiceDb: 100 }), 'perfect')).toBeNull();
  });

  test('同一链有多只母本时取等级最高的那档', () => {
    const mothers = [
      pet({ gameId: 101, gender: '母', medalBody: '小不点', voiceDb: 98 }),
      pet({ gameId: 101, gender: '母', medalBody: '大块头', voiceDb: 100 }),
    ];
    const groups = groupMothersByEgg(mothers, speciesByGameId, [], 'perfect');
    expect(groups[0].motherClass).toBe('大婉');
  });
});

describe('gradeLabel（档位显示名随模式）', () => {
  test('追满分带「满分」前缀', () => {
    expect(gradeLabel('大婉', 'perfect')).toBe('满分大婉');
    expect(gradeLabel('小粗', 'perfect')).toBe('满分小粗');
  });

  test('追双牌直接用简名', () => {
    expect(gradeLabel('大婉', 'medal')).toBe('大婉');
    expect(gradeLabel('小粗', 'medal')).toBe('小粗');
  });
});

describe('classifyGrade（档位判定随模式）', () => {
  test('97dB 大块头：追双牌算大婉，追满分不算', () => {
    const nearFull = pet({ gender: '母', medalBody: '大块头', voiceDb: 97 });
    expect(classifyGrade(nearFull, 'medal')).toBe('大婉');
    expect(classifyGrade(nearFull, 'perfect')).toBeNull();
  });

  test('正好 96dB 小不点负值：追双牌算小粗', () => {
    const justMedal = pet({ gender: '母', medalBody: '小不点', voiceDb: -96 });
    expect(classifyGrade(justMedal, 'medal')).toBe('小粗');
    expect(classifyGrade(justMedal, 'perfect')).toBeNull();
  });

  test('两种模式都要求体型牌', () => {
    const noBody = pet({ gender: '母', medalBody: '', voiceDb: 100 });
    expect(classifyGrade(noBody, 'medal')).toBeNull();
    expect(classifyGrade(noBody, 'perfect')).toBeNull();
  });
});

describe('groupMothersByEgg（母本清单按「蛋」分组）', () => {
  const speciesByGameId2 = new Map<number, SpeciesEntry>([
    { key: 'x', gameId: 201, name: '岚鸟', form: '春天的样子', number: '020', evolutionId: 'evo_spring', eggGroups: [5], eggGameId: 201 },
    { key: 'y', gameId: 202, name: '岚鸟', form: '夏天的样子', number: '020', evolutionId: 'evo_summer', eggGroups: [5], eggGameId: 202 },
  ].map((s) => [s.gameId, s] as const));

  test('同一颗蛋的多只母本归为一组，collected 为 true 的排前面', () => {
    const owned2: OwnedPet[] = [
      pet({ gameId: 202, gender: '公' }), // 夏天的蛋，无母本
      pet({ gameId: 201, gender: '母' }), // 春天的蛋，母本1
      pet({ gameId: 201, gender: '母' }), // 春天的蛋，母本2
    ];
    const groups = groupMothersByEgg(owned2, speciesByGameId2, [], 'perfect');
    expect(groups[0].chainKey).toBe('egg:201');
    expect(groups[0].collected).toBe(true);
    expect(groups[0].memberIndexes).toEqual([1, 2]);
    expect(groups[1].chainKey).toBe('egg:202');
    expect(groups[1].collected).toBe(false);
  });

  test('区分优质母本：追满分下大块头 + 满分的母本才算 quality', () => {
    const groups = groupMothersByEgg(owned, speciesByGameId, [], 'perfect');
    // [0] 是大块头满分公，不是母本 → 该蛋未收集、也非优质
    const maleOnly = groups.find((g) => g.chainKey === 'egg:101');
    expect(maleOnly?.collected).toBe(false);
    expect(maleOnly?.quality).toBe(false);
    // [1] 是 96dB 母本（无体型牌）：算已收集，但追满分下不够档
    const weakMother = groups.find((g) => g.chainKey === 'egg:102');
    expect(weakMother?.collected).toBe(true);
    expect(weakMother?.quality).toBe(false);
  });

  test('追双牌下 96~99 的合格母本也算 quality', () => {
    const owned: OwnedPet[] = [
      pet({ gameId: 101, gender: '母', medalBody: '大块头', voiceDb: 97 }),
    ];
    expect(groupMothersByEgg(owned, speciesByGameId, [], 'medal')[0].quality).toBe(true);
    // 同一只母本在追满分下不够档
    expect(groupMothersByEgg(owned, speciesByGameId, [], 'perfect')[0].quality).toBe(false);
  });

  test('以图鉴的蛋物种为全集，完全没拥有的蛋也要出现在未收集里', () => {
    const speciesAll: SpeciesEntry[] = [
      { key: 'a', gameId: 101, name: 'A', number: '001', eggGroups: [2], eggGameId: 101 },
      { key: 'z', gameId: 999, name: 'Z 没人有', number: '999', eggGroups: [5], eggGameId: 999 },
    ];
    const groups = groupMothersByEgg(owned, speciesByGameId, speciesAll, 'perfect');
    expect(groups.map((g) => g.chainKey).sort()).toEqual(['egg:101', 'egg:999']);
    const missing = groups.find((g) => g.chainKey === 'egg:999');
    expect(missing?.collected).toBe(false);
    expect(missing?.formLabel).toBe('Z 没人有');
  });

  test('每颗蛋带上可孵蛋组：未收集清单要靠它分批去抓', () => {
    const dual: SpeciesEntry[] = [
      { key: 'd', gameId: 301, name: '双组兽', number: '301', eggGroups: [9, 2], eggGameId: 301 },
    ];
    const groups = groupMothersByEgg([], new Map(), dual, 'perfect');
    expect(groups[0].eggGroups).toEqual([2, 9]); // 升序，便于直接显示
  });

  test('每颗蛋带 eggGameId（页面靠它查这条血脉的推荐性格）', () => {
    const catalogOne: SpeciesEntry[] = [
      { key: 'e', gameId: 401, name: '单蛋兽', number: '401', eggGroups: [2], eggGameId: 401 },
    ];
    const groups = groupMothersByEgg([], new Map(), catalogOne, 'perfect');
    expect(groups[0].eggGameId).toBe(401);
  });

  test('未发现组（1）不算可孵蛋组', () => {
    const undiscovered: SpeciesEntry[] = [
      { key: 'u', gameId: 302, name: '未发现兽', number: '302', eggGroups: [1, 2], eggGameId: 302 },
    ];
    const groups = groupMothersByEgg([], new Map(), undiscovered, 'perfect');
    expect(groups[0].eggGroups).toEqual([2]);
  });

  test('无蛋血脉（eggGameId 为 null）不进母本清单', () => {
    const noEgg: SpeciesEntry[] = [
      { key: 'n', gameId: 303, name: '首领兽', number: '303', eggGroups: [2], eggGameId: null },
    ];
    const ownedNoEgg: OwnedPet[] = [pet({ gameId: 303, gender: '母' })];
    const groups = groupMothersByEgg(ownedNoEgg, new Map([[303, noEgg[0]]]), noEgg, 'perfect');
    expect(groups).toHaveLength(0);
  });

  // —— 真实数据回归（2026-10-05 用户报的错）——
  const realByGameId = new Map(realSpecies.map((s) => [s.gameId, s]));

  test('持有已进化的火神 → 归到「火花」那颗蛋，而不是自成一行', () => {
    const ownedReal: OwnedPet[] = [pet({ gameId: 3006, gender: '母', medalBody: '大块头', voiceDb: 100 })];
    const groups = groupMothersByEgg(ownedReal, realByGameId, realSpecies, 'perfect');
    const spark = groups.find((g) => g.chainKey === 'egg:3003');
    expect(spark?.formLabel).toBe('火花');
    expect(spark?.memberIndexes).toEqual([0]); // 火神算作火花的母本
  });

  test('古卷执政官/古卷匣魔像（书魔虫分支）归到「书魔虫」那颗蛋，不单独成行', () => {
    const groups = groupMothersByEgg([], realByGameId, realSpecies, 'perfect');
    expect(groups.find((g) => g.chainKey === 'egg:3612')).toBeUndefined();
    expect(groups.find((g) => g.chainKey === 'egg:3613')).toBeUndefined();
    expect(groups.find((g) => g.chainKey === 'egg:3610')?.formLabel).toBe('书魔虫');
  });

  test('雪绒鸟四季是四颗独立的蛋（春/夏/秋各自成行）', () => {
    const groups = groupMothersByEgg([], realByGameId, realSpecies, 'perfect');
    for (const [gameId, label] of [
      [3279, '雪绒鸟_春天的样子'],
      [3280, '雪绒鸟_夏天的样子'],
      [3533, '雪绒鸟_本来的样子'],
    ] as const) {
      expect(groups.find((g) => g.chainKey === `egg:${gameId}`)?.formLabel).toBe(label);
    }
  });

  test('海盔虫_磨损的样子（无自己的蛋）归到「海盔虫_本来的样子」那颗蛋', () => {
    const groups = groupMothersByEgg([], realByGameId, realSpecies, 'perfect');
    expect(groups.find((g) => g.chainKey === 'egg:3475')).toBeUndefined();
    expect(groups.find((g) => g.chainKey === 'egg:3330')?.formLabel).toBe('海盔虫_本来的样子');
  });
});

describe('buildChainSearchIndex（进化链全员搜索）', () => {
  const chain: SpeciesEntry[] = [
    { key: 'f1', gameId: 1, name: '火花', number: '005', evolutionId: 'evo_fire', eggGroups: [2], stage: 1 },
    { key: 'f2', gameId: 2, name: '焰火', number: '007', evolutionId: 'evo_fire', eggGroups: [2], stage: 2 },
    { key: 'f3', gameId: 3, name: '火神', number: '009', evolutionId: 'evo_fire', eggGroups: [2], stage: 3 },
  ];

  test('链上任一成员的名字都能命中整条链', () => {
    const index = buildChainSearchIndex(chain);
    const text = index.get('evo_fire') ?? '';
    expect(text).toContain('火花');
    expect(text).toContain('焰火');
    expect(text).toContain('火神');
  });

  test('图鉴号也能命中整条链', () => {
    const index = buildChainSearchIndex(chain);
    expect(index.get('evo_fire')).toContain('007');
  });

  test('没有 evolutionId 的物种按自身单独成链', () => {
    const solo: SpeciesEntry[] = [
      { key: 'solo:9001', gameId: 9001, name: '独行兽', number: '900', eggGroups: [2] },
    ];
    const index = buildChainSearchIndex(solo);
    expect(index.get('solo:9001')).toContain('独行兽');
  });
});

describe('chainKeyOf（取精灵所属进化链的键）', () => {
  test('有 evolutionId 用 evolutionId，否则退回 key，再退回 gameId', () => {
    expect(chainKeyOf({ key: 'k', gameId: 1, name: 'x', number: '1', eggGroups: [2], evolutionId: 'evo_x' }, 1)).toBe('evo_x');
    expect(chainKeyOf({ key: 'k', gameId: 2, name: 'x', number: '2', eggGroups: [2] }, 2)).toBe('k');
    expect(chainKeyOf(undefined, 3)).toBe('3');
  });
});
