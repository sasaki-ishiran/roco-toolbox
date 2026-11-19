#!/usr/bin/env node
/**
 * 运维：给指定账号重置密码（2026-11-18）。
 *
 * 网页端没有「忘记密码」自助找回，用户忘了密码就找管理员用这个脚本重置。
 * 只给运维侧本地使用，不新开公开接口：脚本直接走 `wrangler d1 execute`，
 * 需要本机已登录 Cloudflare；库里只存 PBKDF2 哈希，明文只打印一次。
 *
 * 用法：
 *   node scripts/reset-password.mjs --username 小明 --dry-run
 *   node scripts/reset-password.mjs --username 小明
 *   node scripts/reset-password.mjs --username 小明 --password 新的密码
 *
 * 不给 --password 时生成一个 10 位随机密码（去掉了容易看错的字符）。
 */
import { execSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

/** 必须与 functions/_lib/util.ts 的 PASSWORD_ITERATIONS 一致，否则登录验不过 */
const ITERATIONS = 10_000;
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const username = (arg('--username') ?? '').trim();
const providedPassword = arg('--password');
const dryRun = process.argv.includes('--dry-run');

if (!username || !/^[A-Za-z0-9_\u4e00-\u9fa5]{3,16}$/.test(username)) {
  console.error('用法：node scripts/reset-password.mjs --username <用户名> [--password <新密码>] [--dry-run]');
  process.exit(2);
}

const password =
  providedPassword ??
  [...randomBytes(10)].map((byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]).join('');
if (password.length < 8 || password.length > 32) {
  console.error('密码需为 8-32 位。');
  process.exit(2);
}

function query(sql) {
  const cmd = `npx wrangler d1 execute roco-toolbox-db --remote --json --command "${sql.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const start = out.indexOf('[');
  const parsed = JSON.parse(out.slice(start));
  return parsed[0].results ?? [];
}

function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(plain, salt, ITERATIONS, 32, 'sha256');
  return `pbkdf2$${ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

const rows = query(
  `SELECT id, username, created_at FROM accounts WHERE username_lower = '${username.toLowerCase()}'`,
);
if (rows.length === 0) {
  console.error(`没有找到用户名 ${username} 的账号。用户需要先在应用里设置用户名。`);
  process.exit(1);
}
if (rows.length > 1) {
  console.error(`用户名 ${username} 匹配到 ${rows.length} 个账号，数据异常，请人工核查。`);
  process.exit(1);
}

const account = rows[0];
console.log(`账号：${account.id}`);
console.log(`用户名：${account.username}`);
console.log(`建号：${new Date(Number(account.created_at)).toISOString()}`);

if (dryRun) {
  console.log(`[dry-run] 新密码（未写入）：${password}`);
  process.exit(0);
}

const hash = hashPassword(password);
query(`UPDATE accounts SET password_hash = '${hash}' WHERE id = '${account.id}'`);
const check = query(`SELECT password_hash FROM accounts WHERE id = '${account.id}'`);
if (check.length !== 1 || check[0].password_hash !== hash) {
  console.error('重置后校验失败：数据库里的哈希与预期不一致，请立即人工核查。');
  process.exit(1);
}

console.log(`新密码（只显示这一次）：${password}`);
console.log('注意：旧密码已立即失效，请通过可信渠道单独发给本人。');
