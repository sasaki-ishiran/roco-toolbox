import catalogGen from './catalog.gen.json';
import type { EggGroupId, SpeciesEntry } from '../domain/types';
import type { TargetNature } from '../domain/studCoverage';

interface CatalogGen {
  source: string;
  fetchedAt: string;
  dataVersion: string;
  eggGroupNames: Record<string, string>;
  natures: Array<{ id: number; name: string }>;
  species: SpeciesEntry[];
  targetNatures: TargetNature[];
}

const data = catalogGen as CatalogGen;

export const CATALOG_SOURCE = data.source;
export const CATALOG_SOURCE_URL = 'https://wiki.biligame.com/nrc/';
export const CATALOG_FETCHED_AT = data.fetchedAt;
export const CATALOG_VERSION = data.dataVersion;

/**
 * 蛋组显示名的玩家习惯叫法覆盖。
 * wiki 与 data/pvp-natures.json 里叫「飞龙组」，但玩家（以及蛋神助手）都叫「龙组」，
 * 所以只改显示名，数据键（group id）不动。
 */
const EGG_GROUP_DISPLAY_OVERRIDES: Record<string, string> = { 飞龙组: '龙组' };

export const eggGroupNames: Record<number, string> = Object.fromEntries(
  Object.entries(data.eggGroupNames).map(([id, name]) => [
    Number(id),
    EGG_GROUP_DISPLAY_OVERRIDES[name] ?? name,
  ]),
);

export const species: SpeciesEntry[] = data.species.map((entry) => ({
  ...entry,
  eggGroups: (entry.eggGroups ?? []).filter((g): g is EggGroupId => typeof g === 'number'),
}));

/**
 * 进化链里**最高形态**的推荐性格。
 *
 * 2026-10-05 用户拍板：打 PVP 没人用最低阶精灵，「能换到的性格蛋」应以
 * 该精灵进化链的最高形态的 PVP 推荐性格为准（低阶形态的推荐对实战无意义）。
 *
 * 按 evolutionId 分组；同一链里并列最高 stage 时，取有推荐性格的那条。
 * 没有 evolutionId 的物种按自己单独成链。
 *
 * 2026-10-05 追加：选链顶时**排除「首领形态」**。首领形态是特殊 boss 形态
 * （不可孵、PVP 数据也不代表这条血脉的养成目标），让它当链顶会把整链带偏——
 * 例：火花链 火花→焰火→火神→烈火战神_首领形态，排除后取火神「固执、开朗」，
 * 否则只剩「固执」。链里全是首领形态时才退回原逻辑。
 */
export const chainTopNaturesByGameId: Map<number, string[]> = (() => {
  const byChain = new Map<string, SpeciesEntry[]>();
  for (const entry of species) {
    const key = entry.evolutionId ?? `solo:${entry.gameId}`;
    const list = byChain.get(key) ?? [];
    list.push(entry);
    byChain.set(key, list);
  }
  const result = new Map<number, string[]>();
  for (const members of byChain.values()) {
    const normal = members.filter((entry) => entry.form !== '首领形态');
    const pool = normal.length > 0 ? normal : members;
    const maxStage = Math.max(...pool.map((entry) => entry.stage ?? 0));
    const top = pool.filter((entry) => (entry.stage ?? 0) === maxStage);
    const chosen =
      top.find((entry) => (entry.recommendedNatures?.length ?? 0) > 0) ?? top[0];
    if (chosen) result.set(chosen.gameId, chosen.recommendedNatures ?? []);
    // 链内其他形态也共享同一份推荐（换蛋推荐按物种粒度出，用户只关心这条链该换什么性格蛋）
    for (const entry of members) result.set(entry.gameId, chosen.recommendedNatures ?? []);
  }
  return result;
})();

export const targetNatures: TargetNature[] = data.targetNatures;

/** 图鉴里能野外遇到的物种 gameId（抓取候选的过滤条件之一） */
export const catchableGameIds: Set<number> = new Set(
  species.filter((entry) => entry.catchable === true).map((entry) => entry.gameId),
);

/** 图鉴里能出公的物种 gameId（抓取候选的过滤条件之一） */
export const maleCapableGameIds: Set<number> = new Set(
  species.filter((entry) => entry.maleCapable === true).map((entry) => entry.gameId),
);

/**
 * 用户确认的**额外目标性格**。
 * 游戏里「急躁」个体带表情标记，属于特殊个体，因此计入目标性格（在数据推导的每蛋组前 3 名之外）。
 * 如需增删目标性格，只改这一处。
 */
export const EXTRA_TARGET_NATURE_NAMES = ['急躁'];

/** 目标性格全集：数据推导（每蛋组前 3）∪ 额外目标性格 = 玩家说的「八大性格」。 */
export const targetNatureNames: string[] = [
  ...new Set([...targetNatures.map((target) => target.name), ...EXTRA_TARGET_NATURE_NAMES]),
];

const natureIdByName = new Map(data.natures.map((n) => [n.name, n.id]));

/**
 * 可勾选的目标性格池（带 id）：就是「八大性格」。
 * 性格筛选从这个池子里选，默认取每个蛋组推荐的前 3（见 targetNatures）。
 */
export const targetNaturePool: Array<{ id: number; name: string }> = targetNatureNames
  .map((name) => ({ id: natureIdByName.get(name) ?? 0, name }))
  .filter((entry) => entry.id > 0);
