import type { PetGrade } from '../domain/petFilters';
import type { CollectionGroupType } from '../shared/collectionGroups';

/**
 * 全应用导航合同（2026-10-24 重构任务 1）。
 *
 * 目的：跳转要说明「去哪个页面的哪个任务」，而不是只切一个大页签——
 * 之前从看板点「求蛋」只 `setTab('swap')`，而 Swap 自己恢复上次的
 * 「换蛋清单 / 母本共享」子视图，用户可能又被带回小组。
 *
 * 这里只放纯函数：App 持有唯一状态，页面只发意图（`NavigationIntent`），
 * 不直接改别页内部状态。新视图记忆放内存，不扩展云同步键。
 */
export type AppPage = 'dashboard' | 'home' | 'collection' | 'groups' | 'profile';

export type CollectionLocation =
  | { kind: 'mothers'; status: 'missing' | 'collected' | 'plan'; eggGameId?: number }
  | { kind: 'studs'; view: 'coverage' | 'eggs'; groupId?: number }
  | { kind: 'inventory'; view: 'all' | 'stud'; motherGrade?: PetGrade };

export type ProfileSection = 'identity' | 'data' | 'sync';

export interface AppNavigation {
  page: AppPage;
  collection: CollectionLocation;
  profileSection: ProfileSection;
  returnToGroups: boolean;
  groupEggGameId?: number;
  /** 直达小组页时优先展示的收集类型（个人模式或兼容组）。 */
  groupType?: CollectionGroupType;
  /** 每次「精准直达」递增；页面据此重新聚焦（同一目标重复进入也要再聚焦） */
  focusRevision: number;
  /**
   * 已被页面消费的聚焦版本（成功后由 `consume-focus` 写入）。
   * 之后切走再回来不会被旧聚焦重新改列表。
   */
  consumedFocusRevision: number;
}

export type NavigationIntent =
  | { type: 'tab'; page: AppPage }
  | { type: 'open-collection'; location: CollectionLocation }
  | { type: 'open-profile'; section: ProfileSection; returnToGroups?: boolean }
  | { type: 'open-groups'; eggGameId?: number; groupType?: CollectionGroupType }
  | { type: 'consume-focus'; revision: number };

/** 初始收集落点 = 母本「未收集」（新人最常问「还缺什么」）。 */
export const DEFAULT_COLLECTION: CollectionLocation = { kind: 'mothers', status: 'missing' };

const BASE: AppNavigation = {
  page: 'dashboard',
  collection: DEFAULT_COLLECTION,
  profileSection: 'data',
  returnToGroups: false,
  focusRevision: 0,
  consumedFocusRevision: 0,
};

/**
 * 启动落点：旧 `roco.lastTab` / `roco.swapView` 决定新结构里的页面。
 *
 * - `import` / 空 / 未知值 → 我的 · 游戏数据（首启默认）
 * - `myPets` → 收集 · 精灵库 · 全部
 * - `coverage` → 收集 · 种公 · 覆盖矩阵
 * - `swap` + `sharing` → 小组；`swap` + `eggs`/空 → 小组 · 个人求种公
 *   （旧求蛋子页已迁入小组，不再落到收集页的空视图）
 */
export function initialNavigation(lastTab: string | null, swapView: string | null): AppNavigation {
  switch (lastTab) {
    case 'dashboard':
      return { ...BASE, page: 'dashboard' };
    case 'home':
      return { ...BASE, page: 'home' };
    case 'myPets':
      return { ...BASE, page: 'collection', collection: { kind: 'inventory', view: 'all' } };
    case 'coverage':
      return { ...BASE, page: 'collection', collection: { kind: 'studs', view: 'coverage' } };
    case 'swap':
      return swapView === 'sharing'
        ? { ...BASE, page: 'groups' }
        : { ...BASE, page: 'groups', groupType: 'stud' };
    default:
      return { ...BASE, page: 'profile', profileSection: 'data' };
  }
}

export function resolveNavigation(
  current: AppNavigation,
  intent: NavigationIntent,
): AppNavigation {
  switch (intent.type) {
    case 'tab':
      // 普通主导航只改 page：同一次会话里收集页的子视图、我的页的分区都保留。
      // 跨页的一次性标记（返回小组、蛋组聚焦）不能跟着漏到下一次手动切换。
      return {
        ...current,
        page: intent.page,
        returnToGroups: false,
        groupEggGameId: undefined,
        groupType: undefined,
      };
    case 'open-collection':
      return {
        ...current,
        page: 'collection',
        collection: intent.location,
        returnToGroups: false,
        groupEggGameId: undefined,
        groupType: undefined,
        focusRevision: current.focusRevision + 1,
      };
    case 'open-profile':
      return {
        ...current,
        page: 'profile',
        profileSection: intent.section,
        returnToGroups: intent.returnToGroups === true,
      };
    case 'open-groups':
      return {
        ...current,
        page: 'groups',
        groupEggGameId: intent.eggGameId,
        groupType: intent.groupType,
        returnToGroups: false,
        focusRevision: current.focusRevision + 1,
      };
    case 'consume-focus':
      // 只消费匹配当前版本的聚焦；晚到的旧消费不能清掉后来的新直达。
      return intent.revision === current.focusRevision
        ? { ...current, consumedFocusRevision: intent.revision }
        : current;
  }
}

/** 聚焦是否还没被消费（页面据此决定滚不滚）。 */
export function focusPending(state: AppNavigation): boolean {
  return state.focusRevision > state.consumedFocusRevision;
}

export interface LegacyLocation {
  lastTab: 'dashboard' | 'home' | 'myPets' | 'coverage' | 'swap' | 'import';
  swapView: 'eggs' | 'sharing';
}

/**
 * 新页面 → 旧键可理解的值。**不把四个新 page 字符串直接写进 `roco.lastTab`**，
 * 保证旧版安装升级、降级都不至于落到未知页签。
 */
export function legacyLocation(state: AppNavigation): LegacyLocation {
  if (state.page === 'groups') {
    // 旧版「交换蛋」页最接近个人求种公；母本组仍记成 sharing
    return { lastTab: 'swap', swapView: state.groupType === 'stud' ? 'eggs' : 'sharing' };
  }
  if (state.page === 'profile') return { lastTab: 'import', swapView: 'eggs' };
  if (state.page === 'home') return { lastTab: 'home', swapView: 'eggs' };
  if (state.page === 'dashboard') return { lastTab: 'dashboard', swapView: 'eggs' };
  if (state.collection.kind === 'studs') {
    return state.collection.view === 'eggs'
      ? { lastTab: 'swap', swapView: 'eggs' }
      : { lastTab: 'coverage', swapView: 'eggs' };
  }
  return { lastTab: 'myPets', swapView: 'eggs' };
}
