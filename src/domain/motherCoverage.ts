import type { EggGroupId, OwnedPet, SpeciesEntry } from './types';
import { betterMotherClass, classifyGrade, classifyMother, type TargetMode } from './petFilters';
import { isBreedableGroup } from './eggs';
import { speciesDisplayName } from './speciesName';

export interface MotherCoverageItem {
  chainKey: string; // evolutionId 或 species.key
  formLabel: string; // 显示名，有形态时用官方写法，如「雪绒鸟_夏天的样子」
  number: string;
  eggGroups: EggGroupId[];
  collected: boolean;
  /** 有**合格**母本（落在当前模式的 4 档之一）；与「母本全收集」同一口径 */
  qualified: boolean;
  motherName?: string;
  account?: string;
}

export interface MotherCoverageSummary {
  total: number;
  collected: number;
  /**
   * 已具备「大婉」档母本的链数（大块头 + 婉转声；阈值随模式）。
   * 只有这种母本，才能和满分种公孵出满分大块头的蛋（声音取父母均值向零取整，
   * 体型要双大块头），所以它与 collected 是两个不同层次的进度。
   */
  qualityCollected: number;
  /**
   * 母本全收集：该链有**合格母本**的链数。
   * 合格 = 落在当前模式的 4 档之一（大婉 / 小婉 / 大粗 / 小粗）；
   * 只算任意母本不算收集（那是 collected 的口径）。
   */
  fullCollected: number;
  items: MotherCoverageItem[];
}

export function computeMotherCoverage(
  species: SpeciesEntry[],
  owned: OwnedPet[],
  mode: TargetMode,
): MotherCoverageSummary {
  // 按**蛋**分组（2026-10-05 用户拍板：单位从进化链改成蛋，与母本清单同口径）。
  // 归属同一颗蛋的形态（火神/焰火 → 火花；古卷执政官 → 书魔虫）算同一个目标。
  const chains = new Map<
    string,
    {
      gameIds: Set<number>;
      name: string;
      form?: string;
      officialName?: string;
      number: string;
      eggGroups: Set<EggGroupId>;
    }
  >();

  for (const entry of species) {
    const eggGameId = entry.eggGameId;
    if (eggGameId == null) continue; // 无蛋血脉（首领形态等）不参与统计
    const breedable = entry.eggGroups.filter(isBreedableGroup);
    if (breedable.length === 0) continue; // 未发现组（不可孵蛋）不参与统计

    const chainKey = `egg:${eggGameId}`;
    let chain = chains.get(chainKey);
    if (!chain) {
      chain = {
        gameIds: new Set(),
        name: entry.name,
        form: entry.form,
        officialName: entry.officialName,
        number: entry.number,
        eggGroups: new Set(),
      };
      chains.set(chainKey, chain);
    }
    chain.gameIds.add(entry.gameId);
    for (const group of breedable) chain.eggGroups.add(group);
    // 标签用「蛋物种」本身（进化形态的名字不能代表这颗蛋）
    if (eggGameId === entry.gameId) {
      chain.name = entry.name;
      chain.form = entry.form;
      chain.officialName = entry.officialName;
      chain.number = entry.number;
    }
  }

  // 注意：同一个 gameId 可能有多只母本，必须全都保留——只留第一只会漏掉合格的那只
  const ownedMothers = new Map<number, OwnedPet[]>();
  for (const pet of owned) {
    if (pet.gender !== '母') continue;
    const list = ownedMothers.get(pet.gameId) ?? [];
    list.push(pet);
    ownedMothers.set(pet.gameId, list);
  }

  const items: MotherCoverageItem[] = [];
  let collected = 0;
  let qualityCollected = 0;
  let fullCollected = 0;

  for (const [chainKey, chain] of chains) {
    let mother: OwnedPet | undefined;
    let motherGameId: number | undefined;
    let bestClass = null as ReturnType<typeof classifyMother>;
    for (const gameId of chain.gameIds) {
      for (const candidate of ownedMothers.get(gameId) ?? []) {
        const cls = classifyMother(candidate, mode);
        const better = betterMotherClass(bestClass, cls);
        if (better !== bestClass || mother === undefined) {
          bestClass = better;
          mother = candidate;
          motherGameId = gameId;
        }
      }
    }
    const formLabel = speciesDisplayName(chain, '');
    const motherSpecies =
      motherGameId != null ? species.find((entry) => entry.gameId === motherGameId) : undefined;
    const motherName = motherSpecies ? speciesDisplayName(motherSpecies, '') : undefined;
    // 合格母本：该链任意一只母本落在 4 档满分里
    const hasQualifiedMother = [...chain.gameIds].some((gameId) =>
      (ownedMothers.get(gameId) ?? []).some((candidate) => {
        const cls = classifyMother(candidate, mode);
        return cls !== null && cls !== '其他';
      }),
    );
    items.push({
      chainKey,
      formLabel,
      number: chain.number,
      eggGroups: [...chain.eggGroups].sort((a, b) => a - b),
      collected: mother != null,
      qualified: hasQualifiedMother,
      motherName,
      account: mother?.account,
    });
    if (mother) collected += 1;
    // 优质母本：该链任意一只母本落在「大婉」档（大块头 + 婉转声，阈值随模式）
    const hasQualityMother = [...chain.gameIds].some((gameId) =>
      (ownedMothers.get(gameId) ?? []).some(
        (candidate) => classifyGrade(candidate, mode) === '大婉',
      ),
    );
    if (hasQualityMother) qualityCollected += 1;
    if (hasQualifiedMother) fullCollected += 1;
  }

  return { total: items.length, collected, qualityCollected, fullCollected, items };
}
