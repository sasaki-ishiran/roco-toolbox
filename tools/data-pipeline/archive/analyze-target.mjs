// 按「大婉满分」目标盘点四个账号的现有家底。
// 用法：node analyze-target.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', '补充数据');
const wiki = JSON.parse(readFileSync(join(here, '..', '..', 'data', 'pets.json'), 'utf8'));
const byGameId = new Map(wiki.pets.map((p) => [p.game_id, p]));
const GROUPS = wiki.eggGroups;

const accounts = [];
const all = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const items = data.collections.petBackpack.items.map((pet) => {
    const entry = byGameId.get(pet.speciesPetId);
    return {
      account: data.meta.playerName,
      name: pet.spriteName,
      gender: pet.gender,
      nature: pet.nature,
      voice: pet.voiceDb,
      body: pet.medalBody,
      shiny: pet.isShiny,
      groups: entry?.egg_group ?? [],
      number: entry?.number ?? '',
    };
  });
  accounts.push({ name: data.meta.playerName, items });
  all.push(...items);
}

const perfect = all.filter((p) => p.voice === 100);
console.log(`四个账号合计精灵 ${all.length} 只，其中 voiceDb = 100（满分）的 ${perfect.length} 只`);
const dupCount = new Map();
for (const p of perfect) dupCount.set(p.name, (dupCount.get(p.name) ?? 0) + 1);
console.log(`满分涉及 ${dupCount.size} 个物种；重复最多的: ${[...dupCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n}×${c}`).join('、')}`);

console.log('\n按账号:');
for (const account of accounts) {
  const own = account.items.filter((p) => p.voice === 100);
  console.log(`  ${account.name}: 满分 ${own.length} 只（总精灵 ${account.items.length}）`);
}

const tally = (list, pick) => {
  const map = new Map();
  for (const item of list) {
    const key = pick(item) || '(无)';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};

console.log('\n满分精灵的性别:', tally(perfect, (p) => p.gender).map(([k, c]) => `${k}=${c}`).join(' '));
console.log('满分精灵的体型奖牌:', tally(perfect, (p) => p.body).map(([k, c]) => `${k}=${c}`).join(' '));
console.log('满分精灵的性格:', tally(perfect, (p) => p.nature).map(([k, c]) => `${k}=${c}`).join(' '));

console.log('\n满分精灵的蛋组覆盖（一只双蛋组会算两次）:');
const groupCount = new Map();
for (const p of perfect) for (const g of p.groups) groupCount.set(g, (groupCount.get(g) ?? 0) + 1);
for (let id = 2; id <= 15; id += 1) {
  const list = perfect.filter((p) => p.groups.includes(id));
  console.log(`  ${GROUPS[id].padEnd(4, '　')} 满分 ${String(list.length).padStart(3)} 只 | 其中公 ${list.filter((p) => p.gender === '公').length}、大块头 ${list.filter((p) => p.body === '大块头').length}`);
}

const studs = perfect.filter((p) => p.gender === '公' && p.body === '大块头');
console.log(`\n★ 现成的「大块头 + 公 + 满分」: ${studs.length} 只`);
console.log(tally(studs, (p) => p.nature).map(([k, c]) => `  ${k}: ${c} 只`).join('\n'));
