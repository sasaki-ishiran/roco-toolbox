// 交叉验证：声音奖牌阈值、体型奖牌阈值、区间表判定蛋的体型。
// 用法：node analyze-voice-size.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import XLSX from 'xlsx';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', '补充数据');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const xlsFile = readdirSync(dir).find((f) => f.toLowerCase().endsWith('.xls'));

const norm = (name) => String(name ?? '').split(/[（(_]/)[0].trim();

// ---- 读区间表 ----
const sheet = XLSX.readFile(join(dir, xlsFile)).Sheets.Sheet1;
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }).slice(1);
const ranges = new Map();
let currentTier = '';
for (const row of rows) {
  const [tier, name, huge, max, interval] = row;
  if (tier) currentTier = tier;
  if (!name) continue;
  ranges.set(norm(name), { tier: currentTier, name, huge: Number(huge), max: Number(max), interval: Number(interval) });
}

const tierCount = new Map();
let intervalMatches = 0;
for (const r of ranges.values()) {
  tierCount.set(r.tier, (tierCount.get(r.tier) ?? 0) + 1);
  if (Math.abs(r.max - r.huge - r.interval) < 1e-9) intervalMatches += 1;
}
console.log(`区间表: ${ranges.size} 只精灵，${tierCount.size} 个档位`);
console.log(`  档位分布: ${[...tierCount.entries()].map(([t, c]) => `${t}=${c}`).join(' ')}`);
console.log(`  极限值 - 大块头 = 区间 成立的条数: ${intervalMatches}/${ranges.size}`);

// ---- 声音 / 体型奖牌阈值 ----
const voice = new Map();
const body = new Map();
let newestSpecies = null;
for (const file of files) {
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  for (const p of data.collections.petBackpack.items) {
    const key = p.medalVoice || '(无奖牌)';
    const v = voice.get(key) ?? { min: 999, max: -999, n: 0 };
    v.min = Math.min(v.min, p.voiceDb); v.max = Math.max(v.max, p.voiceDb); v.n += 1;
    voice.set(key, v);

    const bk = p.medalBody || '(无奖牌)';
    const b = body.get(bk) ?? { min: 999, max: -999, n: 0 };
    b.min = Math.min(b.min, p.weightPercent); b.max = Math.max(b.max, p.weightPercent); b.n += 1;
    body.set(bk, b);
    if (p.runtimePetId === 'pet_000533') newestSpecies = `${p.spriteName} / ${p.name}`;
  }
}
console.log('\n声音奖牌 vs voiceDb 范围:');
for (const [k, v] of voice) console.log(`  ${k}: ${v.min} ~ ${v.max}（${v.n} 只）`);
console.log('体型奖牌 vs 体重百分位范围:');
for (const [k, v] of body) console.log(`  ${k}: ${v.min}% ~ ${v.max}%（${v.n} 只）`);
console.log(`\n备份里有、wiki 里没有的物种 pet_000533 = ${newestSpecies}`);

// ---- 用区间表判定蛋的体型 ----
console.log('\n=== 用区间表判定四个账号蛋仓库里的蛋 ===');
for (const file of files) {
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const eggs = data.collections.eggInventory?.eggs ?? [];
  const stat = { 满重: 0, 大块头: 0, 普通: 0, 小不点: 0, 无阈值: 0 };
  for (const egg of eggs) {
    const range = ranges.get(norm(egg.petName));
    const kg = egg.weightGrams / 1000;
    if (!range) { stat.无阈值 += 1; continue; }
    if (Math.abs(kg - range.max) < 1e-9) stat.满重 += 1;
    else if (kg >= range.huge) stat.大块头 += 1;
    else stat.普通 += 1;
  }
  console.log(`  ${data.meta.playerName}: ${eggs.length} 个蛋 -> 满重 ${stat.满重}、大块头 ${stat.大块头}、普通 ${stat.普通}、表里没有 ${stat.无阈值}`);
}
