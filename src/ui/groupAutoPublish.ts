import {
  getCollectionDemands,
  getCollectionGroup,
  listCollectionGroups,
  publishCollectionResources,
} from '../api/collectionGroups';
import { isMotherGroupsApiError } from '../api/motherGroups';
import { readAccountId } from '../api/session';
import { diffMotherResources, buildMotherResource } from '../domain/motherResource';
import { hasStockForDemand } from '../domain/demandCriteria';
import { accountKeyOf, type AccountSnapshot } from '../domain/parseBackup';
import { speciesDisplayName } from '../domain/speciesName';
import { buildStudResource, diffStudResources } from '../domain/studResource';
import type { SpeciesEntry } from '../domain/types';
import {
  defaultMotherTarget,
  type CollectionDemand,
  type CollectionGroupDetail,
  type MotherTargetConfig,
  type StudTargetConfig,
} from '../shared/collectionGroups';
import type { MotherResourceDraft } from '../shared/motherGroups';
import type { StudResourceDraft } from '../shared/collectionGroups';
import { isGroupSharingOff } from './collectionGroupStore';

export interface AutoPublishInput {
  /** 导入后的完整本机快照 */
  snapshots: readonly AccountSnapshot[];
  species: readonly SpeciesEntry[];
  catalogVersion: string;
  /** 这次导入涉及的账号键：自动并进已发布的选号（手动取消过的旧账号不会被加回来） */
  touchedAccountKeys?: readonly string[];
}

/**
 * 导入后把本机资源**自动发布**到已加入的小组（2026-10-25 用户要求）。
 *
 * 背景：小组资源页只认「已发布摘要」。成员导入新精灵后忘了点「发布更新」，组里就永远看不到，
 * 看起来像「明明有却显示全无」。所以导入成功后直接同步，发布不再是用户必须记住的一步。
 *
 * 账号选择：沿用已发布的账号 + 这次导入涉及的账号；从没发布过则用全部本机账号。
 * 用户主动「停止共享」过的组（本机记忆）不会被自动发回去。
 * 单个组失败不影响其它组，也不影响导入本身。
 */
export function autoPublishGroups(input: AutoPublishInput): Promise<number> {
  if (inFlight) return inFlight;
  inFlight = run(input).finally(() => { inFlight = null; });
  return inFlight;
}

let inFlight: Promise<number> | null = null;

/**
 * 导入后顺带看一眼：有没有人接了我发布的需求（还没结单）。
 *
 * 只读、尽力而为；任何组失败都跳过。返回按组汇总的结果，供导入结果卡提醒「可以结单了」。
 */
export interface PendingDemandItem {
  eggGameId: number;
  eggName: string;
  /** 原始性格；空字符串 = 不挑。 */
  nature: string;
  gender: CollectionDemand['gender'];
  body: CollectionDemand['body'];
  voice: CollectionDemand['voice'];
  claimerAccountId: string;
  claimerName: string;
  version: number;
}

export interface PendingDemandClaim {
  groupId: string;
  groupName: string;
  accountId: string;
  count: number;
  claimers: string[];
  items: PendingDemandItem[];
}

export interface PendingClaimInput {
  /** 导入后的完整本机快照：用来确认「我真的已经拿到这颗蛋了」。 */
  snapshots?: readonly AccountSnapshot[];
  species?: readonly SpeciesEntry[];
}

export async function collectPendingDemandClaims(
  input: PendingClaimInput = {},
): Promise<PendingDemandClaim[]> {
  const accountId = readAccountId();
  if (!accountId) return [];
  let groups: Awaited<ReturnType<typeof listCollectionGroups>>;
  try {
    groups = await listCollectionGroups();
  } catch {
    return [];
  }

  // 只有本机确实已经有一只完全匹配的个体，才提示可以结单（避免还没收到就被催）
  const eggNameOf = new Map<number, string>();
  for (const entry of input.species ?? []) {
    if (entry.eggGameId != null && entry.eggGameId === entry.gameId) {
      eggNameOf.set(entry.gameId, speciesDisplayName(entry, entry.name));
    }
  }
  const requireOwned = Boolean(input.snapshots && input.species);

  const claims: PendingDemandClaim[] = [];
  for (const summary of groups) {
    if (summary.groupType !== 'mother') continue;
    try {
      const [detail, demands] = await Promise.all([
        getCollectionGroup(summary.id),
        getCollectionDemands(summary.id),
      ]);
      const nameOf = (id: string): string =>
        detail.members.find((member) => member.accountId === id)?.displayName ?? id.slice(0, 6);
      const items: PendingDemandItem[] = [];
      for (const demand of demands) {
        if (demand.demanderAccountId !== accountId || demand.status !== 'claimed') continue;
        if (!demand.claimerAccountId) continue;
        if (
          requireOwned &&
          input.snapshots &&
          input.species &&
          !hasStockForDemand(input.snapshots, demand, input.species)
        ) {
          continue;
        }
        items.push({
          eggGameId: demand.eggGameId,
          eggName: eggNameOf.get(demand.eggGameId) ?? `蛋 ${demand.eggGameId}`,
          nature: demand.nature,
          gender: demand.gender,
          body: demand.body,
          voice: demand.voice,
          claimerAccountId: demand.claimerAccountId,
          claimerName: nameOf(demand.claimerAccountId),
          version: demand.version,
        });
      }
      if (items.length === 0) continue;
      claims.push({
        groupId: summary.id,
        groupName: summary.name,
        accountId,
        count: items.length,
        claimers: [...new Set(items.map((item) => item.claimerName))],
        items,
      });
    } catch {
      // 单个组读不到就跳过，不影响其它组与导入本身
    }
  }
  return claims;
}


async function run(input: AutoPublishInput): Promise<number> {
  const accountId = readAccountId();
  if (!accountId || input.snapshots.length === 0) return 0;

  let groups: Awaited<ReturnType<typeof listCollectionGroups>>;
  try {
    groups = await listCollectionGroups();
  } catch {
    return 0;
  }

  const localKeys = input.snapshots.map((snapshot) => snapshot.accountKey ?? accountKeyOf(snapshot));
  const localKeySet = new Set(localKeys);
  const touched = (input.touchedAccountKeys ?? []).filter((key) => localKeySet.has(key));

  let published = 0;
  for (const summary of groups) {
    if (isGroupSharingOff(accountId, summary.id)) continue;
    try {
      if (await syncGroup(accountId, summary.id, input, localKeys, touched)) published += 1;
    } catch {
      // 单个组失败（网络 / 权限 / 冲突重试后仍失败）不打断其它组
    }
  }
  return published;
}

async function syncGroup(
  accountId: string,
  groupId: string,
  input: AutoPublishInput,
  localKeys: readonly string[],
  touched: readonly string[],
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const detail = await getCollectionGroup(groupId);
    const me = detail.members.find((member) => member.accountId === accountId);
    if (!me) return false;

    const publishedKeys = me.resource?.accounts.map((account) => account.accountKey)
      ?? me.studResource?.accounts.map((account) => account.accountKey)
      ?? [];
    const baseKeys = publishedKeys.length > 0 ? publishedKeys : localKeys;
    const keys = [...new Set([...baseKeys, ...touched])].filter((key) => localKeys.includes(key));
    if (keys.length === 0) return false;

    const resource = buildResource(detail, input, keys);
    if (!resource) return false;
    if (isUnchanged(me, resource)) return false;

    try {
      await publishCollectionResources(groupId, {
        baseRevision: me.resourceRevision,
        baseTargetRevision: detail.group.targetRevision,
        resource,
      });
      return true;
    } catch (failure) {
      // 另一台设备刚写过：重新拉一次最新修订再试
      if (attempt === 0 && isMotherGroupsApiError(failure) && failure.status === 409) continue;
      throw failure;
    }
  }
  return false;
}

function buildResource(
  detail: CollectionGroupDetail,
  input: AutoPublishInput,
  keys: readonly string[],
): MotherResourceDraft | StudResourceDraft | null {
  if (detail.group.groupType === 'stud') {
    const target = detail.group.target;
    if (target?.kind !== 'stud' || target.slots.length === 0) return null;
    return buildStudResource({
      snapshots: input.snapshots,
      selectedAccountKeys: keys,
      species: input.species,
      catalogVersion: input.catalogVersion,
      target: target as StudTargetConfig,
      targetRevision: detail.group.targetRevision,
    });
  }
  const target = (detail.group.target?.kind === 'mother'
    ? detail.group.target
    : defaultMotherTarget(input.catalogVersion)) as MotherTargetConfig;
  return buildMotherResource({
    snapshots: input.snapshots,
    selectedAccountKeys: keys,
    species: input.species,
    catalogVersion: input.catalogVersion,
    // criteriaId 由 mode 派生（v3），不再单独传。
    mode: target.mode,
  });
}

function isUnchanged(
  me: CollectionGroupDetail['members'][number],
  resource: MotherResourceDraft | StudResourceDraft,
): boolean {
  if ('kind' in resource && resource.kind === 'stud') {
    const previous = me.studResource;
    return previous != null &&
      previous.catalogVersion === resource.catalogVersion &&
      previous.mode === resource.mode &&
      previous.targetId === resource.targetId &&
      previous.targetRevision === resource.targetRevision &&
      diffStudResources(previous, resource).unchanged;
  }
  const previous = me.resource;
  const next = resource as MotherResourceDraft;
  return previous != null &&
    previous.catalogVersion === next.catalogVersion &&
    previous.criteriaId === next.criteriaId &&
    diffMotherResources(previous, next).unchanged;
}
