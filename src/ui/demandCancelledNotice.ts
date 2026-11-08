import { demandKeyOf, type CollectionDemand } from '../shared/collectionGroups';

/**
 * 承接人的「你接的需求已被取消」提示（R2-7-M05，2026-11-01 拍板选 A）。
 *
 * 需求方被移出小组时，服务端会连带删掉他所有未完成需求（status != 'done'），
 * 承接人这边没有任何通知，那条单会直接从列表消失。服务端不记取消原因（要改表），
 * 所以这里用本机记忆补一条提示：记住「我接过哪些单」，下次刷新时对不上的就是被取消的。
 *
 * 换设备看不到——这是 A 方案已经接受的代价；B 方案（服务端记原因）要改 schema。
 */
export interface DemandCancelledNotice {
  /** 本次新发现被取消的单数。 */
  count: number;
}

/**
 * 提示条副文案（B-4）：只说「需求已结束」，不猜原因。
 *
 * 除了「需求方离开小组」，发布人完成 / 删除计划也会物理删掉未结单需求，
 * 写死「需求方已离开小组」会在这条路径上误导承接人。
 */
export const DEMAND_CANCELLED_HINT = '需求已结束，不用再上窝了。';

export interface DemandCancelledState {
  /** 上次刷新时「我承接且未完成」的单（key 带 updatedAt，重发后会换新 key）。 */
  claimed: string[];
  /** 与 `claimed` 一一对应的「内容键」（不含 updatedAt）：结单会改 updatedAt，靠它认出「已完成」而不是取消。 */
  claimedContent?: string[];
  /** 已经提示过的取消，避免每次刷新都弹。 */
  notified: string[];
}

export interface DemandCancelledDecision {
  notice: DemandCancelledNotice | null;
  state: DemandCancelledState;
}

const KEY_PREFIX = 'roco.demandCancelled:';

/** 需求内容键（不含 updatedAt）：同一条需求改状态 / 重发后内容键不变。 */
export function cancelledDemandContentKey(groupId: string, demand: CollectionDemand): string {
  return `${groupId}|${demand.demanderAccountId}|${demandKeyOf(demand)}`;
}

/** 一条需求在「我接过的单」里的标识：需求方 + 需求内容 + 版本时间。 */
export function cancelledDemandKey(groupId: string, demand: CollectionDemand): string {
  return `${cancelledDemandContentKey(groupId, demand)}|${demand.updatedAt}`;
}

/**
 * 计算这次要不要提示「你接的 N 条需求已被取消」。
 *
 * - `state === null`：本机第一次记录这个组，只存当前承接的单，不提示；
 * - 消失且没出现在已完成里 → 算被取消；已完成的不算（结单后列表本来就不再下发 done 行）；
 * - **已完成用「内容键」比对**（2026-11-01 修）：结单会更新 `updatedAt`，只比整串 key 会把
 *   刚完成的一单误判成「需求方已离开小组」；
 * - 已提示过的 key 不再重复提示。
 */
export function resolveDemandCancelledNotice(
  demands: readonly CollectionDemand[],
  claimerAccountId: string,
  state: DemandCancelledState | null,
): DemandCancelledDecision {
  const mineClaimed = demands.filter(
    (demand) => demand.status === 'claimed' && demand.claimerAccountId === claimerAccountId,
  );
  const claimed = mineClaimed.map((demand) => cancelledDemandKey(demand.groupId, demand));
  const claimedContent = mineClaimed.map((demand) =>
    cancelledDemandContentKey(demand.groupId, demand),
  );
  const done = demands.filter(
    (demand) => demand.status === 'done' && demand.claimerAccountId === claimerAccountId,
  );
  const doneKeys = new Set(done.map((demand) => cancelledDemandKey(demand.groupId, demand)));
  const doneContentKeys = new Set(
    done.map((demand) => cancelledDemandContentKey(demand.groupId, demand)),
  );

  if (state == null) return { notice: null, state: { claimed, claimedContent, notified: [] } };

  const alive = new Set(claimed);
  const aliveContent = new Set(claimedContent);
  const notified = new Set(state.notified);
  const cancelled = state.claimed.filter((key, index) => {
    if (alive.has(key) || doneKeys.has(key) || notified.has(key)) return false;
    const content = state.claimedContent?.[index];
    // 完成时 updatedAt 变了：内容对得上就算结单；重发后内容对得上也算还在，只是换了版本
    return !(content && (doneContentKeys.has(content) || aliveContent.has(content)));
  });
  const next: DemandCancelledState = {
    claimed,
    claimedContent,
    notified: [...state.notified, ...cancelled],
  };
  return {
    notice: cancelled.length > 0 ? { count: cancelled.length } : null,
    state: next,
  };
}

function storageKey(accountId: string, groupId: string): string {
  return `${KEY_PREFIX}${accountId}:${groupId}`;
}

export function readDemandCancelledState(
  accountId: string | null,
  groupId: string | null,
): DemandCancelledState | null {
  if (!accountId || !groupId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(accountId, groupId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DemandCancelledState>;
    return {
      claimed: Array.isArray(parsed.claimed) ? parsed.claimed.filter((key) => typeof key === 'string') : [],
      claimedContent: Array.isArray(parsed.claimedContent)
        ? parsed.claimedContent.filter((key): key is string => typeof key === 'string')
        : undefined,
      notified: Array.isArray(parsed.notified)
        ? parsed.notified.filter((key) => typeof key === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

export function saveDemandCancelledState(
  accountId: string,
  groupId: string,
  state: DemandCancelledState,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(accountId, groupId), JSON.stringify(state));
  } catch {
    // 存不下只是下次还会再提示一次（同 demandCompletionReadStore.ts）
  }
}

/** 重置本机数据时清掉当前云身份的这些记忆（与 R2-2-M07 的清理口径一致）。 */
export function clearDemandCancelledState(accountId: string | null): void {
  if (!accountId || typeof window === 'undefined') return;
  const prefix = `${KEY_PREFIX}${accountId}:`;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // 清不掉只是那份记忆还留着
  }
}
