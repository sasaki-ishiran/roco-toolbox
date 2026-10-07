// 生成「每个形态对应哪颗蛋」的静态映射表（tools/data-pipeline/vendor/egg-map.json）。
//
// 数据来源：蛋神助手 v1.1.5 导出的 eggData.json / petBaseData.json（解包自官方 exe），
// 以及本项目的 data/pets.json（图鉴，用于补形态/图鉴条目关系）。
//
// 用法（重建映射表时执行一次）：
//   node tools/data-pipeline/build-egg-map.mjs <蛋神助手解包目录>
//   该目录需含 assets_catalog_eggData.json 与 assets_catalog_petBaseData.json
//   （这两份来自第三方工具「蛋神助手」，不随本仓库分发，需自备）
//
// 解析顺序（前面优先）：
// 1. 蛋神助手 petToEggKey 的直接映射（权威）；
// 2. 图鉴里同一 evolution_id（形态级进化链）的基础形态是蛋物种 → 归它（火神→火花）；
// 3. 图鉴里同一 handbook_id（同一物种条目，如海盔虫 本来的/磨损）有蛋物种 → 归它（同形态优先）；
// 4. 蛋神助手 chainMembers（bwiki / family 链，如 烈火战神 所属的 family）里有蛋物种 → 归它（同形态优先）。
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const extractDir = process.argv[2];
if (!extractDir) {
  console.error('用法: node tools/data-pipeline/build-egg-map.mjs <蛋神助手解包目录>');
  console.error('  该目录需含 assets_catalog_eggData.json 与 assets_catalog_petBaseData.json');
  process.exit(1);
}
const outPath = join(here, 'vendor', 'egg-map.json');

const eggData = JSON.parse(fs.readFileSync(join(extractDir, 'assets_catalog_eggData.json'), 'utf8'));
const petData = JSON.parse(fs.readFileSync(join(extractDir, 'assets_catalog_petBaseData.json'), 'utf8'));
const wiki = JSON.parse(fs.readFileSync(join(root, 'data', 'pets.json'), 'utf8'));

const isBreedable = (p) => (p.egg_group ?? []).some((g) => g >= 2 && g <= 15);
const breedable = wiki.pets.filter(isBreedable);

// 1) 蛋神助手直接映射
const byEggKey = eggData.byEggKey;
const petToEgg = new Map();
for (const [petId, eggKey] of Object.entries(eggData.petToEggKey ?? {})) {
  const egg = byEggKey[eggKey];
  if (egg) petToEgg.set(Number(petId), egg.baseId);
}
const eggBases = new Set(petToEgg.values());

// 图鉴索引
const byGameId = new Map(breedable.map((p) => [p.game_id, p]));
const byEvo = new Map();
const byHandbook = new Map();
for (const p of breedable) {
  if (p.evolution_id) {
    const l = byEvo.get(p.evolution_id) ?? [];
    l.push(p);
    byEvo.set(p.evolution_id, l);
  }
  if (p.handbook_id) {
    const l = byHandbook.get(p.handbook_id) ?? [];
    l.push(p);
    byHandbook.set(p.handbook_id, l);
  }
}
/** 候选里优先同形态，其次基础形态（本来的样子 / 无形态）。 */
const pickForm = (candidates, pet) =>
  candidates.find((c) => c.form === pet.form) ??
  candidates.find((c) => !c.form || c.form === '本来的样子') ??
  candidates[0];

// 蛋神助手 chainMembers（合并 bwiki / family 链）
const memberChains = new Map();
for (const r of petData.records) {
  if (!Array.isArray(r.chainMembers)) continue;
  for (const m of r.chainMembers) {
    const l = memberChains.get(Number(m)) ?? [];
    l.push(r.chainMembers.map(Number));
    memberChains.set(Number(m), l);
  }
}

let viaEvo = 0;
let viaHandbook = 0;
let viaChain = 0;
const resolveOne = (pet) => {
  // 2) 同 evolution_id 的基础形态已经能归到某颗蛋（含「基础形态本身就是蛋物种」）
  const evo = pet.evolution_id ? byEvo.get(pet.evolution_id) ?? [] : [];
  const base = [...evo].sort((a, b) => (a.stage ?? 99) - (b.stage ?? 99))[0];
  if (base && petToEgg.has(base.game_id)) {
    petToEgg.set(pet.game_id, petToEgg.get(base.game_id));
    viaEvo += 1;
    return true;
  }

  // 3) 同 handbook_id 里有蛋物种
  const fromHandbook = (byHandbook.get(pet.handbook_id) ?? []).filter((c) => eggBases.has(c.game_id));
  if (fromHandbook.length > 0) {
    petToEgg.set(pet.game_id, pickForm(fromHandbook, pet).game_id);
    viaHandbook += 1;
    return true;
  }

  // 4) 蛋神助手链里有蛋物种
  for (const members of memberChains.get(pet.game_id) ?? []) {
    const cands = members
      .map((id) => byGameId.get(id))
      .filter((c) => c && eggBases.has(c.game_id));
    if (cands.length > 0) {
      petToEgg.set(pet.game_id, pickForm(cands, pet).game_id);
      viaChain += 1;
      return true;
    }
  }
  return false;
};

// 多轮迭代：步骤 2 依赖「同链基础形态已被解析」，可能要等前面的先算出来（如 音速犬_看守麦田 ← 护主犬_看守麦田）
for (let pass = 0; pass < 6; pass += 1) {
  let changed = false;
  for (const pet of breedable) {
    if (petToEgg.has(pet.game_id)) continue;
    if (resolveOne(pet)) changed = true;
  }
  if (!changed) break;
}

// 只保留「可孵蛋」的形态：咬咬小子/足尖元件/热团团/新月鹭/诅咒狼灵/果实立方人这类
// 虽然也有蛋道具，但蛋组是「未发现」、不能靠配窝得到，不算母本目标。
const breedableIds = new Set(breedable.map((p) => p.game_id));
const finalPetToEgg = [...petToEgg.entries()].filter(([petId]) => breedableIds.has(petId));

// 蛋元数据（精简，只留可孵蛋的蛋物种）
const eggByBase = {};
for (const e of Object.values(byEggKey)) {
  if (!breedableIds.has(e.baseId)) continue;
  if (!eggByBase[e.baseId]) {
    eggByBase[e.baseId] = {
      nameKey: e.nameKey,
      eggName: e.eggName,
      eggTypeName: e.eggTypeName ?? null,
      eggGroupIds: e.eggGroupIds ?? [],
    };
  }
}

const out = {
  source: '蛋神助手 v1.1.5（eggData.json / petBaseData.json）+ 本项目图鉴（形态/图鉴条目补洞）',
  dataVersion: eggData.dataVersion,
  note: 'speciesPetId → 蛋物种 speciesPetId；蛋物种自己的映射值等于自身。仅收录可孵蛋（蛋组 2~15）的形态。',
  stats: {
    petToEgg: finalPetToEgg.length,
    eggBases: new Set(finalPetToEgg.map(([, base]) => base)).size,
    viaEvo,
    viaHandbook,
    viaChain,
  },
  eggByBase,
  petToEgg: Object.fromEntries(finalPetToEgg.sort((a, b) => a[0] - b[0])),
};

fs.mkdirSync(dirname(outPath), { recursive: true });
// 原子写：egg-map.json 进版本库、且被 trim-catalog 直接读取，写一半崩溃会留下残缺 JSON
const tmpOutPath = `${outPath}.tmp`;
fs.writeFileSync(tmpOutPath, JSON.stringify(out), 'utf8');
fs.renameSync(tmpOutPath, outPath);
console.log(
  `蛋物种 ${out.stats.eggBases} · 映射 ${out.stats.petToEgg}（进化链补 ${viaEvo} / 图鉴条目补 ${viaHandbook} / 蛋神助手链补 ${viaChain}）`,
);
console.log(`wrote ${outPath}`);
