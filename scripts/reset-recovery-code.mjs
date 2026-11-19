#!/usr/bin/env node
/**
 * 运维：给指定账号重置恢复码（2026-11-12）。
 *
 * 只给运维侧本地使用，不新开公开接口：脚本直接走 `wrangler d1 execute`，
 * 需要本机已登录 Cloudflare；服务端仍然只存 SHA-256 哈希，明文只打印一次。
 *
 * 用法：
 *   node scripts/reset-recovery-code.mjs --account 72e6cb4d --dry-run
 *   node scripts/reset-recovery-code.mjs --account 72e6cb4d
 *
 * --account 支持账号 id 前缀；前缀必须唯一，避免误伤。
 */
import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

const accountArg = arg('--account');
const dryRun = process.argv.includes('--dry-run');
if (!accountArg || !/^[0-9a-fA-F-]{8,36}$/.test(accountArg)) {
  console.error('用法：node scripts/reset-recovery-code.mjs --account <账号id前缀> [--dry-run]');
  process.exit(2);
}

function query(sql) {
  const cmd = `npx wrangler d1 execute roco-toolbox-db --remote --json --command "${sql.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const start = out.indexOf('[');
  const parsed = JSON.parse(out.slice(start));
  return parsed[0].results ?? [];
}

function newRecoveryCode() {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}

const normalize = (input) => input.toUpperCase().replace(/[^0-9A-Z]/g, '');
const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const rows = query(
  `SELECT id, label, created_at, last_seen_at FROM accounts WHERE id LIKE '${accountArg.toLowerCase()}%'`,
);
if (rows.length === 0) {
  console.error('没有匹配的账号，检查前缀。');
  process.exit(1);
}
if (rows.length > 1) {
  console.error(`前缀 ${accountArg} 匹配到 ${rows.length} 个账号，请给更长的前缀：`);
  for (const row of rows) console.error(`  ${row.id}  created=${row.created_at}`);
  process.exit(1);
}

const account = rows[0];
const code = newRecoveryCode();
const hash = sha256Hex(normalize(code));

console.log(`账号：${account.id}`);
console.log(`备注：${account.label ?? '（无）'}`);
console.log(`建号：${new Date(Number(account.created_at)).toISOString()}`);
console.log(`最近活动：${new Date(Number(account.last_seen_at)).toISOString()}`);

if (dryRun) {
  console.log(`[dry-run] 新恢复码（未写入）：${code}`);
  process.exit(0);
}

query(`UPDATE accounts SET recovery_hash = '${hash}' WHERE id = '${account.id}'`);
const check = query(`SELECT recovery_hash FROM accounts WHERE id = '${account.id}'`);
if (check.length !== 1 || check[0].recovery_hash !== hash) {
  console.error('重置后校验失败：数据库里的哈希与预期不一致，请立即人工核查。');
  process.exit(1);
}

console.log(`新恢复码（只显示这一次）：${code}`);
console.log('注意：旧恢复码已立即失效；在已登录的设备上「重新生成恢复码」也会让这张失效。');
