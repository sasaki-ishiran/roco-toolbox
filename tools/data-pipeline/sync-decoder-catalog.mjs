// 把 App 图鉴已有、抓包解码器图鉴还没收录的物种补进
// `src/pcap-decoder/tools/pcap-json-app/src/generated/catalog.json`。
//
// 解码器图鉴是随上游抓包工具打包的静态快照（generatedAt 2026-09-14），
// 没有自己的刷新脚本；新赛季精灵因此会在采集阶段退化成「未识别精灵 N」、
// 体型奖牌判不出来（2026-11-10 蟹蟹椰 3810）。这里按同一份 wiki 数据补齐。
//
// 用法：在 tools/data-pipeline 下 `node sync-decoder-catalog.mjs`
// 幂等：已收录的 petId 不重复写；只追加缺的物种，不改已有条目。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const appCatalogPath = join(root, 'src', 'data', 'catalog.gen.json');
const rawPetsPath = join(root, 'data', 'pets.json');
const decoderCatalogPath = join(
  root, 'src', 'pcap-decoder', 'tools', 'pcap-json-app', 'src', 'generated', 'catalog.json',
);

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const appCatalog = readJson(appCatalogPath);
const rawPets = readJson(rawPetsPath);
const decoderCatalog = readJson(decoderCatalogPath);

const rawByKey = new Map(rawPets.pets.map((pet) => [pet.id, pet]));
const covered = new Set();
for (const entry of decoderCatalog.pets) {
  covered.add(Number(entry.petId));
  const runtimeId = Number(String(entry.runtimePetId || '').replace(/\D/g, ''));
  if (Number.isFinite(runtimeId) && runtimeId > 0) covered.add(runtimeId);
}

const formIdSeen = new Set();
const buildFormId = (gameId) => {
  let id = `form_sync_${gameId}`;
  let suffix = 2;
  while (formIdSeen.has(id)) id = `form_sync_${gameId}_${suffix++}`;
  formIdSeen.add(id);
  return id;
};
for (const entry of decoderCatalog.pets) {
  if (entry.formId) formIdSeen.add(entry.formId);
}

const added = [];
const skipped = [];
for (const species of appCatalog.species) {
  if (covered.has(species.gameId)) continue;
  const raw = rawByKey.get(species.key);
  if (!raw) {
    skipped.push(`${species.name}(${species.gameId})：data/pets.json 找不到 ${species.key}`);
    continue;
  }
  const name = raw.form ? `${raw.name}_${raw.form}` : raw.name;
  const stats = raw.stats || {};
  added.push({
    name,
    title: raw.name,
    identityName: name,
    identityForm: raw.form || '',
    petId: species.gameId,
    // 解码器图鉴的属性顺序是 [体力, 攻击, 特攻, 防御, 特防, 速度]
    stats: [stats.hp, stats.atk, stats.spa, stats.def, stats.spd, stats.spe],
    weight: raw.weight,
    hasShiny: raw.has_shiny === true,
    formId: buildFormId(species.gameId),
    runtimePetId: raw.id,
    adultSmallWeight: species.bodySize?.small,
    adultBigWeight: species.bodySize?.big,
    sizeSourceName: raw.name,
  });
  covered.add(species.gameId);
}

if (skipped.length) {
  for (const line of skipped) console.warn(`跳过 ${line}`);
}

if (!added.length) {
  console.log(`解码器图鉴已是最新：${decoderCatalog.pets.length} 条，无需补充。`);
} else {
  decoderCatalog.pets.push(...added);
  writeFileSync(decoderCatalogPath, JSON.stringify(decoderCatalog));
  console.log(`解码器图鉴已补充 ${added.length} 条：${decoderCatalog.pets.length - added.length} → ${decoderCatalog.pets.length}`);
  for (const entry of added) console.log(`  + ${entry.petId} ${entry.name}（${entry.weight}）`);
}
