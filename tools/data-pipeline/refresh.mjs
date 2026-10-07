// 一键刷新：抓取上游 → 快照 → 解析 → 与本地对比 → 写报告与数据。
// 用法：
//   node refresh.mjs             抓取上游并刷新
//   node refresh.mjs --from-raw  不联网，直接用 data/raw 里的快照重算

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseLuaReturn } from './src/lua-tables.mjs';
import { diffCatalogs, isBreedable, renderChangeReport } from './src/pet-diff.mjs';
import { fetchAllModules } from './src/fetch-modules.mjs';
import { extractNatures } from './src/natures.mjs';
import { extractPvpNatureRecommendations, pickTargetNatures, rankNaturesByEggGroup } from './src/pvp-natures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const rawDir = join(root, 'data', 'raw');
const changesDir = join(root, 'data', 'changes');
const petsPath = join(root, 'data', 'pets.json');
const indexPath = join(root, 'data', 'index.json');

const SOURCE_URL = 'https://wiki.biligame.com/nrc/';
/** 每个蛋组取前几个性格作为目标性格（用户决定：3 个）。 */
const TARGET_NATURES_PER_GROUP = 3;

const MODULES = [
  { title: 'Module:Pets/data/Catalog', file: 'Catalog.lua', snapshot: true },
  { title: 'Module:Pets/data/Config', file: 'Config.lua', snapshot: true },
  { title: 'Module:Pets/data/Index', file: 'Index.lua', snapshot: true },
  // 1 MB 的大模块，只用来提取 30 条性格数据，不留快照。
  { title: 'Module:Pets/data/TrainingReference', file: 'TrainingReference.lua', snapshot: false },
];

/** 原子写：先写临时文件再改名，中途失败不会留下半个文件。 */
function writeAtomic(path, content) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, path);
}

async function fetchAll() {
  // 先把所有模块全部抓齐，再一起落盘；中途失败不会留下半套快照。
  const fetched = await fetchAllModules({ modules: MODULES });
  mkdirSync(rawDir, { recursive: true });
  for (const item of fetched) {
    const module = MODULES.find((m) => m.file === item.file);
    if (module?.snapshot) {
      writeAtomic(join(rawDir, item.file), item.text);
      console.log(`已抓取 ${item.title}（${(item.text.length / 1024).toFixed(0)} KB）`);
    } else {
      console.log(`已抓取 ${item.title}（${(item.text.length / 1024).toFixed(0)} KB，只取性格表）`);
    }
  }
  return fetched;
}

function buildPetRecord(catalog) {
  const pets = {};
  for (const [key, pet] of Object.entries(catalog)) {
    pets[key] = { ...pet, key, egg_group: Array.isArray(pet.egg_group) ? pet.egg_group : [] };
  }
  return pets;
}

function readLocalCatalog() {
  if (!existsSync(petsPath)) return {};
  const existing = JSON.parse(readFileSync(petsPath, 'utf8'));
  return Object.fromEntries((existing.pets ?? []).map((pet) => [pet.key, pet]));
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const fromRaw = process.argv.includes('--from-raw');
  const fetched = fromRaw ? [] : await fetchAll();

  for (const module of MODULES.filter((item) => item.snapshot)) {
    if (!existsSync(join(rawDir, module.file))) {
      throw new Error(`缺少快照文件 ${module.file}，请先联网刷新一次`);
    }
  }

  const catalog = parseLuaReturn(readFileSync(join(rawDir, 'Catalog.lua'), 'utf8'));
  const config = parseLuaReturn(readFileSync(join(rawDir, 'Config.lua'), 'utf8'));
  const index = parseLuaReturn(readFileSync(join(rawDir, 'Index.lua'), 'utf8'));
  const pets = buildPetRecord(catalog);

  const previous = readLocalCatalog();
  const diff = diffCatalogs(previous, pets);

  const breedableCount = Object.values(pets).filter(isBreedable).length;
  const meta = {
    fetchedAt: new Date().toISOString(),
    sourceUrl: SOURCE_URL,
    version: config.current_version ?? '未知',
    petCount: Object.keys(pets).length,
  };

  mkdirSync(changesDir, { recursive: true });
  const reportName = `${meta.fetchedAt.slice(0, 10)}-${meta.version}.md`;
  writeAtomic(join(changesDir, reportName), renderChangeReport(diff, meta));

  writeAtomic(
    petsPath,
    JSON.stringify(
      {
        source: '洛克王国：世界 Wiki (wiki.biligame.com/nrc)',
        sourceModule: 'Module:Pets/data/Catalog',
        license: 'CC BY-SA 4.0（游戏素材不适用）',
        dataVersion: meta.version,
        fetchedAt: meta.fetchedAt,
        petCountDeclared: config.pet_count ?? null,
        petCountParsed: meta.petCount,
        breedableCount,
        eggGroups: {
          1: '未发现', 2: '巨灵组', 3: '两栖组', 4: '昆虫组', 5: '天空组',
          6: '动物组', 7: '妖精组', 8: '植物组', 9: '拟人组', 10: '软体组',
          11: '大地组', 12: '魔力组', 13: '海洋组', 14: '飞龙组', 15: '机械组',
        },
        pets: Object.values(pets),
      },
      null,
      1,
    ),
  );
  writeAtomic(indexPath, JSON.stringify({ source: SOURCE_URL, items: index }, null, 1));

  // 性格表与 PVP 推荐：联网时重新抓取；离线重算时沿用已有文件，但排名与目标性格照常重算。
  const trainingReference = fetched.find((item) => item.file === 'TrainingReference.lua');
  const naturesPath = join(root, 'data', 'natures.json');
  const pvpPath = join(root, 'data', 'pvp-natures.json');
  let natures = readJson(naturesPath)?.natures ?? [];
  let recommendations = readJson(pvpPath)?.recommendations ?? {};

  if (trainingReference) {
    const reference = parseLuaReturn(trainingReference.text);
    natures = extractNatures(reference);
    writeAtomic(
      naturesPath,
      JSON.stringify({ source: SOURCE_URL, module: 'Module:Pets/data/TrainingReference', count: natures.length, natures }, null, 1),
    );
    console.log(`性格表已更新：${natures.length} 条（data/natures.json）`);
    recommendations = extractPvpNatureRecommendations(reference);
  }

  if (natures.length > 0 && Object.keys(recommendations).length > 0) {
    const natureNames = Object.fromEntries(natures.map((nature) => [nature.id, nature.name]));
    const byEggGroup = rankNaturesByEggGroup(Object.values(pets), recommendations, natureNames);
    const targetNatures = pickTargetNatures(byEggGroup, TARGET_NATURES_PER_GROUP);
    writeAtomic(
      pvpPath,
      JSON.stringify(
        {
          source: SOURCE_URL,
          module: 'Module:Pets/data/TrainingReference',
          note:
            '计数单位是进化链 evolution_id：同一形态的不同进化阶段只算一票（取阶级最高那条，并列取热度更高）；不同形态各算一票；双蛋组各记一次；不可孵蛋的精灵不参与',
          targetNaturesPerGroup: TARGET_NATURES_PER_GROUP,
          recommendationCount: Object.keys(recommendations).length,
          recommendations: Object.fromEntries(
            Object.entries(recommendations).map(([gameId, item]) => [
              gameId,
              {
                ...item,
                name: natureNames[item.natureId] ?? '',
                candidates: (item.candidates ?? []).map((candidate) => ({
                  ...candidate,
                  name: natureNames[candidate.natureId] ?? '',
                })),
              },
            ]),
          ),
          byEggGroup,
          targetNatures,
          targetNatureNames: Object.fromEntries(
            Object.entries(targetNatures).map(([groupId, ids]) => [groupId, ids.map((id) => natureNames[id] ?? String(id))]),
          ),
        },
        null,
        1,
      ),
    );
    console.log(
      `PVP 推荐性格已更新：${Object.keys(recommendations).length} 只精灵，每个蛋组取前 ${TARGET_NATURES_PER_GROUP} 个性格（data/pvp-natures.json）`,
    );
  }

  console.log('');
  console.log(`数据版本 ${meta.version}｜精灵 ${meta.petCount} 只（可孵蛋 ${breedableCount}）`);
  console.log(`新增 ${diff.added.length}、数值变化 ${diff.changed.length}、移除 ${diff.removed.length}`);
  console.log(`变更报告：data/changes/${reportName}`);
  for (const pet of diff.added.slice(0, 10)) console.log(`  + ${pet.number} ${pet.name}${pet.breedable ? '' : '（不可孵蛋）'}`);
  for (const change of diff.changed.slice(0, 10)) console.log(`  ~ ${change.name} ${change.field}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`);
}

main().catch((error) => {
  console.error(`刷新失败，本地数据未改动：${error.message}`);
  process.exitCode = 1;
});
