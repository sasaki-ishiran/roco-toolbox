import { describe, expect, test } from 'vitest';
import type { AccountSnapshot } from './parseBackup';
import type { OwnedPet, SpeciesEntry } from './types';
import { buildDemandPlacements, type DemandPlacementDemand } from './demandPlacement';

/**
 * 需求单上窝分配（二期）。
 *
 * 口径（用户 2026-10-30 拍板）：
 * - 优先 1:1；窝不够或种公不够时才允许 1:2；
 * - 按接单时间先到先得；
 * - 每账号 11 窝全量（1 学院 + 10 普通）；
 * - 学院小窝 1 只、最多 2 个配对方，且只遗传它自己的性格。
 */

const species: SpeciesEntry[] = [
  { key: 'egg-a', gameId: 100, name: '火花', number: '001', eggGroups: [2], maleCapable: true, eggGameId: 100 },
  { key: 'form-a', gameId: 101, name: '火神', number: '002', eggGroups: [2], maleCapable: true, eggGameId: 100 },
  { key: 'egg-b', gameId: 200, name: '雪绒鸟', number: '003', eggGroups: [2], maleCapable: true, eggGameId: 200 },
  { key: 'egg-c', gameId: 300, name: '水灵', number: '004', eggGroups: [3], maleCapable: true, eggGameId: 300 },
  { key: 'egg-d', gameId: 400, name: '纯母兽', number: '005', eggGroups: [2], maleCapable: false, eggGameId: 400 },
];

let seq = 0;
function pet(over: Partial<OwnedPet> & Pick<OwnedPet, 'gameId' | 'gender'>): OwnedPet {
  seq += 1;
  return {
    name: `精灵${seq}`,
    nature: '固执',
    voiceDb: 100,
    medalBody: '大块头',
    weightPercent: 99,
    heightPercent: 100,
    isShiny: false,
    account: '账号A',
    captureId: `cap_${seq}`,
    ...over,
  };
}

function snap(name: string, gameId: number, pets: OwnedPet[], academyInstanceId?: string): AccountSnapshot {
  return {
    accountName: name,
    gameId,
    accountKey: `uid:${gameId}`,
    exportedAt: '2026-10-30T00:00:00.000Z',
    importedAt: '2026-10-30T00:00:00.000Z',
    pets,
    eggs: [],
    home: academyInstanceId
      ? {
          schemaVersion: 1,
          gameId: String(gameId),
          capturedAt: '2026-10-30T00:00:00.000Z',
          residents: [
            {
              instanceId: academyInstanceId,
              baseId: '0',
              furnitureGuid: 'nest-1',
              actorId: 'actor-1',
              name: '学院精灵',
              nest: { furnitureGuid: 'nest-1', configId: 1, nestType: 'academy', nestName: '学院小窝' },
            },
          ],
          nests: [],
          layEggCouples: [],
          sceneEggs: [],
          couplesStale: false,
        }
      : undefined,
  };
}

function demand(over: Partial<DemandPlacementDemand> = {}): DemandPlacementDemand {
  return {
    groupId: 'g1',
    demanderAccountId: 'm1',
    eggGameId: 100,
    nature: '固执',
    gender: '母',
    body: '大块头',
    voice: '+100',
    claimedAt: 1,
    ...over,
  };
}

describe('buildDemandPlacements', () => {
  test('自带目标性格的配对优先进学院小窝：不看家园现状，直接派它进绿窝', () => {
    const mother = pet({ gameId: 100, gender: '母', nature: '固执' });
    const father = pet({ gameId: 200, gender: '公', nature: '固执' });
    const result = buildDemandPlacements({
      demands: [demand()],
      snapshots: [snap('账号A', 11, [mother, father])],
      species,
    });

    expect(result.accounts).toHaveLength(1);
    const [placement] = result.accounts[0].placements;
    expect(placement.mother.pet).toBe(mother);
    expect(placement.father.pet).toBe(father);
    expect(placement.tier).toBe('academy');
    expect(placement.natureChance).toBe(1);
    expect(placement.academyResident).toBe('mother');
    expect(placement.newNests).toBe(2);
    expect(placement.sharedKeys).toEqual([]);
    expect(result.accounts[0].nestsUsed).toBe(2);
  });

  test('学院小窝只派一次：第二条性格不同的单走普通窝', () => {
    const motherA = pet({ gameId: 100, gender: '母', nature: '固执' });
    const motherB = pet({ gameId: 100, gender: '母', nature: '开朗' });
    const fatherA = pet({ gameId: 200, gender: '公', nature: '固执' });
    const fatherB = pet({ gameId: 200, gender: '公', nature: '开朗' });
    const result = buildDemandPlacements({
      demands: [
        demand({ claimedAt: 1, nature: '固执' }),
        demand({ claimedAt: 2, demanderAccountId: 'm2', nature: '开朗' }),
      ],
      snapshots: [snap('账号A', 11, [motherA, motherB, fatherA, fatherB])],
      species,
    });

    const placements = result.accounts[0].placements;
    expect(placements[0].tier).toBe('academy');
    expect(placements[1].tier).toBe('normal60');
    expect(placements[1].academyResident).toBeNull();
  });

  test('不挑性格的单不吃学院窝优势', () => {
    const mother = pet({ gameId: 100, gender: '母', nature: '固执' });
    const father = pet({ gameId: 200, gender: '公', nature: '固执' });
    const result = buildDemandPlacements({
      demands: [demand({ nature: undefined })],
      snapshots: [snap('账号A', 11, [mother, father])],
      species,
    });

    const [placement] = result.accounts[0].placements;
    expect(placement.tier).toBe('normal60');
    expect(placement.academyResident).toBeNull();
  });

  test('学院那只可以共用服务两条同款单（1:2），不额外占窝，也不会出现第二只绿窝', () => {
    const motherA = pet({ gameId: 100, gender: '母', nature: '固执' });
    const fatherA = pet({ gameId: 200, gender: '公', nature: '固执' });
    const result = buildDemandPlacements({
      demands: [
        demand({ claimedAt: 1, nature: '固执' }),
        demand({ claimedAt: 2, demanderAccountId: 'm2', nature: '固执' }),
      ],
      snapshots: [snap('账号A', 11, [motherA, fatherA])],
      species,
    });

    const placements = result.accounts[0].placements;
    expect(placements).toHaveLength(2);
    // 两条单共用同一只学院精灵，学院位只有一个
    expect(placements[1].tier).toBe('academy');
    expect(placements[1].mother.pet).toBe(motherA);
    expect(placements[1].academyResident).toBe('mother');
    expect(placements[1].newNests).toBe(0);
    expect(placements[1].sharedKeys).toHaveLength(2);
  });

  test('学院那只最多带两条单，第三条排不上', () => {
    const motherA = pet({ gameId: 100, gender: '母', nature: '固执' });
    const fatherA = pet({ gameId: 200, gender: '公', nature: '固执' });
    const result = buildDemandPlacements({
      demands: [
        demand({ claimedAt: 1, nature: '固执' }),
        demand({ claimedAt: 2, demanderAccountId: 'm2', nature: '固执' }),
        demand({ claimedAt: 3, demanderAccountId: 'm3', nature: '固执' }),
      ],
      snapshots: [snap('账号A', 11, [motherA, fatherA])],
      species,
    });

    expect(result.accounts[0].placements).toHaveLength(2);
    expect(result.unassigned).toHaveLength(1);
  });

  test('不挑性格的单可以复用一只种公（1:2），只新占母本一个窝', () => {
    const motherA = pet({ gameId: 100, gender: '母', nature: '固执' });
    const motherB = pet({ gameId: 100, gender: '母', nature: '开朗' });
    const father = pet({ gameId: 200, gender: '公', nature: '固执' });
    const result = buildDemandPlacements({
      demands: [
        demand({ claimedAt: 1, nature: undefined }),
        demand({ claimedAt: 2, demanderAccountId: 'm2', nature: '开朗' }),
      ],
      snapshots: [snap('账号A', 11, [motherA, motherB, father])],
      species,
    });

    const placements = result.accounts[0].placements;
    expect(placements).toHaveLength(2);
    expect(placements[1].mother.pet).toBe(motherB);
    expect(placements[1].father.pet).toBe(father);
    expect(placements[1].tier).toBe('normal30');
    expect(placements[1].newNests).toBe(1);
    expect(placements[1].sharedKeys).toHaveLength(1);
  });

  test('窝不够时排不上，原因写 no-room', () => {
    const motherA = pet({ gameId: 100, gender: '母' });
    const motherB = pet({ gameId: 200, gender: '母' });
    const father = pet({ gameId: 200, gender: '公' });
    const result = buildDemandPlacements({
      demands: [
        demand({ claimedAt: 1 }),
        demand({ claimedAt: 2, demanderAccountId: 'm2', eggGameId: 200 }),
      ],
      snapshots: [snap('账号A', 11, [motherA, motherB, father])],
      species,
      nestCount: 2,
    });

    expect(result.accounts[0].placements).toHaveLength(1);
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0].reason).toBe('no-room');
  });

  test('条件不相容时不能共用同一只种公：+100 的公配不上 -100 的单', () => {
    const motherBig = pet({ gameId: 100, gender: '母', voiceDb: 100 });
    const motherSmall = pet({ gameId: 100, gender: '母', voiceDb: -100 });
    const fatherBig = pet({ gameId: 200, gender: '公', voiceDb: 100 });
    const result = buildDemandPlacements({
      demands: [
        demand({ claimedAt: 1, voice: '+100' }),
        demand({ claimedAt: 2, demanderAccountId: 'm2', voice: '-100' }),
      ],
      snapshots: [snap('账号A', 11, [motherBig, motherSmall, fatherBig])],
      species,
    });

    expect(result.accounts[0].placements).toHaveLength(1);
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0].reason).toBe('no-father');
  });

  test('学院窝派的是自带目标性格的那只，不看家园里原来住的是谁', () => {
    const mother = pet({ gameId: 100, gender: '母', nature: '开朗' });
    const resident = pet({ gameId: 200, gender: '公', nature: '固执', captureId: 'cap_academy' });
    const result = buildDemandPlacements({
      demands: [demand()],
      snapshots: [
        {
          ...snap('账号A', 11, [mother, resident]),
          // 家园里原来的学院住户故意写成一只性格不符的精灵：分配不该看它
          home: {
            schemaVersion: 1,
            gameId: '11',
            capturedAt: '2026-10-30T00:00:00.000Z',
            residents: [
              {
                instanceId: 'academy',
                baseId: '0',
                furnitureGuid: 'nest-1',
                actorId: 'actor-1',
                name: '学院精灵',
                nest: { furnitureGuid: 'nest-1', configId: 1, nestType: 'academy', nestName: '学院小窝' },
              },
            ],
            nests: [],
            layEggCouples: [],
            sceneEggs: [],
            couplesStale: false,
          },
        },
      ],
      species,
    });

    const [placement] = result.accounts[0].placements;
    expect(placement.tier).toBe('academy');
    expect(placement.natureChance).toBe(1);
    expect(placement.academyResident).toBe('father');
    expect(placement.father.pet).toBe(resident);
  });

  test('学院窝的配对方不能被普通窝先用掉', () => {
    const motherA = pet({ gameId: 100, gender: '母', nature: '开朗' });
    const motherB = pet({ gameId: 100, gender: '母', nature: '固执' });
    const father = pet({ gameId: 200, gender: '公', nature: '固执' });
    const result = buildDemandPlacements({
      demands: [
        demand({ claimedAt: 1, nature: undefined }),
        demand({ claimedAt: 2, demanderAccountId: 'm2', nature: '固执' }),
      ],
      snapshots: [snap('账号A', 11, [motherA, motherB, father])],
      species,
    });

    const placements = result.accounts[0].placements;
    // 第一条单（不挑性格）先用掉一只种公；学院窝不能拿它当配对方，第二条单只能走普通窝
    expect(placements[0].tier).toBe('normal60');
    expect(placements[1].tier).toBe('normal60');
    expect(placements[1].academyResident).toBeNull();
  });

  test('没有目标蛋母本时写 no-mother', () => {
    const father = pet({ gameId: 200, gender: '公' });
    const result = buildDemandPlacements({
      demands: [demand()],
      snapshots: [snap('账号A', 11, [father])],
      species,
    });

    expect(result.unassigned[0].reason).toBe('no-mother');
  });

  test('目标蛋出不了公却要公时写 impossible', () => {
    const mother = pet({ gameId: 400, gender: '母' });
    const result = buildDemandPlacements({
      demands: [demand({ eggGameId: 400, gender: '公' })],
      snapshots: [snap('账号A', 11, [mother])],
      species,
    });

    expect(result.unassigned[0].reason).toBe('impossible');
  });

  test('本机第一个账号配不出时换下一个账号', () => {
    const motherOnly = pet({ gameId: 100, gender: '母', account: '账号A' });
    const mother = pet({ gameId: 100, gender: '母', account: '账号B' });
    const father = pet({ gameId: 200, gender: '公', account: '账号B' });
    const result = buildDemandPlacements({
      demands: [demand()],
      snapshots: [snap('账号A', 11, [motherOnly]), snap('账号B', 12, [mother, father])],
      species,
    });

    expect(result.accounts.find((account) => account.accountKey === 'uid:12')?.placements).toHaveLength(1);
    expect(result.accounts.find((account) => account.accountKey === 'uid:11')?.placements).toHaveLength(0);
  });

  test('多个种公时给出多个候选，学院方案排在前面', () => {
    const mother = pet({ gameId: 100, gender: '母', nature: '固执', captureId: 'cap_academy' });
    const fatherA = pet({ gameId: 200, gender: '公', nature: '固执' });
    const fatherB = pet({ gameId: 200, gender: '公', nature: '固执' });
    const result = buildDemandPlacements({
      demands: [demand()],
      snapshots: [snap('账号A', 11, [mother, fatherA, fatherB], 'academy')],
      species,
    });

    const [placement] = result.accounts[0].placements;
    expect(placement.options).toHaveLength(2);
    expect(placement.options.every((option) => option.tier === 'academy')).toBe(true);
  });
});
