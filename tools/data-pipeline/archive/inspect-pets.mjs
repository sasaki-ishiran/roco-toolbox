// 只读探测账号备份里精灵记录的完整字段。
// 用法：node inspect-pets.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', '补充数据');
const file = readdirSync(dir).find((f) => f.startsWith('测试甲') && f.endsWith('.json'));
const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));

const items = data.collections.petBackpack.items;
console.log(`账号 ${data.meta.playerName}，精灵 ${items.length} 只\n`);

console.log('=== 第一只精灵的完整记录 ===');
console.log(JSON.stringify(items[0], null, 2));

const fieldCount = new Map();
for (const item of items) {
  for (const key of Object.keys(item)) fieldCount.set(key, (fieldCount.get(key) ?? 0) + 1);
}
console.log('\n=== 所有出现过的字段（次数 / 总只数）===');
for (const [key, count] of [...fieldCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${key} : ${count}/${items.length}`);
}

console.log('\n=== 第二只精灵（看嵌套结构）===');
console.log(JSON.stringify(items[1], null, 2));

const eggs = data.collections.eggInventory?.eggs ?? [];
console.log(`\n=== 蛋仓库（${eggs.length} 个），第一个 ===`);
console.log(JSON.stringify(eggs[0], null, 2));
