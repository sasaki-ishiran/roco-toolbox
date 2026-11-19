/**
 * 「接单上窝」用的本机数据（2026-11-19）：
 * 两张假号（主号 / 小号）的背包精灵 + 一份家园场景快照。
 *
 * 为什么需要它：`?mock=group` 原本只假了小组接口，家园页仍然显示
 * 「这份数据里没有家园记录」，接单上窝也只剩一句「暂无接单」——
 * 因为上窝要两样本机数据：**背包里的母本 / 种公** 和 **家园里的窝与住户**。
 *
 * 精灵都按真实图鉴取（蛋组、推荐性格、名字、头像），并且成对造：
 * 每颗蛋配一只母本 + 一只同蛋组的公本，这样小组那边「我接下的单」
 * 在家园一定能排出「母本 × 种公」，不会一进来就是「排不上」。
 */
import type { AccountSnapshot } from '../../domain/parseBackup';
import type {
  HomeEgg,
  HomeNest,
  HomePair,
  HomeResident,
  HomeSnapshot,
  OwnedPet,
  SpeciesEntry,
} from '../../domain/types';
import { species as catalogSpecies } from '../../data/catalog';
import { MOCK_PET_INSTANCE, MOCK_PET_SPECIES } from './data';

const HOUR = 3_600_000;
/** 与家园配窝同一个口径：1 个学院小窝 + 10 个普通小窝。 */
const NEST_COUNT = 11;

const speciesByGameId = new Map(catalogSpecies.map((entry) => [entry.gameId, entry]));

const speciesOf = (gameId: number): SpeciesEntry => {
  const entry = speciesByGameId.get(gameId);
  if (!entry) throw new Error(`预览假数据引用了图鉴里没有的精灵 ${gameId}`);
  return entry;
};

const natureOf = (entry: SpeciesEntry): string =>
  entry.eggRecommendedNatures?.[0] ?? entry.recommendedNatures?.[0] ?? '胆小';

interface PetSeed {
  /** 背包实例号（`captureId` 的最后一段）。家园住户按它认「这只已经在家里」。 */
  instanceId: string;
  gameId: number;
  gender: '公' | '母';
}

/**
 * 三对亲本：小组假数据里的三张换蛋单各用一对。
 * 母本是那颗蛋的物种（火花 / 恶魔叮 / 地鼠），公本取同蛋组的另一种精灵。
 * 实例号与图鉴号都来自 `data.ts`，两边不会各写一份。
 */
export const MOCK_PET_SEEDS: readonly PetSeed[] = [
  { instanceId: MOCK_PET_INSTANCE.eggAMother, gameId: MOCK_PET_SPECIES.eggAMother, gender: '母' },
  { instanceId: MOCK_PET_INSTANCE.eggAFather, gameId: MOCK_PET_SPECIES.eggAFather, gender: '公' },
  { instanceId: MOCK_PET_INSTANCE.eggBMother, gameId: MOCK_PET_SPECIES.eggBMother, gender: '母' },
  { instanceId: MOCK_PET_INSTANCE.eggBFather, gameId: MOCK_PET_SPECIES.eggBFather, gender: '公' },
  { instanceId: MOCK_PET_INSTANCE.eggCMother, gameId: MOCK_PET_SPECIES.eggCMother, gender: '母' },
  { instanceId: MOCK_PET_INSTANCE.eggCFather, gameId: MOCK_PET_SPECIES.eggCFather, gender: '公' },
];

/** 小号带其中后两对（验证「两个号各自有窝、各自可上窝」）。 */
const SMALL_ACCOUNT_INSTANCES = new Set<string>([
  MOCK_PET_INSTANCE.eggCMother,
  MOCK_PET_INSTANCE.eggCFather,
]);

const captureIdOf = (gameUid: number, instanceId: string): string => `mock_${gameUid}_${instanceId}`;

function petOf(seed: PetSeed, accountName: string, gameUid: number): OwnedPet {
  const entry = speciesOf(seed.gameId);
  return {
    gameId: entry.gameId,
    name: entry.name,
    gender: seed.gender,
    nature: natureOf(entry),
    voiceDb: 100,
    medalBody: '大块头',
    weightPercent: 100,
    heightPercent: 100,
    isShiny: false,
    account: accountName,
    captureId: captureIdOf(gameUid, seed.instanceId),
    boxGroup: '盒子01',
    boxNumber: 1,
  };
}

const actorOf = (instanceId: string): string => `actor-${instanceId}`;

/**
 * 家园快照：只造页面上看得见的东西——11 个窝（1 个学院小窝）、一半的精灵住在里面、
 * 两对实际配对、地上 2 枚蛋。窝位坐标留空（真实抓包大多也是空的，界面按配对关系排）。
 */
function homeSnapshotOf(
  seeds: readonly PetSeed[],
  gameUid: number,
  capturedAt: string,
): HomeSnapshot {
  const nests: HomeNest[] = Array.from({ length: NEST_COUNT }, (_, index) => ({
    furnitureGuid: `nest-${index + 1}`,
    configId: 9000 + index,
    nestType: index === 0 ? 'academy' : 'ordinary',
    nestName: index === 0 ? '学院小窝' : `小窝${index + 1}`,
    residentIds: [],
    roomId: index === 0 ? 1 : 2,
    roomName: index === 0 ? '一楼大厅' : '二楼卧室',
  }));

  const residents: HomeResident[] = seeds.map((seed, index) => {
    const nest = nests[(index % (NEST_COUNT - 1)) + 1];
    nest.residentIds.push(seed.instanceId);
    const entry = speciesOf(seed.gameId);
    return {
      instanceId: seed.instanceId,
      baseId: String(seed.gameId),
      confId: seed.gameId,
      furnitureGuid: nest.furnitureGuid,
      actorId: actorOf(seed.instanceId),
      name: entry.name,
      nature: natureOf(entry),
      gender: seed.gender,
      nest: {
        furnitureGuid: nest.furnitureGuid,
        configId: nest.configId,
        nestType: nest.nestType,
        nestName: nest.nestName,
        roomId: nest.roomId,
        roomName: nest.roomName,
      },
    };
  });

  // 学院小窝放第一只母本：配窝卡片会把它画成绿底
  const academyNest = nests[0];
  const firstMother = seeds.findIndex((seed) => seed.gender === '母');
  if (firstMother >= 0) {
    const seed = seeds[firstMother];
    const resident = residents[firstMother];
    const oldNest = nests.find((nest) => nest.furnitureGuid === resident.furnitureGuid);
    if (oldNest) oldNest.residentIds = oldNest.residentIds.filter((id) => id !== seed.instanceId);
    academyNest.residentIds.push(seed.instanceId);
    resident.furnitureGuid = academyNest.furnitureGuid;
    resident.nest = {
      furnitureGuid: academyNest.furnitureGuid,
      configId: academyNest.configId,
      nestType: academyNest.nestType,
      nestName: academyNest.nestName,
      roomId: academyNest.roomId,
      roomName: academyNest.roomName,
    };
  }

  // 每只母本配一只同蛋组的公本：与家园页「配窝卡片」口径一致，避免出现「公本未知」
  const couples: HomePair[] = [];
  const usedFathers = new Set<string>();
  for (const seed of seeds) {
    if (seed.gender !== '母') continue;
    const mother = speciesOf(seed.gameId);
    const father = seeds.find((candidate) => {
      if (candidate.gender !== '公' || usedFathers.has(candidate.instanceId)) return false;
      const entry = speciesOf(candidate.gameId);
      return entry.eggGroups.some((group) => mother.eggGroups.includes(group));
    });
    if (!father) continue;
    usedFathers.add(father.instanceId);
    couples.push({
      femaleActorId: actorOf(seed.instanceId),
      maleActorIds: [actorOf(father.instanceId)],
    });
  }

  const sceneEggs: HomeEgg[] = couples.slice(0, 2).map((couple, index) => ({
    actorId: couple.femaleActorId,
    furnitureGuid: nests[1 + index]?.furnitureGuid ?? nests[0].furnitureGuid,
    npcConfigId: null,
  }));

  return {
    schemaVersion: 1,
    gameId: String(gameUid),
    capturedAt,
    homeLevel: 12,
    roomLevel: 3,
    residents,
    nests,
    layEggCouples: couples,
    sceneEggs,
    couplesStale: false,
    snapshotKind: 'full',
  };
}

/**
 * 两张假号的完整快照：主号带全部三对亲本，小号带后两对。
 * 只有主号有家园快照的差异不成立——两个号都造，切号时都能看。
 */
export function mockSnapshots(now = Date.now()): AccountSnapshot[] {
  const exportedAt = new Date(now - 2 * HOUR).toISOString();
  const capturedAt = new Date(now - 6 * HOUR).toISOString();

  const accounts = [
    { accountName: '主号', gameUid: 10001, seeds: MOCK_PET_SEEDS },
    {
      accountName: '小号',
      gameUid: 10002,
      seeds: MOCK_PET_SEEDS.filter((seed) => SMALL_ACCOUNT_INSTANCES.has(seed.instanceId)),
    },
  ];

  return accounts.map(({ accountName, gameUid, seeds }) => {
    const pets = seeds.map((seed) => petOf(seed, accountName, gameUid));
    return {
      accountName,
      gameId: gameUid,
      exportedAt,
      importedAt: exportedAt,
      eggInventoryComplete: false,
      pets,
      eggs: [],
      home: homeSnapshotOf(seeds, gameUid, capturedAt),
    } satisfies AccountSnapshot;
  });
}
