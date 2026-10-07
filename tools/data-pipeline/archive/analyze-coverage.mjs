// 收集度分析：备份里的精灵与 wiki 图鉴怎么正确对上。
// 用法：node analyze-coverage.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', '补充数据');
const wiki = JSON.parse(readFileSync(join(here, '..', '..', 'data', 'pets.json'), 'utf8'));
const norm = (name) => String(name ?? '').split(/[（(_]/)[0].trim();

const byKey = new Map(wiki.pets.map((p) => [p.key, p]));
const byGameId = new Map(wiki.pets.map((p) => [p.game_id, p]));
const byName = new Map();
for (const pet of wiki.pets) {
  for (const name of [pet.name, pet.title]) {
    if (!name) continue;
    const base = norm(name);
    if (!byName.has(base)) byName.set(base, pet);
  }
}

const stats = { runtimePetId: { hit: 0, miss: new Set() }, gameId: { hit: 0, miss: new Set() }, name: { hit: 0, miss: new Set() } };
const ownedByGameId = new Map();
const ownedByKey = new Map();
const ownedByName = new Map();
const examples = [];

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  for (const pet of data.collections.petBackpack.items) {
    const byId = byKey.get(pet.runtimePetId);
    if (byId) { stats.runtimePetId.hit += 1; ownedByKey.set(byId.key, byId); } else stats.runtimePetId.miss.add(`${pet.spriteName}(${pet.runtimePetId})`);

    const byG = byGameId.get(pet.speciesPetId);
    if (byG) { stats.gameId.hit += 1; ownedByGameId.set(byG.key, byG); } else stats.gameId.miss.add(`${pet.spriteName}(${pet.speciesPetId})`);

    const byN = byName.get(norm(pet.spriteName)) ?? byName.get(norm(pet.name));
    if (byN) { stats.name.hit += 1; ownedByName.set(byN.key, byN); } else stats.name.miss.add(pet.spriteName);

    if (byId && byG && byId.key !== byG.key && examples.length < 5) {
      examples.push(`${pet.spriteName}: runtimePetId → ${byId.key}(${byId.name})，gameId → ${byG.key}(${byG.name})`);
    }
  }
}

console.log('三种连接键的命中情况（按拥有记录条数统计）：');
console.log(`  按 runtimePetId: 命中 ${stats.runtimePetId.hit}，未命中 ${stats.runtimePetId.miss.size} 种`);
console.log(`  按 game_id     : 命中 ${stats.gameId.hit}，未命中 ${stats.gameId.miss.size} 种`);
console.log(`  按 名字        : 命中 ${stats.name.hit}，未命中 ${stats.name.miss.size} 种`);
console.log('\nruntimePetId 与 game_id 指向不同精灵的例子:');
for (const e of examples) console.log('  ' + e);

console.log('\n=== 四个账号合计收集度 ===');
for (const [label, owned] of [['按 runtimePetId', ownedByKey], ['按 game_id', ownedByGameId], ['按名字', ownedByName]]) {
  const missing = wiki.pets.filter((p) => !owned.has(p.key));
  console.log(`  ${label}: 已拥有 ${owned.size} / ${wiki.pets.length} 种，还缺 ${missing.length} 种`);
}

const owned = ownedByGameId;
const missing = wiki.pets.filter((p) => !owned.has(p.key));
const breedableMissing = missing.filter((p) => Array.isArray(p.egg_group) && p.egg_group.some((id) => id !== 1));
console.log(`\n按 game_id 口径：还缺 ${missing.length} 种，其中可孵蛋 ${breedableMissing.length} 种、只能抓换 ${missing.length - breedableMissing.length} 种`);
console.log(`未命中 game_id 的物种（wiki 里可能真没有）: ${[...stats.gameId.miss].slice(0, 20).join('、') || '无'}`);
