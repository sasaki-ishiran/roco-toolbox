// 判定「大块头」用 >= 还是 >：找体重正好等于区间表大块头阈值的精灵，看它有没有大块头奖牌。
// 用法：node check-threshold-boundary.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import XLSX from 'xlsx';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', '补充数据');
const norm = (name) => String(name ?? '').split(/[（(_]/)[0].trim();

const sheet = XLSX.readFile(join(dir, readdirSync(dir).find((f) => f.toLowerCase().endsWith('.xls')))).Sheets.Sheet1;
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }).slice(1);
const ranges = new Map();
for (const row of rows) {
  const [, name, huge] = row;
  if (name) ranges.set(norm(name), Number(huge));
}

const atThreshold = [];
const atMax = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  for (const p of data.collections.petBackpack.items) {
    const huge = ranges.get(norm(p.spriteName));
    if (huge === undefined) continue;
    const kg = p.weightGrams / 1000;
    if (Math.abs(kg - huge) < 1e-9) atThreshold.push(p);
  }
}

const tally = (list, key) => {
  const map = new Map();
  for (const p of list) map.set(p[key] || '(空)', (map.get(p[key] || '(空)') ?? 0) + 1);
  return [...map.entries()].map(([k, c]) => `${k}=${c}`).join(' ');
};

console.log(`体重正好等于区间表「大块头」阈值的精灵: ${atThreshold.length} 只`);
console.log(`  它们的 medalBody 分布: ${tally(atThreshold, 'medalBody')}`);
console.log(`  它们的 weightPercent 范围: ${atThreshold.length ? `${Math.min(...atThreshold.map((p) => p.weightPercent))}% ~ ${Math.max(...atThreshold.map((p) => p.weightPercent))}%` : '无'}`);
const examples = atThreshold.slice(0, 8).map((p) => `${p.spriteName} ${p.weightKg}kg 奖牌=${p.medalBody || '无'} 百分位=${p.weightPercent}%`);
for (const e of examples) console.log(`    ${e}`);
