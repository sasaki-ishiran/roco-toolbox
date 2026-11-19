#!/usr/bin/env node
/**
 * 网页发版唯一入口（防复发，2026-11-10 正式站被误顶事故后新增）。
 *
 * 约定（重要）：
 *   1. 正式站（--branch main）只读：只有用户明确说「放量 / 发正式」时才允许部署，
 *      并且必须显式带 --approve-production，否则脚本直接中止。
 *   2. 部署前必须打印并核对 bundle 文件名与 SHA-256；可加 --expect-hash 做严格比对。
 *   3. 已下线功能的文案（如「收集计划」）不允许出现在任何通道的 bundle 里；
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
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const PROJECT = 'roco-toolbox';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const DIST = resolve(ROOT, value('--dist') ?? 'dist');
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
  // 收集计划已下线（2026-11-17 起 test 线不再带该功能），两个通道都不应再出现这四个字
  { name: '已下线的「收集计划」文案', ok: !text.includes('收集计划'), need: true },
];

// 正式清单校验（2026-11-11）：清单跟着 dist 一起发，所以每次发正式都必须确认
// 两份清单存在、可解析、版本一致，且 apkUrl 只指向正式包（不能混内测/测试站）。
const PROD_APK_URL = 'https://roco-toolbox-downloads.pages.dev/android/roco-toolbox-latest.apk';
const manifestProblems = [];
const manifestInfo = [];
if (branch === 'main') {
  for (const name of ['version.json', 'version-18.json']) {
    const file = join(DIST, 'android', name);
    if (!existsSync(file)) {
      manifestProblems.push(`缺少正式清单 dist/android/${name}`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      manifestProblems.push(`dist/android/${name} 不是合法 JSON：${error.message}`);
      continue;
    }
    if (!Number.isInteger(manifest.versionCode)
      || typeof manifest.versionName !== 'string'
      || typeof manifest.apkUrl !== 'string') {
      manifestProblems.push(`dist/android/${name} 缺少 versionCode / versionName / apkUrl`);
      continue;
    }
    if (manifest.apkUrl !== PROD_APK_URL) {
      manifestProblems.push(`dist/android/${name} 的 apkUrl 不是正式包：${manifest.apkUrl}`);
    }
    if (/test\.roco-toolbox\.pages\.dev|\/internal\//i.test(manifest.apkUrl)) {
      manifestProblems.push(`dist/android/${name} 的 apkUrl 指向内测：${manifest.apkUrl}`);
    }
    manifestInfo.push({
      name,
      versionName: manifest.versionName,
      versionCode: manifest.versionCode,
      apkUrl: manifest.apkUrl,
    });
  }
  if (manifestInfo.length === 2) {
    const [first, second] = manifestInfo;
    if (first.versionCode !== second.versionCode
      || first.versionName !== second.versionName
      || first.apkUrl !== second.apkUrl) {
      manifestProblems.push('version.json 与 version-18.json 不一致（版本号或 apkUrl）');
    }
  }
}

console.log('=== 网页发版检查 ===');
console.log(`目标分支 : ${branch}${dryRun ? '（演练，不部署）' : ''}`);
console.log(`产物目录 : ${DIST}`);
console.log(`bundle   : ${bundleRel}`);
console.log(`SHA-256  : ${hash}`);
console.log(`大小     : ${bundle.length} 字节`);
for (const c of checks) {
  console.log(`${c.ok === c.need ? '✓' : '✗'} ${c.name}: ${c.ok ? '存在' : '不存在'}（要求${c.need ? '存在' : '不存在'}）`);
}
if (branch === 'main') {
  console.log('--- 正式清单 ---');
  for (const m of manifestInfo) {
    console.log(`✓ dist/android/${m.name}: ${m.versionName} (${m.versionCode}) -> ${m.apkUrl}`);
  }
  for (const problem of manifestProblems) console.log(`✗ ${problem}`);
}

if (expectHash && expectHash !== hash) {
  fail(`bundle 哈希与 --expect-hash 不一致：\n  实际 ${hash}\n  期望 ${expectHash}`);
}
const bad = checks.filter((c) => c.ok !== c.need);
if (bad.length) {
  fail(`内容断言未通过：${bad.map((c) => c.name).join('、')}。正式站不接受内测批次构建。`);
}
if (manifestProblems.length) {
  fail(`正式清单断言未通过：\n - ${manifestProblems.join('\n - ')}`);
}

if (dryRun) {
  console.log('\n演练通过，未执行部署（去掉 --dry-run 才会调用 wrangler）。');
  process.exit(0);
}

console.log(`\n开始部署到 ${branch} …`);
execFileSync('npx', ['wrangler', 'pages', 'deploy', DIST, '--project-name', PROJECT, '--branch', branch, '--commit-dirty=true'], {
  stdio: 'inherit',
  shell: true,
});
