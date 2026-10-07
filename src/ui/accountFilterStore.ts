import { createModuleStore } from './createModuleStore';

/**
 * 账号筛选（进程内共享）。看板 / 覆盖度 / 换什么 / 我的精灵四页共用同一份，
 * 否则那几页的数字会「莫名变小」。
 *
 * 用**排除集**表示：空集 = 全部账号都选。这样不需要等数据加载完再初始化，
 * 也不会出现「新导入一个账号却没被选中」的问题。
 *
 * 2026-10-04 重构：样板（listeners/commit/useXxx）提取到 createModuleStore。
 */
const store = createModuleStore<ReadonlySet<string>>(new Set(), {
  persistKey: 'roco.excludedAccounts',
  // state 是 Set，JSON 直接序列化会变 {}，所以用数组存储（2026-10-05 筛选持久化专项）
  serialize: (state) => JSON.stringify([...state]),
  deserialize: (raw) => new Set(JSON.parse(raw) as string[]),
});

export function getExcludedAccounts(): ReadonlySet<string> {
  return store.get();
}

export function toggleAccount(name: string): void {
  const current = store.get();
  const next = new Set(current);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  store.set(next);
}

/** 全选 / 全不选：当前没有任何排除项时视为「全选」，点一下变成全不选。 */
export function toggleAllAccounts(accounts: string[]): void {
  const current = store.get();
  store.set(current.size === 0 ? new Set(accounts) : new Set());
}

/** 按选中账号过滤精灵。排除集为空时原样返回。 */
export function filterByAccounts<T extends { account: string }>(
  pets: T[],
  excludedAccounts: ReadonlySet<string>,
): T[] {
  if (excludedAccounts.size === 0) return pets;
  return pets.filter((pet) => !excludedAccounts.has(pet.account));
}

export function useAccountFilter(): {
  excluded: ReadonlySet<string>;
  toggleAccount: (name: string) => void;
  toggleAllAccounts: (accounts: string[]) => void;
} {
  return { excluded: store.use(), toggleAccount, toggleAllAccounts };
}
