// 只读探测「补充数据」文件夹里的 JSON 结构。
// 用法：node inspect-supplement.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', '补充数据');

const clip = (value) => {
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
};

function summarize(value, indent = '  ') {
  if (Array.isArray(value)) {
    console.log(`${indent}数组，长度 ${value.length}`);
    const first = value[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const keys = Object.keys(first);
      console.log(`${indent}首元素字段(${keys.length}): ${keys.join(', ')}`);
      for (const key of keys.slice(0, 40)) {
        console.log(`${indent}  ${key} = ${clip(first[key])}`);
      }
    } else if (first !== undefined) {
      console.log(`${indent}首元素: ${clip(first)}`);
    }
  } else if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    console.log(`${indent}对象，字段(${keys.length}): ${keys.slice(0, 40).join(', ')}`);
    for (const key of keys.slice(0, 12)) {
      const child = value[key];
      const kind = Array.isArray(child) ? `数组(${child.length})` : typeof child === 'object' && child !== null ? `对象(${Object.keys(child).length})` : clip(child);
      console.log(`${indent}  ${key}: ${kind}`);
    }
  } else {
    console.log(`${indent}${clip(value)}`);
  }
}

const jsonFiles = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
console.log(`发现 ${jsonFiles.length} 个 JSON 文件\n`);

for (const file of jsonFiles) {
  console.log('='.repeat(70));
  console.log(file);
  const raw = readFileSync(join(dir, file), 'utf8');
  console.log(`原始大小 ${(raw.length / 1024).toFixed(0)} KB`);
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    console.log(`JSON 解析失败: ${error.message}`);
    continue;
  }
  console.log('--- meta ---');
  for (const [key, value] of Object.entries(data.meta ?? {})) {
    console.log(`  ${key} = ${clip(value)}`);
  }

  console.log('--- collections ---');
  for (const [key, value] of Object.entries(data.collections ?? {})) {
    const size = Array.isArray(value) ? value.length : typeof value === 'object' ? Object.keys(value).length : clip(value);
    console.log(`  ${key}: ${Array.isArray(value) ? `数组(${size})` : `对象/值(${size})`}`);
    summarize(value, '    ');
  }

  console.log('--- rawProtocol ---');
  for (const [key, value] of Object.entries(data.rawProtocol ?? {})) {
    const size = Array.isArray(value) ? `数组(${value.length})` : typeof value === 'object' && value !== null ? `对象(${Object.keys(value).length})` : clip(value);
    console.log(`  ${key}: ${size}`);
  }
  console.log('');
}
