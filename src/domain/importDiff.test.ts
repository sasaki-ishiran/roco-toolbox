import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { analyzeImport, computeAddedPets } from './importDiff';
import type { TargetMode } from './petFilters';
import type { AccountSnapshot } from './parseBackup';
import { parseBackup } from './parseBackup';
import type { OwnedPet, SpeciesEntry } from './types';
import {
  eggGroupNames as realEggGroupNames,
  species as realSpecies,
} from '../data/catalog';

/* ---------------- 合成数据：单测只关心规则，不依赖真实图鉴 ---------------- */

const species: SpeciesEntry[] = [
  { key: 'k1', gameId: 101, name: '熊', number: '001', eggGroups: [2] }, // 巨灵组
  { key: 'k2', gameId: 102, name: '鸟', number: '002', eggGroups: [12, 2] }, // 双蛋组
  { key: 'k3', gameId: 103, name: '鱼', number: '003', eggGroups: [13] }, // 海洋组
];

const eggGroupNames: Record<number, string> = { 2: '巨灵组', 12: '魔力组', 13: '海洋组' };

const pet = (partial: Partial<OwnedPet>): OwnedPet => ({
  gameId: 101,
  name: 'x',
  gender: '公',
  nature: '固执',
  voiceDb: 100,
  medalBody: '大块头',
  isShiny: false,
  account: '甲',
  ...partial,
});

/** 账号名 → 稳定的假 UID（真实场景 UID 唯一；测试里按名字派生，保证不同账号不同主键） */
const gameIdOf = (name: string): number =>
  [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 7);

const snap = (accountName: string, pets: OwnedPet[]): AccountSnapshot => ({
  accountName,
  gameId: gameIdOf(accountName),
  exportedAt: 'exported',
  importedAt: 'imported',
  pets,
  eggs: [],
});

const analyze = (
  previous: AccountSnapshot[],
  imported: AccountSnapshot[],
  mode: TargetMode = 'perfect',
) => analyzeImport({ previous, imported, species, eggGroupNames, mode });

// 合格的满分种公（固执在巨灵组与魔力组都算目标性格）
const stud = pet({ captureId: 'c-stud', gameId: 102, name: '鸟', boxGroup: '盒子03' });
// 合格的母本：大块头 + 100dB → 满分大婉
const perfectMother = pet({
  captureId: 'c-mother',
  gameId: 101,
  name: '熊',
  gender: '母',
  nature: '大胆',
  boxGroup: '盒子01',
  slotOrder: 2,
});
// 普通精灵：分贝不够、也没有体型奖牌 → 两个口径都不算
const plain = pet({
  captureId: 'c-plain',
  gameId: 103,
  name: '鱼',
  voiceDb: 40,
  medalBody: '',
});

describe('computeAddedPets', () => {
  test('首次导入的账号：整份都算新增', () => {
    const [result] = computeAddedPets([], [snap('甲', [stud, plain])]);
    expect(result.accountName).toBe('甲');
    expect(result.isFirstImport).toBe(true);
    expect(result.added).toHaveLength(2);
  });

  test('同一份文件再导入：没有新增（靠 captureId 认出是同一只）', () => {
    const before = snap('甲', [stud, plain]);
    const after = snap('甲', [stud, plain]);
    const [result] = computeAddedPets([before], [after]);
    expect(result.isFirstImport).toBe(false);
    expect(result.added).toEqual([]);
  });

  test('放生不影响判定：少了的精灵不会算成新增', () => {
    const before = snap('甲', [stud, plain]);
    const after = snap('甲', [plain]);
    const [result] = computeAddedPets([before], [after]);
    expect(result.added).toEqual([]);
  });

  test('新抓一只：只报那一只', () => {
    const before = snap('甲', [plain]);
    const newcomer = pet({ captureId: 'c-new', gameId: 102, name: '鸟' });
    const after = snap('甲', [plain, newcomer]);
    const [result] = computeAddedPets([before], [after]);
    expect(result.added.map((p) => p.captureId)).toEqual(['c-new']);
  });

  test('老数据没有唯一编号时退回内容指纹，不会把老精灵全判成新增', () => {
    const before = snap(
      '甲',
      [stud, plain].map(({ captureId: _drop, ...rest }) => rest as OwnedPet),
    );
    const after = snap('甲', [stud, plain]);
    const [result] = computeAddedPets([before], [after]);
    expect(result.added).toEqual([]);
  });

  test('反向混导：本地是新格式、再导一份旧格式（无编号）→ 不把整份精灵误判成新增', () => {
    // 本地每次导入都带 captureId，之后又导了一份升级前导出的（pets 无 captureId）抓包
    const newFormat = snap('甲', [stud, plain]);
    const oldFormat = snap(
      '甲',
      [stud, plain].map(({ captureId: _drop, ...rest }) => rest as OwnedPet),
    );
    const [result] = computeAddedPets([newFormat], [oldFormat]);
    expect(result.added).toEqual([]);
  });

  test('内容完全相同的多只：按数量配对，多出来的才算新增', () => {
    const before = snap('甲', [plain]);
    const twin = { ...plain, captureId: 'c-plain-2' };
    const after = snap('甲', [plain, twin]);
    const [result] = computeAddedPets([before], [after]);
    expect(result.added.map((p) => p.captureId)).toEqual(['c-plain-2']);
  });

  test('多个账号各自比对，结果按导入顺序分组', () => {
    const results = computeAddedPets(
      [snap('甲', [plain])],
      [snap('甲', [plain]), snap('乙', [stud])],
    );
    expect(results.map((r) => r.accountName)).toEqual(['甲', '乙']);
    expect(results[0].added).toEqual([]);
    expect(results[1].isFirstImport).toBe(true);
  });
});

describe('analyzeImport', () => {
  test('只挑出符合看板分类的新增：合格种公 + 合格母本（含位置）', () => {
    const [result] = analyze([], [snap('甲', [stud, perfectMother, plain])]);

    expect(result.studs).toEqual([
      {
        studClass: '大婉',
        pets: [
          {
            label: '鸟',
            box: '盒子03',
            nature: '固执',
            voiceDb: 100,
            gender: '公',
            groupLabels: ['魔力组', '巨灵组'],
          },
        ],
      },
    ]);
    expect(result.mothers).toEqual([
      {
        motherClass: '大婉',
        pets: [
          { label: '熊', box: '盒子01 第2位', nature: '大胆', voiceDb: 100, gender: '母' },
        ],
      },
    ]);
  });

  test('性格不在目标性格里：仍然算种公列出来（够格就不该被藏）', () => {
    // 鱼属海洋组，目标性格是「沉默」；固执不匹配——但它是档位达标的公，必须被列出
    const wrongNature = pet({ captureId: 'c1', gameId: 103, name: '鱼', nature: '固执' });
    const [result] = analyze([], [snap('甲', [wrongNature])]);
    expect(result.studs).toEqual([
      {
        studClass: '大婉',
        pets: [
          { label: '鱼', box: '位置未知', nature: '固执', voiceDb: 100, gender: '公', groupLabels: ['海洋组'] },
        ],
      },
    ]);
  });

  test('不是满分（|dB| != 100）或没有体型牌，都不算种公', () => {
    const offVoice = pet({ captureId: 'c2', gameId: 101, name: '熊', voiceDb: 99 });
    const noBody = pet({ captureId: 'c3', gameId: 101, name: '熊', medalBody: '' });
    const [result] = analyze([], [snap('甲', [offVoice, noBody])]);
    expect(result.studs).toEqual([]);
  });

  test('小不点满分公也算种公（体型是两类独立目标）', () => {
    const small = pet({ captureId: 'c1', gameId: 101, name: '熊', medalBody: '小不点' });
    const [result] = analyze([], [snap('甲', [small])]);
    expect(result.studs.flatMap((s) => s.pets).map((p) => p.label)).toEqual(['熊']);
  });

  test('母本按满分 4 档分组，不够满分的不列', () => {
    const sweetBig = pet({
      captureId: 'c1',
      gameId: 101,
      name: '熊',
      gender: '母',
      voiceDb: 100,
      medalBody: '大块头',
    });
    const roughSmall = pet({
      captureId: 'c2',
      gameId: 101,
      name: '熊',
      gender: '母',
      voiceDb: -100,
      medalBody: '小不点',
    });
    // 97dB 大块头：双牌但不是满分，已不统计
    const notFullScore = pet({
      captureId: 'c3',
      gameId: 101,
      name: '熊',
      gender: '母',
      voiceDb: 97,
      medalBody: '大块头',
    });
    const neither = pet({
      captureId: 'c4',
      gameId: 101,
      name: '熊',
      gender: '母',
      voiceDb: 40,
      medalBody: '',
    });
    const [result] = analyze([], [snap('甲', [sweetBig, roughSmall, notFullScore, neither])]);
    expect(result.mothers.map((g) => g.motherClass)).toEqual(['大婉', '小粗']);
    expect(result.mothers.flatMap((g) => g.pets).map((p) => p.label)).toEqual(['熊', '熊']);
  });

  test('追满分下 97dB 大块头不统计；追双牌下会被统计', () => {
    // 97dB 大块头公：追满分不算种公（|dB| != 100），追双牌算大婉种公
    const nearFullStud = pet({ captureId: 'c-ns', gameId: 101, name: '熊', nature: '固执', voiceDb: 97 });
    const [perfectStud] = analyze([], [snap('甲', [nearFullStud])]);
    expect(perfectStud.studs).toEqual([]);
    const [medalStud] = analyze([], [snap('甲', [nearFullStud])], 'medal');
    expect(medalStud.studs.flatMap((s) => s.pets).map((p) => p.label)).toEqual(['熊']);

    // 97dB 大块头母本同理
    const nearFullMother = pet({
      captureId: 'c-nm',
      gameId: 101,
      name: '熊',
      gender: '母',
      nature: '大胆',
      voiceDb: 97,
    });
    const [perfectMother] = analyze([], [snap('甲', [nearFullMother])]);
    expect(perfectMother.mothers).toEqual([]);
    const [medalMother] = analyze([], [snap('甲', [nearFullMother])], 'medal');
    expect(medalMother.mothers.map((g) => g.motherClass)).toEqual(['大婉']);
  });

  test('这次没新增合格的：两个列表都为空（界面上给"没有新增"提示）', () => {
    const before = snap('甲', [stud, perfectMother, plain]);
    const [result] = analyze([before], [snap('甲', [stud, perfectMother, plain])]);
    expect(result.studs).toEqual([]);
    expect(result.mothers).toEqual([]);
  });
});

describe('analyzeImport（真实抓包 fixture + 真实图鉴）', () => {
  const loadFixture = (name: string) =>
    JSON.parse(readFileSync(resolve(process.cwd(), `src/domain/__fixtures__/${name}`), 'utf8'));

  const analyzeReal = (previous: AccountSnapshot[], imported: AccountSnapshot[]) =>
    analyzeImport({
      previous,
      imported,
      species: realSpecies,
      eggGroupNames: realEggGroupNames,
      mode: 'perfect',
    });

  test('首次导入 backup-sample：火花算种公、机械方方算大婉母本', () => {
    const sample = parseBackup(loadFixture('backup-sample.json'), '2026-09-26T00:00:00.000Z');
    const [result] = analyzeReal([], [sample]);

    expect(result.accountName).toBe('测试甲');
    expect(result.isFirstImport).toBe(true);
    expect(result.studs).toEqual([
      {
        studClass: '大婉',
        pets: [
          {
            label: '火花',
            box: '盒子01 第3位',
            nature: '固执',
            voiceDb: 100,
            gender: '公',
            groupLabels: ['魔力组', '巨灵组'],
          },
        ],
      },
    ]);
    expect(result.mothers).toEqual([
      {
        motherClass: '大婉',
        pets: [{ label: '机械方方', box: '盒子01', nature: '大胆', voiceDb: 100, gender: '母' }],
      },
    ]);
  });

  test('测试乙那份没有符合看板分类的新增', () => {
    const sample2 = parseBackup(loadFixture('backup-sample-2.json'), 'now');
    const [result] = analyzeReal([], [sample2]);
    expect(result.accountName).toBe('测试乙');
    expect(result.studs).toEqual([]);
    expect(result.mothers).toEqual([]);
  });
});
