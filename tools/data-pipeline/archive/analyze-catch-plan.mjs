// 结合现有大婉满分精灵，分析该抓哪些双蛋组精灵最划算。
// 用法：node analyze-catch-plan.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const wiki = JSON.parse(readFileSync(join(root, 'data', 'pets.json'), 'utf8'));
const pvp = JSON.parse(readFileSync(join(root, 'data', 'pvp-natures.json'), 'utf8'));
const natureTable = JSON.parse(readFileSync(join(root, 'data', 'natures.json'), 'utf8')).natures;
const GROUPS = wiki.eggGroups;
const natureName = new Map(natureTable.map((n) => [n.id, n.name]));
const natureIdByName = new Map(natureTable.map((n) => [n.name, n.id]));

const byGameId = new Map(wiki.pets.map((p) => [p.game_id, p]));

// ---- 目标清单：14 蛋组 × 前 3 性格 ----
const targets = [];
for (const [groupId, ids] of Object.entries(pvp.targetNatures)) {
  for (const natureId of ids) targets.push({ groupId: Number(groupId), natureId, nature: natureName.get(natureId) });
}
const targetKey = (groupId, natureId) => `${groupId}:${natureId}`;
const targetSet = new Set(targets.map((t) => targetKey(t.groupId, t.natureId)));

// ---- 现有大婉满分精灵 ----
const owned = [];
for (const file of readdirSync(join(root, '补充数据')).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(root, '补充数据', file), 'utf8'));
  for (const pet of data.collections.petBackpack.items) {
    if (pet.voiceDb !== 100 || pet.medalBody !== '大块头') continue;
    const species = byGameId.get(pet.speciesPetId);
    if (!species) continue;
    const groups = species.egg_group.filter((g) => g !== 1);
    if (groups.length === 0) continue;
    owned.push({
      account: data.meta.playerName,
      name: pet.spriteName,
      gender: pet.gender,
      nature: pet.nature,
      groups,
      isShiny: pet.isShiny,
      number: species.number,
    });
  }
}

const covered = new Map();
for (const pet of owned) {
  if (pet.gender !== '公') continue;
  const natureId = natureIdByName.get(pet.nature);
  if (natureId === undefined) continue;
  for (const groupId of pet.groups) {
    if (!targetSet.has(targetKey(groupId, natureId))) continue;
    const key = targetKey(groupId, natureId);
    if (!covered.has(key)) covered.set(key, []);
    covered.get(key).push(pet);
  }
}

console.log(`目标总数 ${targets.length}（14 蛋组 × 前 3 性格）`);
console.log(`现有「大块头 + 公 + 满分」精灵 ${owned.filter((p) => p.gender === '公').length} 只（另有大块头满分母 ${owned.filter((p) => p.gender === '母').length} 只）`);
console.log(`已覆盖目标 ${covered.size} / ${targets.length}，还缺 ${targets.length - covered.size}\n`);

console.log('=== 已覆盖的目标 ===');
for (const target of targets) {
  const hit = covered.get(targetKey(target.groupId, target.natureId));
  if (!hit) continue;
  console.log(`  ${GROUPS[target.groupId]} × ${target.nature} → ${hit.map((p) => `${p.name}[${p.account}${p.isShiny ? ' 异色' : ''}]`).join('、')}`);
}

const missing = targets.filter((t) => !covered.has(targetKey(t.groupId, t.natureId)));
console.log(`\n=== 还缺的目标（${missing.length}）===`);
for (const groupId of Object.keys(GROUPS).map(Number).filter((g) => g !== 1)) {
  const list = missing.filter((t) => t.groupId === groupId).map((t) => t.nature);
  if (list.length) console.log(`  ${GROUPS[groupId]}: ${list.join('、')}`);
}

// ---- 双蛋组候选 ----
const missingSet = new Set(missing.map((t) => targetKey(t.groupId, t.natureId)));
const candidates = [];
for (const species of wiki.pets) {
  const groups = species.egg_group.filter((g) => g !== 1);
  if (groups.length !== 2) continue;
  const catchable = (species.ecology?.areas?.length ?? 0) > 0;
  const canBeMale = (species.gender_ratio?.male ?? 0) > 0;
  if (!catchable || !canBeMale) continue;

  // 两组目标性格的交集：同一只种公能同时顶两个组
  const [g1, g2] = groups;
  const t1 = new Set(pvp.targetNatures[g1] ?? []);
  const t2 = new Set(pvp.targetNatures[g2] ?? []);
  const shared = [...t1].filter((id) => t2.has(id));
  const sharedMissing = shared.filter((id) => missingSet.has(targetKey(g1, id)) && missingSet.has(targetKey(g2, id)));
  const sharedHalf = shared.filter((id) => missingSet.has(targetKey(g1, id)) !== missingSet.has(targetKey(g2, id)));
  const recommended = pvp.recommendations[String(species.game_id)];

  candidates.push({
    species,
    g1,
    g2,
    shared,
    sharedMissing,
    sharedHalf,
    recommended,
    ownedCount: owned.filter((p) => p.groups.includes(g1) && p.groups.includes(g2)).length,
  });
}

const rank = (a, b) =>
  b.sharedMissing.length - a.sharedMissing.length ||
  b.sharedHalf.length - a.sharedHalf.length ||
  b.shared.length - a.shared.length ||
  a.species.number.localeCompare(b.species.number);

// 蛋组对汇总：哪些两组的目标性格完全一致（拿一只种公能同时顶两个组）
const pairStats = new Map();
for (const c of candidates) {
  const key = `${Math.min(c.g1, c.g2)}-${Math.max(c.g1, c.g2)}`;
  if (!pairStats.has(key)) pairStats.set(key, { g1: Math.min(c.g1, c.g2), g2: Math.max(c.g1, c.g2), list: [], shared: c.shared, sharedMissing: c.sharedMissing });
  pairStats.get(key).list.push(c);
}
const goldenPairs = [...pairStats.values()]
  .filter((pair) => pair.sharedMissing.length >= 2)
  .sort((a, b) => b.sharedMissing.length - a.sharedMissing.length);

console.log('\n=== 黄金蛋组对：一组性格能同时补齐两个组 ===');
for (const pair of goldenPairs) {
  const natures = pair.sharedMissing.map((id) => natureName.get(id)).join('、');
  console.log(`  ${GROUPS[pair.g1]} × ${GROUPS[pair.g2]}：共同目标性格 ${pair.shared.map((id) => natureName.get(id)).join('/')}，其中还缺 ${natures}（${pair.list.length} 个物种可选）`);
}

// 按进化链去重后的候选（同一形态的进化链只留基础形态）
const families = new Map();
for (const c of candidates.sort(rank)) {
  const key = c.species.evolution_id ?? c.species.key;
  if (!families.has(key)) families.set(key, []);
  families.get(key).push(c);
}

// 现有满分大块头母（可做母本，直接配出该物种的后代）
const breederMothers = owned.filter((p) => p.gender === '母');
const familyHasMother = (species) =>
  breederMothers.filter((p) => {
    const mother = byGameId.get(p.speciesPetId);
    return mother && (mother.evolution_id ?? mother.key) === (species.evolution_id ?? species.key);
  });

console.log('\n=== 按进化链去重后的优先候选（前 15 条链）===');
let shown = 0;
for (const [key, members] of [...families.entries()].sort((a, b) => rank(a[1][0], b[1][0]))) {
  if (shown >= 15) break;
  shown += 1;
  const best = members[0];
  const base = members.reduce((low, cur) => ((cur.species.stage ?? 99) < (low.species.stage ?? 99) ? cur : low), members[0]);
  const chain = members.map((m) => m.species.name).join(' → ');
  const mothers = familyHasMother(best.species);
  const rec = best.recommended ? best.recommended.name : '无';
  console.log(
    `  ${best.species.number} ${chain}（${GROUPS[best.g1]}×${GROUPS[best.g2]}）| 目标性格 ${best.sharedMissing.map((id) => natureName.get(id)).join('/')} | PVP推荐 ${rec} | 建议抓基础形态 ${base.species.name} | ${mothers.length ? `★已有满分大块头母：${mothers.map((m) => m.name).join('、')}` : '无现成母本'}`,
  );
}

console.log('\n=== 逐个缺口目标的最佳候选 ===');
for (const target of missing) {
  const list = candidates
    .filter((c) => (c.g1 === target.groupId || c.g2 === target.groupId) && c.shared.includes(target.natureId))
    .slice(0, 3)
    .map((c) => `${c.species.name}(${GROUPS[c.g1 === target.groupId ? c.g2 : c.g1]}侧)`);
  console.log(`  ${GROUPS[target.groupId]} × ${target.nature}: ${list.length ? list.join('、') : '（无双蛋组候选，需单蛋组或孵蛋）'}`);
}

console.log('\n=== 现有「大块头 + 满分」母本（可用来量产同物种后代）===');
const mothers = owned.filter((p) => p.gender === '母');
for (const mother of mothers) {
  const species = byGameId.get(Number(Object.entries(pvp.recommendations).find(([, v]) => v.name === mother.nature)?.[0] ?? 0)) ?? null;
  console.log(
    `  ${mother.number} ${mother.name}（${mother.groups.map((g) => GROUPS[g]).join('/')}）性格 ${mother.nature} | ${mother.account}`,
  );
}
const motherGroupCount = new Map();
for (const mother of mothers) for (const g of mother.groups) motherGroupCount.set(g, (motherGroupCount.get(g) ?? 0) + 1);
console.log('  母本覆盖的蛋组:', [...motherGroupCount.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${GROUPS[g]}${n}`).join(' '));
