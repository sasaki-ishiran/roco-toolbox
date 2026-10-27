import type { AccountSnapshot } from '../../domain/parseBackup';
import { accountKeyOf } from '../../domain/parseBackup';
import type { OwnedPet, SpeciesEntry } from '../../domain/types';
import {
  ALL_MOTHERS_CRITERIA_ID,
  MOTHER_RESOURCE_SCHEMA_VERSION,
  type MotherGroupMember,
  type PublishedMotherResource,
  type SharedMotherAccount,
} from '../../shared/motherGroups';

/**
 * 多人母本共享的最小跨层 fixture。
 *
 * 两层 ID 刻意分开命名，避免测试里混淆：
 * - `snapshot(uid)` 的 **uid** = 游戏 UID（`accountKey = uid:<uid>`）；
 * - `mother(gameId)` 的 **gameId** = 精灵物种 ID（图鉴 `SpeciesEntry.gameId`）。
 *
 * 图鉴覆盖任务要求的最小集合：火花蛋 101、它的进化形态 102（eggGameId=101）、
 * 另一颗蛋 201、纯母物种的蛋 301、未发现组的蛋 401，以及无蛋血脉 501。
 */

/**
 * 「2 天前」：数据新鲜度按导出时间算（超过 7 天算旧），写死日期会随运行时间失效。
 */
export const FIXTURE_TIME = new Date(Date.now() - 2 * 86_400_000).toISOString();
export const FIXTURE_CATALOG_VERSION = 'test-v1';

const species = (patch: SpeciesEntry): SpeciesEntry => patch;

export const catalog: SpeciesEntry[] = [
  species({ key: 'fire', gameId: 101, name: '火花', number: '001', eggGameId: 101, eggGroups: [2], stage: 1 }),
  species({ key: 'fire-evolved', gameId: 102, name: '火神', number: '002', eggGameId: 101, eggGroups: [2], stage: 3 }),
  species({ key: 'water', gameId: 201, name: '水蓝蓝', number: '003', eggGameId: 201, eggGroups: [3], stage: 1 }),
  species({
    key: 'pure-mother',
    gameId: 301,
    name: '纯母种',
    number: '004',
    eggGameId: 301,
    eggGroups: [4],
    stage: 1,
    maleCapable: false,
    genderRatio: { male: 0, female: 10 },
  }),
  species({ key: 'undiscovered', gameId: 401, name: '未发现蛋', number: '005', eggGameId: 401, eggGroups: [1], stage: 1 }),
  species({ key: 'no-egg', gameId: 501, name: '无蛋血脉', number: '006', eggGameId: null, eggGroups: [5], stage: 3 }),
];

export const speciesNameOf = (gameId: number): string =>
  catalog.find((entry) => entry.gameId === gameId)?.name ?? `未知精灵${gameId}`;

/** 一只默认达标的母本（母 + 大块头 + 100dB）；用 `patch` 改成不达标或别的物种。 */
export function mother(gameId: number, patch: Partial<OwnedPet> = {}): OwnedPet {
  return {
    gameId,
    name: speciesNameOf(gameId),
    gender: '母',
    nature: '开朗',
    voiceDb: 100,
    medalBody: '大块头',
    isShiny: false,
    account: '同名',
    ...patch,
  };
}

/** 一个游戏账号快照；`accountKey` 由 `accountKeyOf()` 派生（与存储层一致）。 */
export function snapshot(
  uid: number,
  name: string,
  pets: OwnedPet[],
  exportedAt: string = FIXTURE_TIME,
): AccountSnapshot {
  return {
    accountName: name,
    gameId: uid,
    accountKey: accountKeyOf({ accountName: name, gameId: uid }),
    exportedAt,
    importedAt: FIXTURE_TIME,
    pets,
    eggs: [],
  };
}

export function sharedAccount(
  uid: number,
  eggGameIds: number[],
  patch: Partial<SharedMotherAccount> = {},
): SharedMotherAccount {
  const ids = [...new Set(eggGameIds)].sort((a, b) => a - b);
  return {
    accountKey: `uid:${uid}`,
    accountName: `账号${uid}`,
    sourceExportedAt: FIXTURE_TIME,
    eggGameIds: ids,
    ...patch,
  };
}

/** 一份已发布的摘要（默认一个共享账号）；`overrides.accounts` 可换成员/来源账号。 */
export function resourceWith(
  ids: number[],
  overrides: Partial<PublishedMotherResource> = {},
): PublishedMotherResource {
  return {
    schemaVersion: MOTHER_RESOURCE_SCHEMA_VERSION,
    criteriaId: ALL_MOTHERS_CRITERIA_ID,
    catalogVersion: FIXTURE_CATALOG_VERSION,
    accounts: [sharedAccount(9001, ids)],
    revision: 1,
    publishedAt: Date.parse(FIXTURE_TIME),
    ...overrides,
  };
}

export function member(
  id: string,
  resource: PublishedMotherResource | null,
): MotherGroupMember {
  return {
    accountId: id,
    displayName: id,
    joinedAt: Date.parse(FIXTURE_TIME),
    resourceRevision: resource?.revision ?? 0,
    resource,
  };
}
