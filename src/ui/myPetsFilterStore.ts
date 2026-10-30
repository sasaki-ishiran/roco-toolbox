import { useEffect, useState } from 'react';

/**
 * 「精灵背包」页的筛选状态（进程内共享，纯内存）。
 *
 * 2026-10-04 用户拍板：筛选面板收起后设置要保留（不清后台），切页签 / 切视角
 * 都不丢。原来这些是 MyPets 组件内的 useState，页面组件一卸载就重置，
 * 所以提升成模块级 store（与 coverageFilterStore 同一套路）。
 */
type Listener = () => void;

/**
 * 筛选值持久化（2026-10-05 筛选持久化专项，用户拍板）：
 * 重启后「全部」页选的标签还在；面板展开态（filtersOpen）属 UI 态不持久。
 * Set 序列化成数组存储。
 *
 * 2026-10-29：种公视角收进种公阵列后，本 store 只保留「全部」页标签。
 */
const STORAGE_KEY = 'roco.myPetsFilter';
interface PersistedFilter {
  selected?: string[];
}

const readPersisted = (): PersistedFilter => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedFilter;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const persisted = readPersisted();

/**
 * localStorage 里的字段可能是任意脏值（用户手改 / 旧版本数据）。这里逐项校验，
 * 非数组或非字符串一律丢掉——模块顶层直接用 `new Set(...)`，脏值会抛错导致**整个应用白屏**。
 */
const toStringSet = <T extends string>(value: unknown): Set<T> =>
  new Set(Array.isArray(value) ? value.filter((item): item is T => typeof item === 'string') : []);

/** 全部视角：已选的标签 + 面板是否展开（展开态不持久化；2026-10-05 拍板默认打开） */
let selected: ReadonlySet<string> = toStringSet(persisted.selected);
let filtersOpen = true;

const listeners = new Set<Listener>();

const persist = (): void => {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selected: [...selected],
      }),
    );
  } catch {
    // 隐私模式写不了：本次只在内存生效
  }
};

const commit = (): void => {
  persist();
  for (const listener of listeners) listener();
};

export function getMyPetsSelected(): ReadonlySet<string> {
  return selected;
}

export function getMyPetsFiltersOpen(): boolean {
  return filtersOpen;
}

export function setMyPetsSelected(next: ReadonlySet<string>): void {
  selected = next;
  commit();
}

export function setMyPetsFiltersOpen(next: boolean): void {
  filtersOpen = next;
  commit();
}

export function clearMyPetsFilters(): void {
  selected = new Set();
  commit();
}

/** 精灵背包页的「重置」：只清本页标签（2026-10-24 重构任务 4）。 */
export function clearInventoryFilters(): void {
  selected = new Set();
  commit();
}

export function useMyPetsFilters(): {
  selected: ReadonlySet<string>;
  filtersOpen: boolean;
} {
  const [value, setValue] = useState({
    selected,
    filtersOpen,
  });

  useEffect(() => {
    const listener = () => setValue({ selected, filtersOpen });
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return value;
}

/** 供单元测试复位。 */
export function resetMyPetsFiltersForTest(): void {
  selected = new Set();
  filtersOpen = false;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
  commit();
}

