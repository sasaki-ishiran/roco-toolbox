#!/usr/bin/env node
/**
 * 网页发版唯一入口（防复发，2026-11-10 正式站被误顶事故后新增）。
 *
 * 约定（重要）：
 *   1. 正式站（--branch main）只读：只有用户明确说「放量 / 发正式」时才允许部署，
 *      并且必须显式带 --approve-production，否则脚本直接中止。
 *   2. 部署前必须打印并核对 bundle 文件名与 SHA-256；可加 --expect-hash 做严格比对。
 *   3. 正式站 bundle 里不允许出现「收集计划」文案（那是内测批次的功能）；
 *      凡是主线功能不该进正式的，都在这里加一条断言，不要靠记忆。
 *   4. 任何一条断言不通过，脚本以非 0 退出，不会调用 wrangler。
 *
 * 用法：
 *   node scripts/deploy-web.mjs --branch test
 *   node scripts/deploy-web.mjs --branch main --approve-production
 *   node scripts/deploy-web.mjs --branch main --approve-production --dry-run
 *   node scripts/deploy-web.mjs --branch main --approve-production --expect-hash <sha256>
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const PROJECT = 'roco-toolbox';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const branch = value('--branch');
const dryRun = flag('--dry-run');
const approveProduction = flag('--approve-production');
const expectHash = value('--expect-hash');

const fail = (message) => {
  console.error(`\n[发版中止] ${message}\n`);
  process.exit(1);
};

if (branch !== 'test' && branch !== 'main') {
  fail('必须显式指定 --branch test 或 --branch main（不带默认值，避免误发正式）。');
}
if (branch === 'main' && !approveProduction) {
  fail('正式站只读：没有用户明确的「放量 / 发正式」指令时，不允许部署 main。\n' +
    '确认要发时重新执行并加 --approve-production。');
}
if (!existsSync(join(DIST, 'index.html'))) {
  fail('dist/index.html 不存在，先跑 npm run build。');
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const bundleRel = (html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1];
if (!bundleRel) fail('dist/index.html 里找不到 /assets/index-*.js，构建产物不完整。');

const bundlePath = join(DIST, 'assets', bundleRel);
if (!existsSync(bundlePath)) fail(`找不到构建产物 ${bundlePath}。`);

const bundle = readFileSync(bundlePath);
const hash = createHash('sha256').update(bundle).digest('hex');
const text = bundle.toString('utf8');

const checks = [
  { name: '切服桥 RocoServer', ok: text.includes('RocoServer'), need: true },
  { name: '内测批次文案「收集计划」', ok: text.includes('收集计划'), need: branch === 'test' },
];

console.log('=== 网页发版检查 ===');
console.log(`目标分支 : ${branch}${dryRun ? '（演练，不部署）' : ''}`);
console.log(`bundle   : ${bundleRel}`);
console.log(`SHA-256  : ${hash}`);
console.log(`大小     : ${bundle.length} 字节`);
for (const c of checks) {
  console.log(`${c.ok === c.need ? '✓' : '✗'} ${c.name}: ${c.ok ? '存在' : '不存在'}（要求${c.need ? '存在' : '不存在'}）`);
}

if (expectHash && expectHash !== hash) {
  fail(`bundle 哈希与 --expect-hash 不一致：\n  实际 ${hash}\n  期望 ${expectHash}`);
}
const bad = checks.filter((c) => c.ok !== c.need);
if (bad.length) {
  fail(`内容断言未通过：${bad.map((c) => c.name).join('、')}。正式站不接受内测批次构建。`);
}

if (dryRun) {
  console.log('\n演练通过，未执行部署（去掉 --dry-run 才会调用 wrangler）。');
  process.exit(0);
}

console.log(`\n开始部署到 ${branch} …`);
execFileSync('npx', ['wrangler', 'pages', 'deploy', 'dist', '--project-name', PROJECT, '--branch', branch, '--commit-dirty=true'], {
  stdio: 'inherit',
  shell: true,
});
