// 验证：精灵自身体重 与 区间表的蛋重阈值 是不是同一套刻度。
// 用法：node check-weight-scale.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import XLSX from 'xlsx';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', '补充数据');
const norm = (name) => String(name ?? '').split(/[（(_]/)[0].trim();

const sheet = XLSX.readFile(join(dir, readdirSync(dir).find((f) => f.toLowerCase().endsWith('.xls')))).Sheets.Sheet1;
const ranges = new Map();
for (const row of XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }).slice(1)) {
  const [, name, huge, max] = row;
  if (name) ranges.set(norm(name), { huge: Number(huge), max: Number(max) });
}

const buckets = { 大块头: { above: 0, below: 0, ratios: [] }, 小不点: { above: 0, below: 0, ratios: [] }, 无: { above: 0, below: 0, ratios: [] } };
const samples = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  for (const p of data.collections.petBackpack.items) {
    const range = ranges.get(norm(p.spriteName));
    if (!range) continue;
    const kg = p.weightGrams / 1000;
    const bucket = p.medalBody || '无';
    if (!buckets[bucket]) continue;
    if (kg >= range.huge) buckets[bucket].above += 1; else buckets[bucket].below += 1;
    buckets[bucket].ratios.push(kg / range.huge);
    if (samples.length < 6) samples.push(`${p.spriteName} 体重 ${kg}kg | 表阈值 ${range.huge}kg | 比值 ${(kg / range.huge).toFixed(2)} | 奖牌 ${p.medalBody || '无'}`);
  }
}

console.log('精灵自身体重 vs 区间表蛋重阈值（按体型奖牌分组）:');
for (const [k, v] of Object.entries(buckets)) {
  if (v.ratios.length === 0) continue;
  const sorted = [...v.ratios].sort((a, b) => a - b);
  console.log(`  ${k}: ${v.ratios.length} 只 | 体重≥表阈值 ${v.above} 只，<表阈值 ${v.below} 只 | 体重/阈值 中位 ${sorted[Math.floor(sorted.length / 2)].toFixed(2)} 范围 ${sorted[0].toFixed(2)}~${sorted[sorted.length - 1].toFixed(2)}`);
}
console.log('\n样例:');
for (const s of samples) console.log('  ' + s);
