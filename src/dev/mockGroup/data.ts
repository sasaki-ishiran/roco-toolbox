/**
 * 小组页「纯本地预览」假数据（2026-11-19）。
 *
 * 只在 `npm run dev` 且地址带 `?mock=group` 时启用，见 `src/dev/mockGroup/index.ts`。
 * 目的：小组页现在数据全在服务器（账号 + 邀请码 + 需求中心），本地开发时进不去、
 * 也看不到内容；这里用一份内存里的假后端，把同一套接口假出来，界面代码一行不改。
 *
 * 数据都从真实图鉴取（精灵 / 蛋 / 推荐性格 / 图鉴版本），所以卡片、头像、筛选项
 * 看起来和线上一致；但成员、需求、换蛋记录都是编的，**不能当成真实数据**。
 */
import { CATALOG_VERSION, species as catalogSpecies } from '../../data/catalog';
import { motherCriteriaIdOf } from '../../shared/collectionGroups';
import { motherResourceCriteriaIdOf, type PublishedMotherResource } from '../../shared/motherGroups';
import type {
  CollectionDemand,
  CollectionGroupDetail,
  CollectionGroupInfo,
  CollectionGroupMember,
  CollectionTaskRecord,
  GroupTargetConfig,
} from '../../shared/collectionGroups';
import type { EggRecord } from '../../shared/eggMatching';
import type {
  EggLine,
  EggWorkflowState,
  PublishedEggLine,
  WorkflowEgg,
  WorkflowTrade,
} from '../../shared/eggWorkflow';
import type { SpeciesEntry } from '../../domain/types';

export const MOCK_GROUP_ID = 'mock-weekend';
export const MOCK_ME = 'mock-me';
export const MOCK_LIN = 'mock-lin';
export const MOCK_YU = 'mock-yu';
export const MOCK_MO = 'mock-mo';
export const MOCK_INVITE = 'M0CK8888';

/**
 * 「接单上窝」用的固定亲本实例号（2026-11-19）。
 *
 * 换蛋单上的蛋线（`line` / `returnLine`）按实例号认亲本，家园页的「已在家园」也按它
 * 去家园住户里找；所以这些号必须和 `home.ts` 造出来的精灵一致，改一处要同步另一处。
 */
export const MOCK_PET_INSTANCE = {
  eggAMother: 'm1',
  eggAFather: 'f1',
  eggBMother: 'm2',
  eggBFather: 'f2',
  eggCMother: 'm3',
  eggCFather: 'f3',
} as const;

/**
 * 每个实例号对应的图鉴物种（同样要与 `home.ts` 一致）。
 * 母本是那颗蛋的物种；公本取同蛋组的另一种，保证「母本 × 种公」配得出来。
 */
export const MOCK_PET_SPECIES = {
  eggAMother: 3010, // 恶魔叮（恶魔组）
  eggAFather: 3026, // 绿草精灵（草组 + 恶魔组）
  eggBMother: 3003, // 火花（龙组 + 石组）
  eggBFather: 3014, // 阿米亚特（土组 + 石组）
  eggCMother: 3020, // 地鼠（陆上组）
  eggCFather: 3001, // 喵喵（陆上组 + 妖精组）
} as const;

const speciesOfGameId = (gameId: number): SpeciesEntry => {
  const entry = catalogSpecies.find((item) => item.gameId === gameId);
  if (!entry) throw new Error(`预览假数据引用了图鉴里没有的精灵 ${gameId}`);
  return entry;
};

const captureIdOf = (gameUid: number, instanceId: string): string => `mock_${gameUid}_${instanceId}`;

/** 多久以前「发布过」：让「已发布 / 需更新」的时间文案看起来正常。 */
const HOUR = 3_600_000;

/** 可孵蛋的图鉴物种（基础形态 + 至少一个蛋组）。 */
export const eggPool: SpeciesEntry[] = catalogSpecies.filter(
  (entry) => entry.eggGameId === entry.gameId && (entry.eggGroups?.length ?? 0) > 0,
);

const speciesAt = (index: number): SpeciesEntry => eggPool[index % eggPool.length];

const natureOf = (entry: SpeciesEntry): string =>
  entry.eggRecommendedNatures?.[0] ?? entry.recommendedNatures?.[0] ?? '胆小';

const iso = (at: number): string => new Date(at).toISOString();

/** 成员发布的母本摘要：只放蛋 ID + 空产线，口径与图鉴版本对齐当前客户端。 */
function motherResource(accountKey: string, accountName: string, eggGameIds: number[]): PublishedMotherResource {
  return {
    schemaVersion: 1,
    criteriaId: motherResourceCriteriaIdOf('perfect'),
    catalogVersion: CATALOG_VERSION,
    accounts: [
      {
        accountKey,
        accountName,
        sourceExportedAt: iso(Date.now() - 2 * HOUR),
        eggGameIds,
        lines: [],
      },
    ],
    revision: 3,
    publishedAt: Date.now() - HOUR,
  };
}

const member = (
  accountId: string,
  displayName: string,
  joinedAt: number,
  resource: PublishedMotherResource | null,
): CollectionGroupMember => ({
  accountId,
  displayName,
  joinedAt,
  resourceRevision: resource ? resource.revision : 0,
  resource,
  studResource: null,
});

export function createGroupDetail(now = Date.now()): CollectionGroupDetail {
  const group: CollectionGroupInfo = {
    id: MOCK_GROUP_ID,
    name: '周末互换',
    ownerAccountId: MOCK_LIN,
    createdAt: now - 30 * 24 * HOUR,
    groupType: 'mother',
    targetRevision: 2,
    resourceEpoch: 1,
    target: {
      kind: 'mother',
      criteriaId: motherCriteriaIdOf({
        mode: 'perfect',
        bodies: ['大块头', '小不点'],
        voices: ['+100', '-100'],
      }),
      mode: 'perfect',
      bodies: ['大块头', '小不点'],
      voices: ['+100', '-100'],
      catalogVersion: CATALOG_VERSION,
    } satisfies GroupTargetConfig,
  };

  // 三份发布摘要有交叠：所以「我缺的」里既有别人有的，也有「已发布成员均无」的。
  const linEggs = [0, 1, 2, 4, 5, 7, 9, 11].map((index) => speciesAt(index).gameId);
  const yuEggs = [2, 4, 5, 8, 10, 12, 14].map((index) => speciesAt(index).gameId);
  const myEggs = [4, 6, 8, 10, 11, 13, 15].map((index) => speciesAt(index).gameId);

  return {
    group,
    members: [
      member(MOCK_LIN, '林', now - 30 * 24 * HOUR, motherResource('uid:20001', '大号', linEggs)),
      member(MOCK_ME, '阿岚', now - 20 * 24 * HOUR, motherResource('uid:10001', '主号', myEggs)),
      member(MOCK_YU, '小鱼', now - 12 * 24 * HOUR, motherResource('uid:30001', '小号', yuEggs)),
      // 没发布过资源：用来验证「已发布成员均无，另 N 人待发布」的文案。
      member(MOCK_MO, '默默', now - 3 * 24 * HOUR, null),
    ],
  };
}

/** 需求中心（老接口形态）：给「完成回执 / 取消提示」这类逻辑用。 */
export function createDemandFeed(now = Date.now()): {
  demands: CollectionDemand[];
  completedCounts: Record<string, number>;
  myRecentCompleted: CollectionDemand[];
} {
  const eggA = speciesAt(4);
  const eggB = speciesAt(2);
  const base = {
    groupId: MOCK_GROUP_ID,
    gender: '母' as const,
    body: '大块头' as const,
    voice: '+100' as const,
    version: 1,
    createdAt: now - 2 * HOUR,
    updatedAt: now - 2 * HOUR,
  };
  const demands: CollectionDemand[] = [
    {
      ...base,
      demanderAccountId: MOCK_YU,
      eggGameId: eggB.gameId,
      nature: natureOf(eggB),
      status: 'open',
      claimerAccountId: null,
    },
    {
      ...base,
      demanderAccountId: MOCK_LIN,
      eggGameId: eggA.gameId,
      nature: natureOf(eggA),
      status: 'claimed',
      claimerAccountId: MOCK_ME,
      updatedAt: now - 40 * 60_000,
    },
  ];
  return { demands, completedCounts: { [MOCK_ME]: 2, [MOCK_LIN]: 1 }, myRecentCompleted: [] };
}

const eggRecord = (
  entry: SpeciesEntry,
  id: string,
  accountId: string,
  accountKey: string,
  listed: boolean,
  status: WorkflowEgg['status'] = 'available',
): WorkflowEgg => ({
  id,
  accountId,
  eggGameId: entry.gameId,
  nature: natureOf(entry),
  body: '大块头',
  voice: '+100',
  provenance: 'external',
  confidence: 'manual',
  kind: 'ordinary',
  status,
  gameAccountKey: accountKey,
  listed,
  accountName: accountId === MOCK_ME ? '主号' : accountId === MOCK_LIN ? '大号' : '小号',
});

/** 换蛋记录里存的是「纯蛋记录」：挂出状态和账号键只属于库存，不进交换单。 */
function eggRecordOf(egg: WorkflowEgg): EggRecord {
  const { listed, gameAccountKey, accountName, ...record } = egg;
  void listed;
  void gameAccountKey;
  void accountName;
  return { ...record, status: 'reserved' };
}

/** 换蛋广场 / 蛋仓 / 我的换蛋的初始状态。 */
export function createEggWorkflow(now = Date.now()): EggWorkflowState {
  const eggA = speciesAt(4);
  const eggB = speciesAt(2);
  const eggC = speciesAt(9);

  const eggs: WorkflowEgg[] = [
    eggRecord(eggA, 'egg-me-1', MOCK_ME, 'uid:10001', true),
    eggRecord(eggB, 'egg-me-2', MOCK_ME, 'uid:10001', true),
    eggRecord(eggC, 'egg-me-3', MOCK_ME, 'uid:10001', false),
    eggRecord(eggA, 'egg-lin-1', MOCK_LIN, 'uid:20001', true),
    eggRecord(eggC, 'egg-lin-2', MOCK_LIN, 'uid:20001', true),
    eggRecord(eggB, 'egg-yu-1', MOCK_YU, 'uid:30001', true),
    eggRecord(eggC, 'egg-yu-2', MOCK_YU, 'uid:30001', true),
  ];

  const demands: EggWorkflowState['demands'] = [
    {
      id: 'demand-me-1',
      groupId: MOCK_GROUP_ID,
      demanderAccountId: MOCK_ME,
      eggGameId: eggC.gameId,
      natures: [natureOf(eggC)],
      body: '大块头',
      voice: '+100',
      quantity: 1,
      fulfilled: 0,
      status: 'open',
    },
    {
      id: 'demand-lin-1',
      groupId: MOCK_GROUP_ID,
      demanderAccountId: MOCK_LIN,
      eggGameId: eggA.gameId,
      natures: [natureOf(eggA)],
      body: '大块头',
      voice: '+100',
      quantity: 2,
      fulfilled: 0,
      status: 'open',
    },
    {
      id: 'demand-yu-1',
      groupId: MOCK_GROUP_ID,
      demanderAccountId: MOCK_YU,
      eggGameId: eggB.gameId,
      natures: [natureOf(eggB)],
      body: '大块头',
      voice: '+100',
      quantity: 1,
      fulfilled: 0,
      status: 'open',
    },
  ];

  const line: PublishedEggLine = {
    id: 'line-lin-1',
    accountId: MOCK_LIN,
    eggGameId: eggC.gameId,
    nature: natureOf(eggC),
    body: '大块头',
    voice: '+100',
    gameAccountKey: 'uid:20001',
    motherId: 'lin-mother-1',
    fatherId: 'lin-father-1',
    natureChance: 0.5,
    parents: [
      {
        id: 'lin-mother-1',
        gameId: speciesAt(4).gameId,
        name: speciesAt(4).name,
        nature: natureOf(eggC),
        body: '大块头',
        voice: '+100',
      },
      {
        id: 'lin-father-1',
        gameId: speciesAt(6).gameId,
        name: speciesAt(6).name,
        nature: '保守',
        body: '',
        voice: '+100',
      },
    ],
  };

  /**
   * 蛋线：实例号直接指向 `home.ts` 造出来的那只精灵。
   * 家园页的 EggLineSummary 按 captureId 找亲本，找不到就只剩「亲本待更新」。
   */
  const lineOf = (
    egg: WorkflowEgg,
    gameAccountKey: string,
    gameUid: number,
    motherKey: keyof typeof MOCK_PET_INSTANCE,
    fatherKey: keyof typeof MOCK_PET_INSTANCE,
  ): EggLine => {
    const mother = speciesOfGameId(MOCK_PET_SPECIES[motherKey]);
    const father = speciesOfGameId(MOCK_PET_SPECIES[fatherKey]);
    const motherId = captureIdOf(gameUid, MOCK_PET_INSTANCE[motherKey]);
    const fatherId = captureIdOf(gameUid, MOCK_PET_INSTANCE[fatherKey]);
    return {
      eggGameId: egg.eggGameId,
      nature: egg.nature,
      body: egg.body,
      voice: egg.voice,
      gameAccountKey,
      motherId,
      fatherId,
      natureChance: 0.6,
      parents: [
        {
          id: motherId,
          gameId: mother.gameId,
          name: mother.name,
          nature: natureOf(mother),
          body: '大块头',
          voice: '+100',
        },
        {
          id: fatherId,
          gameId: father.gameId,
          name: father.name,
          nature: natureOf(father),
          body: '大块头',
          voice: '+100',
        },
      ],
    };
  };

  const trades: WorkflowTrade[] = [
    {
      id: 'trade-1',
      groupId: MOCK_GROUP_ID,
      demandId: 'demand-lin-1',
      supplierAccountId: MOCK_ME,
      demanderAccountId: MOCK_LIN,
      give: eggRecordOf(eggs[1]),
      receive: eggRecordOf(eggs[3]),
      type: 'spot',
      status: 'proposed',
      placed: false,
      createdAt: now - HOUR,
      initiatorAccountId: MOCK_ME,
    },
    /*
     * 下面三张是「接单上窝」的初始单（2026-11-19），分别覆盖家园页的三种行：
     * - trade-2：老单（`legacy`）、没选蛋线 → 家园按本机背包现算「母本 × 种公」；
     * - trade-3：我供蛋、蛋线已定 → 显示现成的父母与「已上窝」勾选；
     * - trade-4：对方供蛋、回我一颗 → 走 returnLine，勾选的是我这一侧。
     */
    {
      id: 'trade-2',
      groupId: MOCK_GROUP_ID,
      demandId: 'demand-yu-1',
      supplierAccountId: MOCK_ME,
      demanderAccountId: MOCK_YU,
      give: eggRecordOf(eggs[1]),
      receive: eggRecordOf(eggs[6]),
      type: 'custom',
      status: 'accepted',
      placed: false,
      legacy: true,
      createdAt: now - 5 * HOUR,
      initiatorAccountId: MOCK_YU,
    },
    {
      id: 'trade-3',
      groupId: MOCK_GROUP_ID,
      demandId: 'demand-lin-1',
      supplierAccountId: MOCK_ME,
      demanderAccountId: MOCK_LIN,
      give: eggRecordOf(eggs[0]),
      receive: eggRecordOf(eggs[3]),
      line: lineOf(eggs[0], 'uid:10001', 10001, 'eggAMother', 'eggAFather'),
      type: 'custom',
      status: 'accepted',
      placed: false,
      createdAt: now - 8 * HOUR,
      initiatorAccountId: MOCK_LIN,
    },
    {
      id: 'trade-4',
      groupId: MOCK_GROUP_ID,
      demandId: 'demand-me-1',
      returnDemandId: 'demand-lin-1',
      supplierAccountId: MOCK_LIN,
      demanderAccountId: MOCK_ME,
      give: eggRecordOf(eggs[5]),
      receive: eggRecordOf(eggs[2]),
      returnLine: lineOf(eggs[2], 'uid:10002', 10002, 'eggCMother', 'eggCFather'),
      type: 'custom',
      status: 'accepted',
      placed: false,
      returnPlaced: false,
      createdAt: now - 11 * HOUR,
      initiatorAccountId: MOCK_ME,
    },
  ];

  return { demands, eggs, trades, watermarks: {}, orders: {}, lines: [line] };
}

/** 任务卡：老接口还在轮询，给一组空的已确认任务即可。 */
export function createTasks(targetRevision: number): {
  targetRevision: number;
  confirmed: boolean;
  pendingMemberIds: string[];
  tasks: CollectionTaskRecord[];
} {
  return { targetRevision, confirmed: true, pendingMemberIds: [], tasks: [] };
}
