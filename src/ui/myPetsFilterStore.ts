import { useEffect, useState } from 'react';
import { DEFAULT_HEIGHT_RANGE } from '../domain/petFilters';
import type { HeightRange, SizeUnit } from '../domain/petFilters';

/**
 * 「精灵背包」页的筛选状态（进程内共享，纯内存）。
 *
 * 2026-10-04 用户拍板：筛选面板收起后设置要保留（不清后台），切页签 / 切视角
 * 都不丢。原来这些是 MyPets 组件内的 useState，页面组件一卸载就重置，
 * 所以提升成模块级 store（与 coverageFilterStore 同一套路）。
 */
type Listener = () => void;

export type EggGroupMatchMode = 'multi' | 'dual';

/**
 * 筛选值持久化（2026-10-05 筛选持久化专项，用户拍板）：
 * 重启后保留筛选标签、身高范围和蛋组匹配方式；面板展开态不持久。
 * Set 序列化成数组存储。
 *
 * 2026-10-29：种公视角收进种公阵列后，本 store 只保留「全部」页标签。
 */
const STORAGE_KEY = 'roco.myPetsFilter';
interface PersistedFilter {
  selected?: string[];
  heightRange?: unknown;
  /** 卡片显示方式（不参与筛选）：身高 / 体重共用百分比或数值 */
  sizeUnit?: unknown;
  /** 旧版身高 / 体重各自的显示开关，只用于迁移读取（2026-11-18 合并成一个） */
  heightUnit?: unknown;
  weightUnit?: unknown;
  bodyExtremeMode?: boolean;
  voiceExtremeMode?: boolean;
  eggGroupMatchMode?: unknown;
  /** 卡片网格列数（3 / 4，纯显示口径，不参与筛选） */
  columns?: unknown;
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
 * 只保留当前仍可选的标签。旧版本的账号标签会在读取时丢弃，避免留下不可见筛选。
 */
const LIVE_TAG_PREFIXES = ['gender', 'body', 'voice', 'nature', 'eggGroup', 'shiny'];

const isLiveTag = (tagId: string): boolean =>
  LIVE_TAG_PREFIXES.includes(tagId.split(':')[0] ?? '') &&
  tagId !== 'body:满身高' &&
  tagId !== 'body:零身高' &&
  tagId !== 'body:极限' &&
  tagId !== 'voice:极限' &&
  tagId !== 'voice:满声';

const readHeightRange = (value: unknown): HeightRange | null => {
  if (typeof value !== 'object' || value === null || !('min' in value) || !('max' in value)) {
    return null;
  }
  const { min, max } = value;
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min < 0 ||
    max > 100 ||
    min > max
  ) {
    return null;
  }
  return { min, max };
}

/**
 * localStorage 里的字段可能是任意脏值（用户手改 / 旧版本数据）。这里逐项校验，
 * 非数组或非字符串一律丢掉——模块顶层直接用 `new Set(...)`，脏值会抛错导致**整个应用白屏**。
 */
const toStringSet = <T extends string>(value: unknown): Set<T> =>
  new Set(Array.isArray(value) ? value.filter((item): item is T => typeof item === 'string') : []);

const legacySelected = toStringSet<string>(persisted.selected);
const normalizedSelected = new Set<string>();
for (const tagId of legacySelected) {
  if (tagId === 'body:极限') {
    normalizedSelected.add('body:满体重');
    normalizedSelected.add('body:零体重');
  } else if (tagId === 'voice:极限' || tagId === 'voice:满声') {
    normalizedSelected.add('voice:+100');
    normalizedSelected.add('voice:-100');
  } else if (isLiveTag(tagId)) {
    normalizedSelected.add(tagId);
  }
}

/** 全部视角：已选的标签 + 面板是否展开（展开态不持久化；2026-10-05 拍板默认打开） */
let selected: ReadonlySet<string> = normalizedSelected;
const hasLegacyZeroHeight = legacySelected.has('body:零身高');
const hasLegacyFullHeight = legacySelected.has('body:满身高');
let bodyExtremeMode =
  persisted.bodyExtremeMode === true ||
  legacySelected.has('body:极限') ||
  legacySelected.has('body:满体重') ||
  legacySelected.has('body:零体重');
let voiceExtremeMode =
  persisted.voiceExtremeMode === true ||
  legacySelected.has('voice:极限') ||
  legacySelected.has('voice:满声') ||
  legacySelected.has('voice:+100') ||
  legacySelected.has('voice:-100');
let eggGroupMatchMode: EggGroupMatchMode =
  persisted.eggGroupMatchMode === 'dual' ? 'dual' : 'multi';
let heightRange =
  readHeightRange(persisted.heightRange) ??
  (hasLegacyZeroHeight && !hasLegacyFullHeight
    ? { min: 0, max: 0 }
    : hasLegacyFullHeight && !hasLegacyZeroHeight
      ? { min: 100, max: 100 }
      : { ...DEFAULT_HEIGHT_RANGE });
let filtersOpen = true;

/**
 * 卡片身高 / 体重的显示单位（2026-11-18 用户口径：只是显示开关，**不参与筛选**）。
 * 2026-11-18 晚：身高和体重不再分开设置，共用一个「百分比 / 数值」开关。
 */
let sizeUnit: SizeUnit =
  persisted.sizeUnit === 'value' ||
  persisted.sizeUnit === 'percent'
    ? persisted.sizeUnit
    : persisted.heightUnit === 'value' || persisted.weightUnit === 'value'
      ? 'value'
      : 'percent';

/** 卡片网格列数（2026-11-18 用户口径：三列时卡片整体放大、一行铺满；默认四列）。 */
export type CardColumns = 3 | 4;
let columns: CardColumns = persisted.columns === 3 ? 3 : 4;

const listeners = new Set<Listener>();

const persist = (): void => {
  try {
    const value: PersistedFilter = { selected: [...selected] };
    if (heightRange.min !== 0 || heightRange.max !== 100) value.heightRange = heightRange;
    if (sizeUnit !== 'percent') value.sizeUnit = sizeUnit;
    if (bodyExtremeMode) value.bodyExtremeMode = true;
    if (voiceExtremeMode) value.voiceExtremeMode = true;
    if (eggGroupMatchMode === 'dual') value.eggGroupMatchMode = eggGroupMatchMode;
    if (columns === 3) value.columns = 3;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(value),
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

export function getMyPetsHeightRange(): HeightRange {
  return { ...heightRange };
}

export function getMyPetsEggGroupMatchMode(): EggGroupMatchMode {
  return eggGroupMatchMode;
}

export function setMyPetsEggGroupMatchMode(next: EggGroupMatchMode): void {
  eggGroupMatchMode = next;
  commit();
}

export function setMyPetsExtremeMedalMode(kind: 'body' | 'voice', enabled: boolean): void {
  if (kind === 'body') bodyExtremeMode = enabled;
  else voiceExtremeMode = enabled;
  commit();
}

export function setMyPetsSelected(next: ReadonlySet<string>): void {
  selected = next;
  commit();
}

export function setMyPetsHeightRange(next: HeightRange): void {
  const min = Math.max(0, Math.min(100, Number.isFinite(next.min) ? next.min : 0));
  const max = Math.max(0, Math.min(100, Number.isFinite(next.max) ? next.max : 100));
  heightRange = min <= max ? { min, max } : { min: max, max: min };
  commit();
}

export function setMyPetsFiltersOpen(next: boolean): void {
  filtersOpen = next;
  commit();
}

export function getMyPetsSizeUnit(): SizeUnit {
  return sizeUnit;
}

/** 卡片列数（3 / 4）：只改网格排布，不参与筛选。 */
export function getMyPetsColumns(): CardColumns {
  return columns;
}

export function setMyPetsColumns(next: CardColumns): void {
  if (columns === next) return;
  columns = next;
  commit();
}

/** 卡片显示开关：身高和体重一起切换百分比 / 数值，不参与筛选。 */
export function setMyPetsSizeUnit(next: SizeUnit): void {
  if (sizeUnit === next) return;
  sizeUnit = next;
  commit();
}

export function clearMyPetsFilters(): void {
  selected = new Set();
  heightRange = { ...DEFAULT_HEIGHT_RANGE };
  sizeUnit = 'percent';
  bodyExtremeMode = false;
  voiceExtremeMode = false;
  eggGroupMatchMode = 'multi';
  commit();
}

/** 精灵背包页的「重置」：清除筛选标签和身高范围。 */
export function clearInventoryFilters(): void {
  clearMyPetsFilters();
}

export function useMyPetsFilters(): {
  selected: ReadonlySet<string>;
  filtersOpen: boolean;
  heightRange: HeightRange;
  sizeUnit: SizeUnit;
  bodyExtremeMode: boolean;
  voiceExtremeMode: boolean;
  eggGroupMatchMode: EggGroupMatchMode;
  columns: CardColumns;
} {
  const [value, setValue] = useState({
    selected,
    filtersOpen,
    heightRange: { ...heightRange },
    sizeUnit,
    bodyExtremeMode,
    voiceExtremeMode,
    eggGroupMatchMode,
    columns,
  });

  useEffect(() => {
    const listener = () =>
      setValue({
        selected,
        filtersOpen,
        heightRange: { ...heightRange },
        sizeUnit,
        bodyExtremeMode,
        voiceExtremeMode,
        eggGroupMatchMode,
        columns,
      });
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
  heightRange = { ...DEFAULT_HEIGHT_RANGE };
  sizeUnit = 'percent';
  bodyExtremeMode = false;
  voiceExtremeMode = false;
  eggGroupMatchMode = 'multi';
  columns = 4;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
  commit();
}

