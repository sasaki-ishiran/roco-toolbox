import type { OwnedPet, SpeciesEntry } from './types';
import { isBreedableGroup } from './eggs';
import { speciesDisplayName } from './speciesName';

export type TagKind = 'account' | 'body' | 'voice' | 'gender' | 'shiny' | 'eggGroup' | 'nature';

export interface PetTag {
  id: string;
  kind: TagKind;
  label: string;
}

export interface BuildResult {
  tags: PetTag[]; // 所有可选标签（含每种标签的命中数）
  tagCounts: Record<string, number>; // 标签 id → 命中精灵数（不受当前筛选影响）
  index: Record<string, number[]>; // 标签 id → 精灵在 owned 数组中的下标
}

const BIG_BODY = '大块头';
const SMALL_BODY = '小不点';

/**
 * 目标模式（用户 2026-10-03 确认，全局生效）：
 * - `perfect` 追满分：`|dB| == 100`（+100 婉转声 / -100 粗嗓门）才算目标；
 * - `medal` 追双牌：拿到声音牌即可——`|dB| >= 96`（见 docs/domain/数据字段说明.md）。
 * 两种模式都要求体型牌（大块头 / 小不点）。
 */
export type TargetMode = 'perfect' | 'medal';

export const TARGET_MODE_LABELS: Record<TargetMode, string> = {
  perfect: '追满分',
  medal: '追双牌',
};

const PERFECT_DB = 100;
const MEDAL_DB = 96;

/**
 * 4 个档位，id 用上游的叫法（大婉 / 小婉 / 大粗 / 小粗）。
 * 展示时按模式加前缀：追满分 → 「满分大婉」，追双牌 → 「大婉」。
 *
 * - `大婉`：大块头 + 婉转声；`小婉`：小不点 + 婉转声；
 * - `大粗` / `小粗`：大块头 / 小不点 + 粗嗓门。
 *
 * 体型与声音方向是两类独立目标，所以 4 档各自算一类。
 */
export type PetGrade = '大婉' | '小婉' | '大粗' | '小粗';

/** 每个档位对应的体型（判定用）。 */
export const GRADE_BODY: Record<PetGrade, string> = {
  大婉: BIG_BODY,
  小婉: SMALL_BODY,
  大粗: BIG_BODY,
  小粗: SMALL_BODY,
};

/** 档位在界面上的写法：追满分带「满分」前缀，追双牌直接用简名。 */
export function gradeLabel(grade: PetGrade, mode: TargetMode): string {
  return mode === 'perfect' ? `满分${grade}` : grade;
}

/** 母本分级：落在 4 档之一，或「其他」（不够档）。 */
export type MotherClass = PetGrade | '其他';

/** 等级高低（用于一条链里挑代表母本）。 */
const MOTHER_CLASS_RANK: Record<MotherClass, number> = {
  大婉: 0,
  小婉: 1,
  大粗: 2,
  小粗: 3,
  其他: 4,
};

/** 母本等级从高到低；用于在一堆母本里挑代表。 */
export const MOTHER_CLASS_ORDER: MotherClass[] = ['大婉', '小婉', '大粗', '小粗', '其他'];

/** 返回两者中更好的那一档（用于挑代表母本）。 */
export function betterMotherClass(
  a: MotherClass | null,
  b: MotherClass | null,
): MotherClass | null {
  if (a === null) return b;
  if (b === null) return a;
  return MOTHER_CLASS_RANK[a] <= MOTHER_CLASS_RANK[b] ? a : b;
}

/** 档位判定，与性别无关。不够档返回 null；`mode` 决定阈值（100 / 96）。 */
export function classifyGrade(pet: OwnedPet, mode: TargetMode): PetGrade | null {
  const threshold = mode === 'perfect' ? PERFECT_DB : MEDAL_DB;
  if (Math.abs(pet.voiceDb) < threshold) return null;
  const big = pet.medalBody === BIG_BODY;
  const small = pet.medalBody === SMALL_BODY;
  if (!big && !small) return null;
  const sweet = pet.voiceDb > 0;
  if (big) return sweet ? '大婉' : '大粗';
  return sweet ? '小婉' : '小粗';
}

export function classifyMother(pet: OwnedPet, mode: TargetMode): MotherClass | null {
  if (pet.gender !== '母') return null;
  return classifyGrade(pet, mode) ?? '其他';
}

// 固定标签全集：命中数为 0 时也保留在 tags 里
const FIXED_TAGS: Array<{ id: string; kind: TagKind; label: string }> = [
  { id: 'body:大块头', kind: 'body', label: '大块头' },
  { id: 'body:小不点', kind: 'body', label: '小不点' },
  { id: 'voice:婉转声', kind: 'voice', label: '婉转声' },
  // 满分按方向拆开（2026-10-04 用户拍板）：+100 婉转声满分 / -100 粗嗓门满分
  { id: 'voice:+100', kind: 'voice', label: '+100' },
  { id: 'voice:-100', kind: 'voice', label: '-100' },
  { id: 'voice:粗嗓门', kind: 'voice', label: '粗嗓门' },
  { id: 'gender:公', kind: 'gender', label: '公' },
  { id: 'gender:母', kind: 'gender', label: '母' },
  { id: 'shiny:异色', kind: 'shiny', label: '异色' },
];

const KIND_ORDER: Record<TagKind, number> = {
  account: 0,
  body: 1,
  voice: 2,
  gender: 3,
  shiny: 4,
  eggGroup: 5,
  nature: 6,
};

/**
 * 声音选项匹配（2026-10-05 修正，与抓包解析器 core.js 口径一致：
 * 婉转声 ≥96、粗嗓门 ≤-96，满分 ±100 单独一档）。
 * 各筛选器共用这一个函数，避免三处复制逻辑又改漏。
 */
export function matchesVoiceOption(voiceDb: number, option: string): boolean {
  switch (option) {
    case '+100':
      return voiceDb === 100;
    case '-100':
      return voiceDb === -100;
    case '婉转声':
      return voiceDb >= 96 && voiceDb <= 100;
    case '粗嗓门':
      return voiceDb <= -96;
    default:
      return false;
  }
}

export function buildTagIndex(
  owned: OwnedPet[],
  speciesByGameId: Map<number, SpeciesEntry>,
  eggGroupNames: Record<number, string>,
): BuildResult {
  const index: Record<string, number[]> = {};
  const tagMeta = new Map<string, PetTag>();

  for (const fixed of FIXED_TAGS) {
    index[fixed.id] = [];
    tagMeta.set(fixed.id, { id: fixed.id, kind: fixed.kind, label: fixed.label });
  }

  const addTag = (id: string, kind: TagKind, label: string, petIndex: number) => {
    if (!index[id]) index[id] = [];
    index[id].push(petIndex);
    if (!tagMeta.has(id)) tagMeta.set(id, { id, kind, label });
  };

  owned.forEach((pet, i) => {
    addTag(`account:${pet.account}`, 'account', pet.account, i);

    if (pet.medalBody === '大块头') addTag('body:大块头', 'body', '大块头', i);
    else if (pet.medalBody === '小不点') addTag('body:小不点', 'body', '小不点', i);

    if (matchesVoiceOption(pet.voiceDb, '婉转声')) {
      addTag('voice:婉转声', 'voice', '婉转声', i);
    }
    // 满分按方向拆开（2026-10-04 用户拍板）：+100 / -100；粗嗓门 = 负向低音（≤-96，2026-10-05 修正过宽）
    if (matchesVoiceOption(pet.voiceDb, '+100')) addTag('voice:+100', 'voice', '+100', i);
    if (matchesVoiceOption(pet.voiceDb, '-100')) addTag('voice:-100', 'voice', '-100', i);
    if (matchesVoiceOption(pet.voiceDb, '粗嗓门')) addTag('voice:粗嗓门', 'voice', '粗嗓门', i);

    // 性别「未知」不再生成标签（2026-10-04 用户拍板去掉）
    if (pet.gender !== '未知') addTag(`gender:${pet.gender}`, 'gender', pet.gender, i);

    // 稀有度（2026-10-05 增加炫彩，用户拍板直接从导入内容读 isColorful）：
    // 异色 + 炫彩 → 「异色炫彩」一个标签，不再同时显示两个
    const shinyKind = pet.isShiny && pet.isColorful ? '异色炫彩' : pet.isColorful ? '炫彩' : pet.isShiny ? '异色' : null;
    if (shinyKind) addTag(`shiny:${shinyKind}`, 'shiny', shinyKind, i);

    const species = speciesByGameId.get(pet.gameId);
    if (species) {
      for (const group of species.eggGroups) {
        if (isBreedableGroup(group)) {
          addTag(`eggGroup:${group}`, 'eggGroup', eggGroupNames[group] ?? `蛋组${group}`, i);
        }
      }
    }

    addTag(`nature:${pet.nature}`, 'nature', pet.nature, i);
  });

  const tags = [...tagMeta.values()].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id),
  );
  const tagCounts: Record<string, number> = {};
  for (const tag of tags) tagCounts[tag.id] = (index[tag.id] ?? []).length;

  return { tags, tagCounts, index };
}

const kindOfTag = (tagId: string): string => tagId.split(':')[0];

function unionOf(index: BuildResult['index'], tagIds: string[]): Set<number> {
  const union = new Set<number>();
  for (const id of tagIds) for (const i of index[id] ?? []) union.add(i);
  return union;
}

function groupSelectedByKind(selectedTagIds: string[]): Map<string, string[]> {
  const byKind = new Map<string, string[]>();
  for (const id of selectedTagIds) {
    const kind = kindOfTag(id);
    const list = byKind.get(kind) ?? [];
    list.push(id);
    byKind.set(kind, list);
  }
  return byKind;
}

/**
 * 叠加筛选：**同一个类别的多个标签取并集**（例如同时选四个账号＝看这四个账号的合集），
 * 不同类别之间取交集（例如「大块头 + 满分 + 公」= 三个条件都满足）。
 * 未选任何标签时返回空数组。
 */
export function filterByTags(index: BuildResult['index'], selectedTagIds: string[]): number[] {
  if (selectedTagIds.length === 0) return [];
  const kindUnions = [...groupSelectedByKind(selectedTagIds).values()].map((ids) => unionOf(index, ids));
  const [first, ...rest] = kindUnions;
  return [...first].filter((i) => rest.every((set) => set.has(i))).sort((a, b) => a - b);
}

/**
 * 分面计数（动态标签数量）：某个标签的计数 = 在"其他类别已选条件"下命中该标签的精灵数。
 * 同类已选**不计入**，这样在同一类里切换或多选时仍能看到各选项的数量。
 * 计数为 0 的标签由界面置灰。
 */
export function computeFacetCounts(
  index: BuildResult['index'],
  selectedTagIds: string[],
): Record<string, number> {
  const byKind = groupSelectedByKind(selectedTagIds);
  const baseCache = new Map<string, Set<number> | null>();

  const baseFor = (excludeKind: string): Set<number> | null => {
    if (baseCache.has(excludeKind)) return baseCache.get(excludeKind) ?? null;
    let base: Set<number> | null = null;
    for (const [kind, ids] of byKind) {
      if (kind === excludeKind) continue;
      const union = unionOf(index, ids);
      base = base === null ? union : new Set<number>([...base].filter((i: number) => union.has(i)));
    }
    baseCache.set(excludeKind, base);
    return base;
  };

  const counts: Record<string, number> = {};
  for (const tagId of Object.keys(index)) {
    const base = baseFor(kindOfTag(tagId));
    const list = index[tagId] ?? [];
    counts[tagId] = base === null ? list.length : list.filter((i) => base.has(i)).length;
  }
  return counts;
}

export type PetView = 'all' | 'stud' | 'mother';

/**
 * 一只精灵/一条链所属的进化链键（与 `buildChainSearchIndex` 的键同一口径）：
 * 有 evolutionId 用它，否则退回物种 key，再退回 gameId（图鉴未收录的精灵）。
 */
export const chainKeyOf = (entry: SpeciesEntry | undefined, gameId: number): string =>
  entry?.evolutionId ?? entry?.key ?? String(gameId);

/**
 * 进化链搜索索引（2026-10-05 用户拍板）：链 → 该链**全部成员**的可搜索文本
 * （每个成员的官方显示名 + 物种名 + 图鉴号，小写空格连接）。
 *
 * 为什么要有它：有些精灵进化后名称变化很大（火花 → 焰火 → 火神），
 * 按当前视角里的那一个名字搜不到同链的其它形态。搜链上任一成员名/图鉴号，
 * 都应命中整条链上的精灵。三个页面的搜索（全部 / 种公 / 母本）共用这一份索引。
 */
export function buildChainSearchIndex(catalogSpecies: SpeciesEntry[]): Map<string, string> {
  const byChain = new Map<string, Set<string>>();
  for (const entry of catalogSpecies) {
    const key = chainKeyOf(entry, entry.gameId);
    const set = byChain.get(key) ?? new Set<string>();
    set.add(speciesDisplayName(entry, entry.name));
    if (entry.name) set.add(entry.name);
    if (entry.number) set.add(entry.number);
    byChain.set(key, set);
  }
  return new Map(
    [...byChain.entries()].map(([key, set]) => [key, [...set].join(' ').toLowerCase()]),
  );
}

/**
 * **蛋搜索索引**（2026-10-05）：`egg:<蛋物种 gameId>` → 归属这颗蛋的**全部形态名 + 图鉴号**，
 * 供母本清单的搜索用（搜「火神」能命中「火花」那颗蛋，因为它也归这颗蛋）。
 * 与 `buildChainSearchIndex` 的区别：那个按进化形态链（搜火神命中火花），
 * 这个按蛋（把古卷执政官/海盔虫_磨损等分支形态也算进同一颗蛋）。
 */
export function buildEggSearchIndex(catalogSpecies: SpeciesEntry[]): Map<string, string> {
  const byEgg = new Map<string, Set<string>>();
  for (const entry of catalogSpecies) {
    if (entry.eggGameId == null) continue;
    const key = `egg:${entry.eggGameId}`;
    const set = byEgg.get(key) ?? new Set<string>();
    set.add(speciesDisplayName(entry, entry.name));
    if (entry.name) set.add(entry.name);
    if (entry.number) set.add(entry.number);
    byEgg.set(key, set);
  }
  return new Map(
    [...byEgg.entries()].map(([key, set]) => [key, [...set].join(' ').toLowerCase()]),
  );
}

export interface MotherGroup {
  /**
   * 分组键：`egg:<蛋物种 gameId>`。
   * 母本清单的单位是**一颗蛋**（不是一个进化形态）——「能孵蛋获得」与「有以它命名的蛋」
   * 是两回事：火神没有自己的蛋，但孵火花的蛋再进化就能得到它，所以归到火花那颗蛋上。
   */
  chainKey: string;
  /** 蛋物种的 gameId（`chainKey` 去掉 `egg:` 前缀）：用来查这条血脉的推荐性格 */
  eggGameId: number;
  collected: boolean;
  /** 该蛋是否有满分档位母本（4 档之一）—— 只有这种母本才配得上满分种公 */
  quality: boolean;
  /** 该蛋最好的一只母本的等级；没有母本时为 null */
  motherClass: MotherClass | null;
  /** 蛋物种的显示名（蛋名去掉「的蛋」，如「火花」「雪绒鸟_春天的样子」） */
  formLabel: string;
  /** 图鉴号，未收集清单里用它定位图鉴 */
  number: string;
  /** 该蛋物种的可孵蛋组（未收集清单要按它分批去抓，所以必须带出来） */
  eggGroups: number[];
  /** 归属这颗蛋的、已拥有的精灵下标（含没进化的其它形态，如持有火神也算火花的母本） */
  memberIndexes: number[];
}

/** 是否落在 4 档里（「其他」不算）。 */
export function isPetGrade(value: MotherClass | null): value is PetGrade {
  return value !== null && value !== '其他';
}

/**
 * 「计划收集」里**已达成**的蛋：用户挑了它，而且这个蛋已有合格母本（当前模式口径）。
 * 达成状态实时算，不额外存——导入新数据后自动反映。
 */
export function plannedAchievements(groups: MotherGroup[], plan: readonly string[]): MotherGroup[] {
  const planned = new Set(plan);
  return groups.filter((group) => planned.has(group.chainKey) && group.quality);
}

const eggKeyOf = (eggGameId: number): string => `egg:${eggGameId}`;

/**
 * 按**蛋**分组母本（2026-10-05 用户拍板：分组单位从「进化链」改成「蛋」）。
 *
 * 一颗蛋 = 一个收集目标（蛋名 = `{物种名}的蛋`）；归属它的精灵包括所有「孵这颗蛋再进化
 * 能得到的形态」（火神/焰火 → 火花；古卷执政官/古卷匣魔像 → 书魔虫；海盔虫_磨损的样子
 * → 海盔虫_本来的样子），由图鉴烘焙的 `SpeciesEntry.eggGameId` 决定。
 * `eggGameId == null` 的精灵（首领形态等无蛋血脉）不参与母本清单。
 *
 * 传入 `catalogSpecies` 时以**图鉴里的蛋物种**为全集（完全没拥有的蛋也会出现在未收集里）；
 * 不传时退化为按「拥有的精灵」反推（仅供单元测试用）。
 * 排序：优质母本（大块头+满分）→ 有母本 → 未收集。
 */
export function groupMothersByEgg(
  owned: OwnedPet[],
  speciesByGameId: Map<number, SpeciesEntry>,
  catalogSpecies: SpeciesEntry[] = [],
  mode: TargetMode,
): MotherGroup[] {
  const groups = new Map<
    string,
    {
      eggGameId: number;
      species?: SpeciesEntry;
      memberIndexes: number[];
      hasMother: boolean;
      bestClass: MotherClass | null;
    }
  >();

  const ensure = (eggGameId: number, species?: SpeciesEntry) => {
    const key = eggKeyOf(eggGameId);
    let group = groups.get(key);
    if (!group) {
      group = { eggGameId, species, memberIndexes: [], hasMother: false, bestClass: null };
      groups.set(key, group);
    } else if (species && !group.species) {
      group.species = species;
    }
    return group;
  };

  const restrictToCatalog = catalogSpecies.length > 0;
  if (restrictToCatalog) {
    for (const entry of catalogSpecies) {
      // 只以「蛋物种」本身为全集（一个蛋物种一行）；归属它的其它形态靠成员下标带出来
      if (entry.eggGameId == null || entry.eggGameId !== entry.gameId) continue;
      ensure(entry.eggGameId, entry);
    }
  }

  owned.forEach((pet, index) => {
    const species = speciesByGameId.get(pet.gameId);
    const eggGameId = species?.eggGameId;
    if (eggGameId == null) return; // 无蛋血脉（首领形态等）不进母本清单
    if (restrictToCatalog && !groups.has(eggKeyOf(eggGameId))) return; // 图鉴未收录的精灵不参与
    const group = ensure(eggGameId, speciesByGameId.get(eggGameId) ?? species);
    group.memberIndexes.push(index);
    const motherClass = classifyMother(pet, mode);
    if (motherClass !== null) {
      group.hasMother = true;
      if (group.bestClass === null || MOTHER_CLASS_RANK[motherClass] < MOTHER_CLASS_RANK[group.bestClass]) {
        group.bestClass = motherClass;
      }
    }
  });

  const result: MotherGroup[] = [...groups.entries()].map(([chainKey, group]) => ({
    chainKey,
    eggGameId: group.eggGameId,
    collected: group.hasMother,
    quality: isPetGrade(group.bestClass),
    motherClass: group.bestClass,
    formLabel: speciesDisplayName(group.species, ''),
    number: group.species?.number ?? '',
    eggGroups: (group.species?.eggGroups ?? [])
      .filter(isBreedableGroup)
      .sort((a, b) => a - b),
    memberIndexes: group.memberIndexes,
  }));

  const rankOf = (group: MotherGroup): number =>
    group.motherClass === null ? 99 : MOTHER_CLASS_RANK[group.motherClass];
  result.sort((a, b) => rankOf(a) - rankOf(b));
  return result;
}
