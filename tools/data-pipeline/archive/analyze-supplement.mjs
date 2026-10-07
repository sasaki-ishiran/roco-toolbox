// 交叉分析：four 账号备份的声音/体型字段，以及与 wiki 图鉴的收集度。
// 用法：node analyze-supplement.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', '补充数据');
const wiki = JSON.parse(readFileSync(join(here, '..', '..', 'data', 'pets.json'), 'utf8'));

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
// 注意：备份里的 runtimePetId 与 wiki 的 key 不是同一套编号，经常指向别的精灵
// （例如机械方方的 runtimePetId 是 pet_000193 菊花梨）。正确连接键是
// 备份的 speciesPetId ↔ wiki 的 game_id，两边都是 1:1。
const wikiByGameId = new Map(wiki.pets.map((p) => [p.game_id, p]));
const ownedWikiKeys = new Set();
const ownedNames = new Set();
const voiceValues = new Map();
const medalVoiceValues = new Map();
const medalBodyValues = new Map();

for (const file of files) {
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const items = data.collections.petBackpack.items;
  const voices = items.map((p) => p.voiceDb).filter((v) => typeof v === 'number');
  const positive = voices.filter((v) => v > 0).length;
  const negative = voices.filter((v) => v < 0).length;
  const zero = voices.filter((v) => v === 0).length;

  const tally = (map, value) => map.set(value, (map.get(value) ?? 0) + 1);
  for (const p of items) {
    tally(voiceValues, p.voiceDb);
    tally(medalVoiceValues, p.medalVoice || '(空)');
    tally(medalBodyValues, p.medalBody || '(空)');
    ownedNames.add(p.spriteName);
    const matchedPet = wikiByGameId.get(p.speciesPetId);
    if (matchedPet) ownedWikiKeys.add(matchedPet.key);
  }

  console.log(`【${data.meta.playerName}】精灵 ${items.length} 只 | 物种 ${new Set(items.map((p) => p.spriteName)).size} 种`);
  console.log(`  声音 dB: 最小 ${Math.min(...voices)} 最大 ${Math.max(...voices)} 取值 ${new Set(voices).size} 种 | 正 ${positive} 零 ${zero} 负 ${negative}`);
  console.log(`  蛋仓库 ${data.collections.eggInventory?.eggs?.length ?? 0} 个 | 已有果实 ${data.collections.fruits?.length ?? 0} 种`);
}

console.log('\n=== voiceDb 取值分布（前 20 个最常见）===');
console.log([...voiceValues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([v, c]) => `${v}:${c}`).join('  '));

console.log('\n=== medalVoice 取值分布 ===');
console.log([...medalVoiceValues.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => `${v}:${c}`).join('  '));

console.log('\n=== medalBody 取值分布 ===');
console.log([...medalBodyValues.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => `${v}:${c}`).join('  '));

console.log('\n=== 与 wiki 图鉴对照 ===');
console.log(`wiki 图鉴 ${wiki.pets.length} 种；四个账号合计拥有（按 speciesPetId ↔ game_id 去重）${ownedWikiKeys.size} 种`);
const missing = wiki.pets.filter((p) => !ownedWikiKeys.has(p.key));
console.log(`图鉴里四个账号都还没有的: ${missing.length} 种`);
console.log(`  样例: ${missing.slice(0, 15).map((p) => `${p.number}${p.name}`).join('、')}`);
