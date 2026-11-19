import catalogGen from './catalog.gen.json';
import type { EggGroupId, SpeciesEntry } from '../domain/types';
import type { TargetNature } from '../domain/studCoverage';
import productEggNatures from './productEggNatures.json';

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
const EGG_GROUP_DISPLAY_OVERRIDES: Record<string, string> = { "飞龙组": '龙组' };

export const eggGroupNames: Record<number, string> = Object.fromEntries(
  Object.entries(data.eggGroupNames).map(([id, name]) => [
    Number(id),
    EGG_GROUP_DISPLAY_OVERRIDES[name] ?? name,
  ]),
);

/** 产品设定的每颗蛋推荐性格（`productEggNatures.json`，key = 蛋的 gameId）。 */
const productNaturesByGameId: Record<string, string[]> = productEggNatures.natures;

/**
 * 蛋归属修正（2026-11-17 用户口径）。
 *
 * 阿瓦鲨是乐乐鲨的成熟形态，图鉴却把它拆成两条独立血脉、各自当成一颗蛋，
 * 「母本 / 种公」里于是凭空多出两颗不存在的蛋。用户拍板：**阿瓦鲨彻底不计入任何蛋**，
 * 所以这里把它的 `eggGameId` 置空（不归乐乐鲨，也不自己成蛋）。
 */
const EGG_GAME_ID_OVERRIDES: Record<number, number | null> = {
  3806: null, // 阿瓦鲨（柠檬鲨的样子）
  3807: null, // 阿瓦鲨（虎纹鲨的样子）
};

/**
 * 图鉴物种表。
 *
 * 推荐性格以**产品口径**为准（2026-11-02 产品设定）：`productEggNatures.json` 里列出的蛋，
 * 直接用它给的性格列表；图鉴管线产出的 `eggRecommendedNatures` 可能滞后一步，只作兜底。
 */
export const species: SpeciesEntry[] = data.species.map((entry) => {
  const eggGameId = Object.prototype.hasOwnProperty.call(EGG_GAME_ID_OVERRIDES, entry.gameId)
    ? EGG_GAME_ID_OVERRIDES[entry.gameId]
    : entry.eggGameId;
  return {
    ...entry,
    eggGameId,
    eggGroups: (entry.eggGroups ?? []).filter((g): g is EggGroupId => typeof g === 'number'),
    ...(eggGameId === entry.gameId && productNaturesByGameId[String(entry.gameId)]
      ? { eggRecommendedNatures: productNaturesByGameId[String(entry.gameId)] }
      : {}),
  };
});

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

/** 全部性格名（按图鉴顺序）：推荐性格编辑器的可选项。 */
export const allNatureNames: string[] = data.natures.map((nature) => nature.name);

/**
 * 可勾选的目标性格池（带 id）：就是「八大性格」。
 * 性格筛选从这个池子里选，默认取每个蛋组推荐的前 3（见 targetNatures）。
 */
export const targetNaturePool: Array<{ id: number; name: string }> = targetNatureNames
  .map((name) => ({ id: natureIdByName.get(name) ?? 0, name }))
  .filter((entry) => entry.id > 0);

/**
 * 性格 → 提升的属性（物攻 / 物防 / 魔攻 / 魔防 / 速度 / 生命）。
 *
 * 来源：`data/natures.json` 的 `plus` 字段。图鉴生成数据 `catalog.gen.json` 只保留了 id / name，
 * 而性格面板要按属性分组展示，所以这里补一份静态映射（性格固定 30 条，不随版本变化）。
 */
export const naturePlusStats: ReadonlyMap<string, string> = new Map([
  ['大胆', '物攻'],
  ['固执', '物攻'],
  ['调皮', '物攻'],
  ['勇敢', '物攻'],
  ['逞强', '物攻'],
  ['稳重', '物防'],
  ['天真', '物防'],
  ['懒散', '物防'],
  ['悠闲', '物防'],
  ['坦率', '物防'],
  ['聪明', '魔攻'],
  ['专注', '魔攻'],
  ['偏执', '魔攻'],
  ['冷静', '魔攻'],
  ['理性', '魔攻'],
  ['警惕', '魔防'],
  ['温顺', '魔防'],
  ['害羞', '魔防'],
  ['慎重', '魔防'],
  ['焦虑', '魔防'],
  ['胆小', '速度'],
  ['急躁', '速度'],
  ['开朗', '速度'],
  ['莽撞', '速度'],
  ['热情', '速度'],
  ['沉默', '生命'],
  ['忧郁', '生命'],
  ['平和', '生命'],
  ['粗心', '生命'],
  ['踏实', '生命'],
]);
