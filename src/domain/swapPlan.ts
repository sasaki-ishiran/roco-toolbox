import { GRADE_BODY, classifyGrade, gradeLabel, type PetGrade, type TargetMode } from './petFilters';
import { isBreedableGroup } from './eggs';
import { swappableNaturesForSpecies } from './studRecommendations';
import { speciesDisplayName } from './speciesName';
import { cellStateFor, type CoverageSlot, type CoverageState, type StudCoverageResult } from './studCoverage';
import type { OwnedPet, SpeciesEntry } from './types';

/** 换蛋清单里的一只可选精灵 */
export interface SwapOption {
  gameId: number;
  /** 物种名（不带形态） */
  name: string;
  /** 官方显示名（有形态时为 `雪绒鸟_夏天的样子`）；交易里就报这个名字 */
  displayName: string;
  number: string;
  /** 用户是否已经拥有该物种（一只都没有 = false） */
  owned: boolean;
}

/**
 * 一条换蛋目标 = **要补的蛋组（1~2 个）× 目标性格 × 档位**。
 *
 * 为什么不是一只一只精灵：图鉴里同属「巨灵组 × 拟人组」的物种有上百只，
 * 逐个列会到 2500+ 条。换蛋时真正要说清的是「要一只同时属于这两个组的精灵的蛋」，
 * 具体是哪只可以任选，所以按组组合聚合，再给一只建议物种。
 */
export interface SwapWish {
  /** 要补的蛋组（升序）。换一只同时属于这些组的精灵即可一次补掉 */
  fillGroups: number[];
  groupLabels: string[];
  natureName: string;
  grade: PetGrade;
  /** = fillGroups.length，换一只蛋能补掉的目标数 */
  score: number;
  /** 建议去要的蛋：优先「未拥有」里图鉴号最小的物种 */
  suggested: SwapOption;
  /** 该组组合下能出公的物种总数（按物种名去重，同物种的多个形态算一种） */
  optionCount: number;
  unownedOptionCount: number;
  /** 换来「建议的那只」**马上能配**的格数（原本缺 → 换上就 covered/breedable） */
  unlockedCells: number;
  /** 换上能立刻补上的缺口（`蛋组|性格|档位`），界面用来说明"换它能补什么" */
  unlockedCellKeys: string[];
}

export interface RankSwapWishesInput {
  species: SpeciesEntry[];
  coverage: StudCoverageResult;
  /**
   * 手上的精灵（算「换了这一只，我能多配上几格」要用）。
   * 判定复用覆盖度那份 `cellStateFor`，保证和配窝建议同一套口径。
   */
  owned: OwnedPet[];
  /** 档位模式（追满分 / 追双牌），影响档位判定 */
  mode: TargetMode;
  /**
   * 已拥有的**蛋物种** gameId（按蛋/物种判，不按形态）：手里有这条血脉的任意一个形态，
   * 就算这颗蛋「已拥有」——同物种不同形态（石肤蜥_本来的样子 / 石肤蜥_球球尾巴的样子）
   * 本质是一回事，不该互相推荐。只影响排序，不作硬门槛。
   */
  ownedEggGameIds: Set<number>;
  /** 能出公的物种 gameId（只用来排除**完全出不了公**的物种，不按"这格缺公/缺母"再砍） */
  maleCapableGameIds: Set<number>;
  eggGroupNames: Record<number, string>;
}

/**
 * 「换得动」的缺口：只有 `empty` 与 `missingStud` 需要去换。
 * `covered` 已完成；`breedable` 手里就有能放进学院小窝的那只，自己配窝即可。
 */
const needsSwap = (state: CoverageState): boolean => state === 'empty' || state === 'missingStud';

/** 假设换到的这只精灵：档位按目标档位造（换蛋本来就是按目标档位去要的） */
const candidatePet = (
  item: SpeciesEntry,
  gender: '公' | '母',
  nature: string,
  grade: PetGrade,
): OwnedPet => ({
  gameId: item.gameId,
  name: item.name,
  gender,
  nature,
  voiceDb: grade === '大婉' || grade === '小婉' ? 100 : -100,
  medalBody: GRADE_BODY[grade],
  isShiny: false,
  account: '__candidate__',
});

interface Bucket {
  fillGroups: number[];
  natureName: string;
  grade: PetGrade;
  /** 物种名 → 该物种的代表条目（同物种的多个形态只留一只） */
  options: Map<string, SwapOption>;
  /** 物种名 → 换上它之后能推进的格（ready = 马上能配，advanced = 还差一只） */
  unlockedBy: Map<string, { ready: string[]; advanced: string[] }>;
}

export function rankSwapWishes(input: RankSwapWishesInput): SwapWish[] {
  const { species, coverage, ownedEggGameIds, maleCapableGameIds, eggGroupNames, owned, mode } = input;

  // 槽位状态索引与「每个组选中的目标性格」都来自覆盖度结果，保证两处口径一致
  const stateBySlot = new Map<string, CoverageState>();
  const naturesByGroup = new Map<number, Set<string>>();
  const grades = new Set<PetGrade>();
  for (const cell of coverage.cells) {
    stateBySlot.set(`${cell.groupId}:${cell.natureName}:${cell.grade}`, cell.state);
    const natures = naturesByGroup.get(cell.groupId) ?? new Set<string>();
    natures.add(cell.natureName);
    naturesByGroup.set(cell.groupId, natures);
    grades.add(cell.grade);
  }

  const buckets = new Map<string, Bucket>();

  // —— 「换了这一只，我能多配上几格」：和覆盖度共用 `cellStateFor`，两处口径不会走偏 ——
  const gameToEggGroups = new Map<number, number[]>();
  for (const item of species) {
    gameToEggGroups.set(item.gameId, (item.eggGroups ?? []).filter(isBreedableGroup));
  }
  const matchedIndex = new Map<string, OwnedPet[]>();
  /** 母方物种能不能出公（后代随母方，出不了公就永远孵不出种公） */
  const canBreedMale = (pet: OwnedPet): boolean => maleCapableGameIds.has(pet.gameId);
  const matchedFor = (groupId: number, grade: PetGrade): OwnedPet[] => {
    const key = `${groupId}|${grade}`;
    const cached = matchedIndex.get(key);
    if (cached) return cached;
    const list = owned.filter(
      (pet) =>
        classifyGrade(pet, mode) === grade && (gameToEggGroups.get(pet.gameId) ?? []).includes(groupId),
    );
    matchedIndex.set(key, list);
    return list;
  };
  /**
   * 把候选蛋当成「多拥有了一只」，看它能把哪些缺口推成什么样：
   * - ready：换上马上能配（原本缺 → covered/breedable）
   * - advanced：换上还差一只，但已经是进步（原本完全没人 → 还差一只）
   * 不管它将来是公还是母，哪一侧成立都算——用户不需要关心这一步。
   */
  const unlockedByCandidate = (
    item: SpeciesEntry,
    natureName: string,
    grade: PetGrade,
  ): { ready: string[]; advanced: string[] } => {
    const groups = (item.eggGroups ?? []).filter(isBreedableGroup);
    const ready: string[] = [];
    const advanced: string[] = [];
    for (const cell of coverage.cells) {
      if (!needsSwap(cell.state) || cell.grade !== grade) continue;
      if (!groups.includes(cell.groupId)) continue;
      const matched = matchedFor(cell.groupId, cell.grade);
      const slot: CoverageSlot = {
        groupId: cell.groupId,
        natureId: cell.natureId,
        natureName: cell.natureName,
        grade: cell.grade,
      };
      const after = (['公', '母'] as const).map((gender) =>
        cellStateFor([...matched, candidatePet(item, gender, natureName, cell.grade)], slot, canBreedMale),
      );
      const key = `${cell.groupId}|${cell.natureName}|${cell.grade}`;
      if (after.some((state) => state === 'covered' || state === 'breedable')) ready.push(key);
      // 「往前推一步」只算真的变了：原本完全没人 → 现在有人了
      else if (cell.state === 'empty' && after.some((state) => state === 'missingStud')) advanced.push(key);
    }
    return { ready, advanced };
  };

  for (const item of species) {
    if (!maleCapableGameIds.has(item.gameId)) continue;
    // 换蛋目标只能是「本身就是一颗蛋」的物种（eggGameId === gameId）。
    // 不能再用「stage === 1」代替：有些基础形态（如 海盔虫_磨损的样子、石肤蜥_球球尾巴的样子）
    // 没有以自己命名的蛋，是靠孵化同物种另一形态的蛋再进化来的，压根换不到它们的蛋。
    if (item.eggGameId !== item.gameId) continue;
    const groups = (item.eggGroups ?? []).filter(isBreedableGroup);
    if (groups.length === 0) continue;

    const option: SwapOption = {
      gameId: item.gameId,
      name: item.name,
      displayName: speciesDisplayName(item, item.name),
      number: item.number,
      owned: ownedEggGameIds.has(item.gameId),
    };

    // 建议物种必须「能孵出缺口要的那个性格」：用进化链最高形态的 PVP 推荐（top2）过滤。
    // 这样清单里显示的性格 = 缺口需要的性格（槽位性格），两者永远一致
    // （2026-10-05 用户拍板：修「有平和种公却被推荐平和」的错位——显示的性格根本不是缺口要的）。
    const swappable = swappableNaturesForSpecies(item);
    if (swappable.length === 0) continue;
    const natures = new Set<string>();
    for (const groupId of groups) {
      for (const nature of naturesByGroup.get(groupId) ?? []) {
        if (swappable.includes(nature)) natures.add(nature);
      }
    }
    if (natures.size === 0) continue;

    for (const natureName of natures) {
      for (const grade of grades) {
        const fillGroups = groups
          .filter((groupId) => {
            const state = stateBySlot.get(`${groupId}:${natureName}:${grade}`);
            return state !== undefined && needsSwap(state);
          })
          .sort((a, b) => a - b);
        if (fillGroups.length === 0) continue;

        const key = `${fillGroups.join('+')}|${natureName}|${grade}`;
        const bucket = buckets.get(key) ?? {
          fillGroups,
          natureName,
          grade,
          options: new Map<string, SwapOption>(),
          unlockedBy: new Map<string, { ready: string[]; advanced: string[] }>(),
        };
        // 形态在交易里要报官方名（`雪绒鸟_夏天的样子`），不同形态是不同目标，各自留一只代表
        const existing = bucket.options.get(option.displayName);
        if (!existing || item.number.localeCompare(existing.number) < 0) {
          bucket.options.set(option.displayName, option);
        }
        bucket.unlockedBy.set(option.displayName, unlockedByCandidate(item, natureName, grade));
        buckets.set(key, bucket);
      }
    }
  }

  const wishes: SwapWish[] = [];
  for (const bucket of buckets.values()) {
    const readyCount = (name: string): number => bucket.unlockedBy.get(name)?.ready.length ?? 0;
    // 建议物种优先挑「换上能多配几格」的，再按原来的未拥有 / 图鉴号
    const options = [...bucket.options.values()].sort(
      (a, b) =>
        readyCount(b.displayName) - readyCount(a.displayName) ||
        Number(a.owned) - Number(b.owned) ||
        a.number.localeCompare(b.number) ||
        a.gameId - b.gameId,
    );
    const suggested = options[0];
    if (!suggested) continue;
    const unlocked = bucket.unlockedBy.get(suggested.displayName) ?? { ready: [], advanced: [] };

    wishes.push({
      fillGroups: bucket.fillGroups,
      groupLabels: bucket.fillGroups.map(
        (groupId) => eggGroupNames[groupId] ?? `蛋组${groupId}`,
      ),
      natureName: bucket.natureName,
      grade: bucket.grade,
      score: bucket.fillGroups.length,
      suggested,
      optionCount: options.length,
      unownedOptionCount: options.filter((candidate) => !candidate.owned).length,
      unlockedCells: unlocked.ready.length,
      unlockedCellKeys: unlocked.ready,
    });
  }

  // 换上能多配几格的在前；再按能补的组数、未拥有候选数；最后按组/性格/档位固定顺序
  const sorted = wishes.sort(
    (a, b) =>
      b.unlockedCells - a.unlockedCells ||
      b.score - a.score ||
      b.unownedOptionCount - a.unownedOptionCount ||
      a.fillGroups.join('+').localeCompare(b.fillGroups.join('+')) ||
      a.natureName.localeCompare(b.natureName) ||
      a.grade.localeCompare(b.grade),
  );

  // 聚合（2026-10-05 用户拍板，留在数据层）：同性格 + 同档位下，组范围被别的建议**完全包住**的
  // 不再单独返回——换上"包住它的那条"就已经把这几组一起补了，列两遍反而让人以为要换两次。
  const byNatureGrade = new Map<string, SwapWish[]>();
  for (const wish of sorted) {
    const key = `${wish.natureName}|${wish.grade}`;
    byNatureGrade.set(key, [...(byNatureGrade.get(key) ?? []), wish]);
  }
  const covered = new Set<SwapWish>();
  for (const list of byNatureGrade.values()) {
    for (const wish of list) {
      const host = list.some(
        (other) =>
          other !== wish &&
          other.fillGroups.length > wish.fillGroups.length &&
          wish.fillGroups.every((groupId) => other.fillGroups.includes(groupId)),
      );
      if (host) covered.add(wish);
    }
  }
  return sorted.filter((wish) => !covered.has(wish));
}

/** 换蛋时对方从哪个窝里产这颗蛋：绿窝（学院小窝）性格 100% 遗传；普通窝每只亲本 30% 遗传自己性格（2026-10-04 确认）。 */
export type NestKind = 'green' | 'plain';

export const NEST_PREFIX: Record<NestKind, string> = {
  green: '绿窝',
  plain: '普通窝',
};

/** 单条：窝 + 档位 + 性格 + 精灵名，如「绿窝满分大婉平和白发懒人」。 */
export function formatSwapWish(wish: SwapWish, mode: TargetMode, nest?: NestKind): string {
  const prefix = nest ? NEST_PREFIX[nest] : '';
  return `${prefix}${gradeLabel(wish.grade, mode)}${wish.natureName}${wish.suggested.displayName}`;
}

/**
 * 整段复制的文本（用户 2026-10-03 拍的格式）：
 *
 * ```
 * 绿窝满分大婉
 * 平和白发懒人
 * 固执雪绒鸟_夏天的样子
 * ```
 *
 * 第一行是「窝 + 档位」（两种窝都写前缀），随后每行一只「性格 + 精灵名」；
 * 不同档位之间空一行。
 */
export function formatSwapWishes(wishes: SwapWish[], mode: TargetMode, nest?: NestKind): string {
  const groups = new Map<PetGrade, string[]>();
  for (const wish of wishes) {
    const lines = groups.get(wish.grade) ?? [];
    lines.push(`${wish.natureName}${wish.suggested.displayName}`);
    groups.set(wish.grade, lines);
  }

  const prefix = nest ? NEST_PREFIX[nest] : '';
  const blocks: string[] = [];
  for (const [grade, lines] of groups) {
    blocks.push([`${prefix}${gradeLabel(grade, mode)}`, ...lines].join('\n'));
  }
  return blocks.join('\n\n');
}
