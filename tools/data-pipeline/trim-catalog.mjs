import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { pickRecommendedNatures } from './src/pvp-natures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// 用脚本自身位置推导项目根，而不是 process.cwd()：换个工作目录运行也不会找不到 data/
const root = path.join(here, '..', '..');
const pets = JSON.parse(fs.readFileSync(path.join(root, 'data', 'pets.json'), 'utf8'));
const natures = JSON.parse(fs.readFileSync(path.join(root, 'data', 'natures.json'), 'utf8'));
const pvp = JSON.parse(fs.readFileSync(path.join(root, 'data', 'pvp-natures.json'), 'utf8'));

const natureNameById = new Map(natures.natures.map((n) => [n.id, n.name]));

/** 每物种的 PVP 推荐性格（2026-10-05 用户拍板：按占比判定，不再固定 top2）。
 *  见 pickRecommendedNatures：阈值 = max(10%, 最高占比/3)，最多 3 个、保底 top1。 */
function recommendedNaturesFor(gameId) {
  const item = pvp.recommendations?.[String(gameId)];
  if (!item) return [];
  return pickRecommendedNatures(item)
    .map((candidate) => natureNameById.get(candidate.natureId) ?? candidate.name ?? '')
    .filter(Boolean);
}

/**
 * 物种的**官方显示名**（游戏自己的写法，形如 `雪绒鸟_夏天的样子`）。
 *
 * 来源是随抓包解析器一起 vendor 进来的两张表（`src/pcap-decoder/miniprogram/utils/`，
 * 它们由上游脚本从游戏配置生成）：
 * - `eggSpeciesForms`：speciesPetId → 名字（139 条，物种级）
 * - `eggConfigIdentities`：petConfId → [名字, speciesPetId, 类型, 图标]（295 条，蛋级）
 *
 * 为什么不能自己拼「名字 + 形态」：实测有出入 —— 我们的图鉴里写 `地鼠_储水时的样子`，
 * 官方是 `地鼠_储水期的样子`；而 `护主犬` 这类只有一个形态的，官方名直接不带后缀。
 * 所以有官方名就用官方名，没有才退回自己拼。
 */
function loadOfficialNames() {
  const require = createRequire(import.meta.url);
  const utils = path.join(here, '..', '..', 'src', 'pcap-decoder', 'miniprogram', 'utils');
  const speciesForms = require(path.join(utils, 'eggSpeciesForms'));
  const identities = require(path.join(utils, 'eggConfigIdentities'));

  /** speciesPetId → 该物种在蛋配置里出现过的所有名字 */
  const fromEggs = new Map();
  for (const row of Object.values(identities)) {
    const [name, speciesPetId] = row;
    if (typeof name !== 'string' || !Number.isFinite(Number(speciesPetId))) continue;
    const set = fromEggs.get(Number(speciesPetId)) ?? new Set();
    set.add(name);
    fromEggs.set(Number(speciesPetId), set);
  }

  const merged = new Map();
  const conflicts = [];
  for (const [speciesPetId, names] of fromEggs) {
    if (names.size === 1) merged.set(speciesPetId, [...names][0]);
    else conflicts.push({ speciesPetId, names: [...names] });
  }
  // 物种级表覆盖蛋级推断；两者不一致时以物种级为准（它是专门为「物种叫什么」生成的）
  let overridden = 0;
  for (const [speciesPetId, name] of Object.entries(speciesForms)) {
    const id = Number(speciesPetId);
    if (merged.has(id) && merged.get(id) !== name) overridden += 1;
    merged.set(id, name);
  }
  return { merged, conflicts, overridden };
}

/**
 * **蛋归属表**（2026-10-05 用户拍板：母本清单按「蛋」分组，数据源改用蛋神助手）。
 *
 * 蛋神助手是同类工具里维护得最全的一份：`petToEggKey` 直接给出「形态 → 所属蛋」，
 * 且正确区分了「有以它命名的蛋」和「能通过孵蛋获得」——火神没有「火神的蛋」，
 * 但孵火花的蛋再进化就能得到它，所以归到火花那颗蛋；古卷执政官/古卷匣魔像归书魔虫；
 * 圣代甜甜各口味不单独成蛋（进化时随机）；而咬咬小子/足尖元件/热团团/新月鹭虽然也有蛋道具，
 * 但蛋组是「未发现」、不能靠配窝得到，不算。
 *
 * 映射表由 `tools/data-pipeline/build-egg-map.mjs` 预生成（vendor/egg-map.json）：
 * 以蛋神助手映射为主，补上形态感知的兜底（同一 evolution_id 基础形态 / 同一 handbook_id /
 * 蛋神助手的 bwiki·family 链），只收录可孵蛋（蛋组 2~15）的形态。管线这里只做查表。
 *
 * 为什么不再用采集器自带的 `petEggInfo` 快照：它落后（少了咬咬小子/足尖元件等），
 * 且要靠 evolution_id + handbook + evolutionChains 四级兜底推断，绕且易错。
 */
function loadEggMap() {
  const file = path.join(here, 'vendor', 'egg-map.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const map = new Map();
  for (const [petId, eggBaseId] of Object.entries(data.petToEgg ?? {})) {
    map.set(Number(petId), Number(eggBaseId));
  }
  return { map, dataVersion: data.dataVersion ?? '', eggByBase: data.eggByBase ?? {} };
}

const { merged: officialNames, conflicts, overridden } = loadOfficialNames();
const eggMap = loadEggMap();

/**
 * 蛋的重量区间。判定「这枚蛋孵出来是不是大块头 / 小不点」要用：
 * 大块头 = 蛋重 >= hugeMin（约在 [min,max] 区间的 98% 处），小不点 = <= miniMax（约 2% 处）。
 *
 * 四个阈值必须齐全才输出：缺任何一个就不能瞎兜底 —— 例如把 missing 的 hugeMin 兜成 0，
 * 会让「蛋重 >= 0」恒成立，等于把每枚蛋都判成大块头。缺数据的物种直接不给 eggSize，
 * 由消费方按「没有数据、判不了」处理。
 */
function toEggSize(size) {
  if (!size) return undefined;
  const { min, mini_max: miniMax, huge_min: hugeMin, max } = size;
  const values = [min, miniMax, hugeMin, max];
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return undefined;
  return { min, miniMax, hugeMin, max };
}

const species = pets.pets.map((p) => ({
  key: p.key ?? p.id ?? String(p.game_id),
  gameId: p.game_id ?? 0,
  name: p.name ?? '',
  form: p.form,
  number: p.number ?? '',
  stage: p.stage,
  evolutionId: p.evolution_id,
  eggGroups: (p.egg_group ?? []).filter((g) => typeof g === 'number'),
  // 抓取建议需要：能否野外遇到（ecology.areas 非空）＋能否出公（gender_ratio.male > 0）
  catchable: (p.ecology?.areas?.length ?? 0) > 0,
  maleCapable: (p.gender_ratio?.male ?? 0) > 0,
  // 性别比例特殊物种（2026-10-05）：游戏自带 10 分制公母比，烘焙给覆盖度页
  // 「性别比例 ≠ 5:5」专用收集模式（区分纯母 10:0 / 公多母少 8:2 / 母多公少 2:8）
  genderRatio:
    p.gender_ratio && (p.gender_ratio.male > 0 || p.gender_ratio.female > 0)
      ? { male: p.gender_ratio.male, female: p.gender_ratio.female }
      : undefined,
  eggSize: toEggSize(p.egg_size),
  // 游戏自己的叫法；没有就用 name + form 自己拼（见 loadOfficialNames 的说明）
  officialName: officialNames.get(p.game_id ?? 0),
  // 这个形态「对应哪颗蛋」：母本清单按它分组（见 loadEggMap）；
  // null = 无蛋血脉（如首领形态/领地试炼用）或不可孵蛋，不进母本清单。
  // 再挡一层「可孵蛋」判断：蛋归属表理论上已过滤，这里防表格过期/手改。
  eggGameId: (p.egg_group ?? []).some((g) => g >= 2 && g <= 15)
    ? eggMap.map.get(p.game_id ?? 0) ?? null
    : null,
  // 推荐算法专项（2026-10-04）：种族值六围 + PVP 推荐性格 top2，供「优质种公推荐」兜底算法用
  stats: p.stats ?? undefined,
  recommendedNatures: recommendedNaturesFor(p.game_id ?? 0),
}));

const targetNatures = Object.entries(pvp.targetNatures ?? {}).flatMap(([groupId, ids]) =>
  (ids ?? []).map((natureId) => ({
    groupId: Number(groupId),
    natureId,
    name: natureNameById.get(natureId) ?? String(natureId),
  })),
);

const out = {
  source: pets.source ?? '',
  fetchedAt: pets.fetchedAt ?? '',
  dataVersion: pets.dataVersion ?? '',
  eggGroupNames: Object.fromEntries(
    Object.entries(pets.eggGroups ?? {}).map(([k, v]) => [Number(k), v]),
  ),
  // id → 名字的全量性格表：目标性格池要用它把「急躁」这种额外性格换成 id
  natures: natures.natures.map((n) => ({ id: n.id, name: n.name })),
  species,
  targetNatures,
};

const target = path.join(root, 'src', 'data', 'catalog.gen.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
// 原子写（与 refresh.mjs 的 writeAtomic 同款）：catalog.gen.json 是被应用与构建直接引用的
// 产物，写一半崩溃会留下半截 JSON，既让构建报错、也违背「失败时继续用旧图鉴」的承诺
const tmpTarget = `${target}.tmp`;
fs.writeFileSync(tmpTarget, JSON.stringify(out), 'utf8');
fs.renameSync(tmpTarget, target);

const withOfficial = species.filter((s) => s.officialName).length;
console.log(`officialName：${withOfficial} / ${species.length} 条`);
const eggSpeciesCount = species.filter((s) => s.eggGameId != null && s.eggGameId === s.gameId).length;
console.log(`蛋物种：${eggSpeciesCount} 个（蛋归属表 ${eggMap.dataVersion}）`);
if (conflicts.length > 0) {
  console.log(`蛋级配置里同名物种有多个名字的：${conflicts.length} 条（已按物种级表取值）`);
  for (const item of conflicts.slice(0, 5)) {
    console.log(`  speciesPetId=${item.speciesPetId}: ${item.names.join(' / ')}`);
  }
}
if (overridden > 0) console.log(`物种级表覆盖了蛋级推断的：${overridden} 条`);
console.log(`wrote ${target} (${JSON.stringify(out).length} bytes)`);
