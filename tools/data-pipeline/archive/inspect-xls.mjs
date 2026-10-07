// 只读探测「大块头区间统计」表格的结构。
// 用法：node inspect-xls.mjs

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import XLSX from 'xlsx';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', '补充数据');
const file = readdirSync(dir).find((f) => f.toLowerCase().endsWith('.xls'));
const path = join(dir, file);

const book = XLSX.readFile(path);
console.log(`文件: ${file}`);
console.log(`工作表: ${book.SheetNames.join(' | ')}\n`);

for (const name of book.SheetNames) {
  const sheet = book.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  console.log(`${'='.repeat(60)}\n工作表「${name}」 共 ${rows.length} 行`);
  for (const row of rows.slice(0, 25)) {
    console.log(row.map((cell) => (cell === undefined ? '' : String(cell))).join(' | '));
  }
  console.log('');
}
