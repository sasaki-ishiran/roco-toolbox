/**
 * 多人母本共享：本地真实 Functions + D1 集成测试 runner。
 *
 * 流程：构建 → 临时目录建本地 D1 → 写入 schema → 启动 `wrangler pages dev` →
 * 轮询 /api/health → 运行 API 测试 → 清理进程与临时目录。
 *
 * 安全边界：
 * - 只监听 127.0.0.1，测试脚本也拒绝非 loopback 地址；
 * - D1 用**随机临时目录**（`--persist-to`），不碰仓库里的 `.wrangler` 或线上库；
 * - 启动前先探测 8789，若已有服务在响就报错，不复用不明旧服务；
 * - 清理时先按实际 PID 结束进程树，再删除**本次创建**的临时目录（校验绝对路径）。
 *
 * 运行：npm run test:mother-groups:api
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8789;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const SCHEMA = 'functions/schema.sql';
const API_TESTS = [
  'tools/test/mother-groups-api.test.mjs',
  'tools/test/collection-groups-api.test.mjs',
];
/** `--live`：跑真实浏览器联调；默认只跑 API 集成测试。 */
const suite = process.argv.includes('--live') ? 'live' : 'api';

const isWindows = process.platform === 'win32';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(commandLine, label, extraEnv = {}) {
  const result = spawnSync(commandLine, {
    cwd: root,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(`${label} 失败（退出码 ${result.status ?? 'null'}）`);
  }
}

async function isServing() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${BASE}/api/health`, { signal: controller.signal });
    return response.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function killTree(pid) {
  if (!pid) return;
  if (isWindows) {
    // Windows 上 wrangler 会再拉起 workerd；必须按实际 PID 结束整棵进程树
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // 进程已退出
    }
  }
}

let server = null;
let tempDir = null;
let cleaned = false;
let lastServerLog = '';

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (server && server.exitCode === null) killTree(server.pid);
  if (tempDir) {
    const resolved = path.resolve(tempDir);
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('roco-mother-groups-')) {
      await rm(resolved, { recursive: true, force: true });
    } else {
      console.warn(`跳过未知临时目录清理：${resolved}`);
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void cleanup().finally(() => process.exit(1));
  });
}

try {
  if (await isServing()) {
    throw new Error(`端口 ${PORT} 已有服务在响应；请先结束它（不要复用不明旧服务）`);
  }

  console.log('[1/6] 校验 schema 定义（内存 SQLite）');
  run('node tools/test/verify-mother-groups-schema.mjs', 'schema 校验');

  console.log('[2/6] npm run build');
  run('npm run build', '构建');

  tempDir = await mkdtemp(path.join(os.tmpdir(), 'roco-mother-groups-'));
  console.log(`[3/6] 初始化临时本地 D1：${tempDir}`);
  run(
    `npx --no-install wrangler d1 execute roco-toolbox-db --local --persist-to "${tempDir}" --file ${SCHEMA}`,
    '写入本地 schema',
  );

  console.log(`[4/6] 启动本地 Functions：${BASE}`);
  server = spawn(
    `npx --no-install wrangler pages dev dist --port ${PORT} --ip ${HOST} --persist-to "${tempDir}"`,
    { cwd: root, shell: true, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const collect = (chunk) => {
    const text = String(chunk);
    lastServerLog = (lastServerLog + text).slice(-8000);
    process.stdout.write(text);
  };
  server.stdout?.on('data', collect);
  server.stderr?.on('data', collect);

  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    if (await isServing()) {
      ready = true;
      break;
    }
    await delay(500);
  }
  if (!ready) {
    throw new Error(`本地 Functions 未就绪。wrangler 输出：\n${lastServerLog}`);
  }

  console.log(`[5/6] 运行${suite === 'live' ? ' live 浏览器' : ' API'}测试`);
  if (suite === 'live') {
    run('npx playwright test --config playwright.mother-groups.config.ts --workers=1', 'live 浏览器测试', {
      ROCO_MOTHER_API_BASE: BASE,
    });
  } else {
    run(`node --test ${API_TESTS.join(' ')}`, '本地 API 测试', { ROCO_MOTHER_API_BASE: BASE });
  }
  console.log('[6/6] 通过');
} finally {
  await cleanup();
}
