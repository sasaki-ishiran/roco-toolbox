// 母本集齐度：按进化链统计"是否已有至少一只母本"。用法：node analyze-mother-coverage.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const wiki = JSON.parse(readFileSync(join(root, 'data', 'pets.json'), 'utf8'));
const GROUPS = wiki.eggGroups;
const byGameId = new Map(wiki.pets.map((p) => [p.game_id, p]));

// 只保留可孵蛋的进化链（链内任一成员含 1 以外的蛋组）
const chains = new Map();
for (const pet of wiki.pets) {
  const key = pet.evolution_id ?? pet.key;
  if (!chains.has(key)) chains.set(key, []);
  chains.get(key).push(pet);
}
const breedableChains = [...chains.entries()].filter(([, members]) =>
  members.some((p) => (p.egg_group ?? []).some((g) => g !== 1)),
);

const ownedRows = [];
for (const file of readdirSync(join(root, '补充数据')).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(root, '补充数据', file), 'utf8'));
  for (const pet of data.collections.petBackpack.items) {
    const species = byGameId.get(pet.speciesPetId);
    if (!species) continue;
    ownedRows.push({ ...pet, species, chain: species.evolution_id ?? species.key, groups: species.egg_group.filter((g) => g !== 1) });
  }
}

const mothersByChain = new Map();
for (const row of ownedRows) {
  if (row.gender !== '母') continue;
  if (row.groups.length === 0) continue; // 未发现组不可孵蛋
  if (!mothersByChain.has(row.chain)) mothersByChain.set(row.chain, []);
  mothersByChain.get(row.chain).push(row);
}

const missingChains = breedableChains.filter(([key]) => !mothersByChain.has(key));
console.log(`可孵蛋进化链总数: ${breedableChains.length}`);
console.log(`已有母本的链: ${mothersByChain.size}`);
console.log(`还缺母本的链: ${missingChains.length}（集齐度 ${(100 * mothersByChain.size / breedableChains.length).toFixed(1)}%）`);

// 缺母本的链，按蛋组统计（一个链可能涉及多个蛋组）
const missingByGroup = new Map();
for (const [, members] of missingChains) {
  const groups = new Set();
  for (const member of members) for (const g of member.egg_group ?? []) if (g !== 1) groups.add(g);
  for (const g of groups) missingByGroup.set(g, (missingByGroup.get(g) ?? 0) + 1);
}
console.log('\n缺母本的链在各蛋组的分布:');
for (let g = 2; g <= 15; g += 1) console.log(`  ${GROUPS[g]}: ${missingByGroup.get(g) ?? 0}`);

console.log('\n缺母本的链（前 20 条）:');
for (const [, members] of missingChains.slice(0, 20)) {
  const names = members.map((p) => p.name).join(' → ');
  const groups = [...new Set(members.flatMap((p) => p.egg_group ?? []).filter((g) => g !== 1))].map((g) => GROUPS[g]).join('/');
  console.log(`  ${members[0].number} ${names}（${groups}）`);
}
