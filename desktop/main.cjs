/**
 * 小布助手 · Windows 桌面版（Electron 主进程）
 *
 * 为什么不用 file:// 直接打开 dist/index.html：
 * 构建产物用的是绝对路径（/assets/...），而且要用 Service Worker 之外的
 * IndexedDB、WASM（sql.js）与 Web Worker —— 这些只有 http(s) 源下才正常。
 * 所以这里在本机 127.0.0.1 起一个只读静态服务，窗口加载的就是它。
 *
 * /api/* 由主进程转发到线上 Cloudflare Pages（服务端到服务端，不受浏览器 CORS 限制），
 * 因此桌面版里账号、云同步、小组这些联网功能照常可用；断网时只有这些功能不可用，
 * 导入、孵蛋规划等本地功能不受影响。
 */
'use strict';

const { app, BrowserWindow, Menu, Notification, dialog, globalShortcut, ipcMain, screen, shell } = require('electron');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { CaptureManager } = require('./capture/manager.cjs');
const { migrateUserData } = require('./userdata.cjs');

const API_ORIGIN = 'https://roco-toolbox.pages.dev';
const DIST_DIR = path.join(__dirname, 'app-dist');
const SMOKE = process.argv.includes('--smoke');

/** 采集文件与设置放在 userData（%APPDATA%\小布助手），升级 exe 不丢 */
let captureManager = null;
let captureOrigin = '';

const MIME = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  wasm: 'application/wasm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  map: 'application/json; charset=utf-8',
};

/** 本地静态服务：host 固定 127.0.0.1，端口随机，避免和用户其它程序抢端口 */
function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html';
  const safe = path.normalize(rel).replace(/^[\\/]+/, '');
  let file = path.join(DIST_DIR, safe);
  if (!file.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // 前端没用到路由，但 /share-target 之类带后缀以外的路径统一回落到 index.html
    if (path.extname(safe)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    file = path.join(DIST_DIR, 'index.html');
  }
  const data = fs.readFileSync(file);
  const ext = path.extname(file).slice(1).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': safe.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else res.end(data);
}

/** 悬浮小窗的静态页（desktop/overlay），不进 dist、也不走打包后的 asar 资源目录 */
function serveOverlay(req, res, url) {
  const name = path.basename(url.pathname);
  if (!/^(index\.html|overlay\.js|overlay\.css)$/.test(name)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const file = path.join(__dirname, 'overlay', name);
  let data;
  try {
    data = fs.readFileSync(file);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const type = name.endsWith('.html') ? 'text/html; charset=utf-8'
    : name.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : 'text/css; charset=utf-8';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'no-store' });
  res.end(data);
}

/** 把采集到的 PCAP 交给网页读取；支持 ?from=N 只取新增的一段（实时巡检用） */
function serveCapture(req, res, url) {
  const id = path.basename(url.pathname);
  if (!/^capture-\d+\.pcap$/.test(id) || !captureManager) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const file = captureManager.fileFor(id);
  if (!file) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const from = Number(url.searchParams.get('from'));
  if (Number.isFinite(from) && url.searchParams.has('from')) {
    if (from < 0 || from > size) {
      res.writeHead(416);
      res.end('Requested Range Not Satisfiable');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': size - from,
      'X-Capture-From': String(from),
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start: from }).pipe(res);
  }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/** 采集桥：接口与安卓壳的 window.RocoCapture 对齐（返回字符串，失败时返回可读文案） */
function registerCaptureIpc() {
  ipcMain.handle('capture:state', () => captureManager?.state() ?? '');
  ipcMain.handle('capture:inspect', () => captureManager?.inspect() ?? '');
  ipcMain.handle('capture:start', () => captureManager?.start() ?? '采集组件未就绪');
  ipcMain.handle('capture:stop', () => captureManager?.stop() ?? '采集组件未就绪');
  ipcMain.handle('capture:delete', (_event, id) => captureManager?.delete(String(id ?? '')) ?? '采集组件未就绪');
  ipcMain.handle('capture:devices', () => JSON.stringify(captureManager?.devices() ?? { ok: false, devices: [], selected: null, error: '采集组件未就绪' }));
  ipcMain.handle('capture:select-device', (_event, name) => captureManager?.selectDevice(String(name ?? '')) ?? '采集组件未就绪');
  ipcMain.handle('capture:open-game', () => '');
  ipcMain.handle('capture:notify', (_event, title, body) => {
    try {
      new Notification({ title: String(title ?? '').slice(0, 80), body: String(body ?? '').slice(0, 500) }).show();
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : '通知发送失败';
    }
  });

  ipcMain.handle('capture:import', async (_event, id) => {
    const win = BrowserWindow.getAllWindows()[0];
    const fileId = String(id ?? '');
    if (!win) return '窗口已关闭';
    if (!captureManager?.fileFor(fileId)) return '文件不存在或已被删除';
    const payload = JSON.stringify({ kind: 'capture', name: fileId, url: `${captureOrigin}/capture/${fileId}` });
    try {
      await win.webContents.executeJavaScript(
        `window.__rocoPendingShare = ${payload}; window.dispatchEvent(new Event('roco-share')); true;`,
        true,
      );
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : '无法开始导入';
    }
  });

  ipcMain.handle('capture:share', async (_event, id) => {
    const win = BrowserWindow.getAllWindows()[0];
    const fileId = String(id ?? '');
    const file = captureManager?.fileFor(fileId);
    if (!file) return '文件不存在或已被删除';
    const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined, {
      title: '导出原始抓包',
      defaultPath: fileId,
      filters: [{ name: 'PCAP 抓包', extensions: ['pcap'] }],
    });
    if (canceled || !filePath) return '';
    try {
      fs.copyFileSync(file, filePath);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : '导出失败';
    }
  });
}

/* ---------------- 附近精灵悬浮小窗（2026-11-08） ---------------- */

let overlayWin = null;
let overlayPayload = '';
let overlayClickThrough = false;
let overlayTheme = 'dark';
let overlayCollapsed = false;

const OVERLAY_EXPANDED = { width: 460, height: 300 };
const OVERLAY_COLLAPSED = { width: 280, height: 38 };

function overlayStateFile() {
  return path.join(app.getPath('userData'), 'overlay-state.json');
}

function readOverlayState() {
  try {
    return JSON.parse(fs.readFileSync(overlayStateFile(), 'utf8')) || {};
  } catch {
    return {};
  }
}

/** 统一落盘：收起时不要用「收起后的小尺寸」覆盖展开尺寸 */
function persistOverlayState(extra = {}) {
  const current = readOverlayState();
  const next = { ...current, theme: overlayTheme, collapsed: overlayCollapsed, clickThrough: overlayClickThrough, ...extra };
  if (!overlayCollapsed && !extra.bounds && overlayWin && !overlayWin.isDestroyed()) {
    next.bounds = overlayWin.getBounds();
  }
  try {
    fs.writeFileSync(overlayStateFile(), JSON.stringify(next));
  } catch {
    /* 写不进去不影响使用 */
  }
}

function applyOverlayClickThrough(flag) {
  overlayClickThrough = Boolean(flag);
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setIgnoreMouseEvents(overlayClickThrough, { forward: true });
    overlayWin.webContents.send('overlay:click-through', overlayClickThrough);
  }
  persistOverlayState();
}

function applyOverlayTheme(theme) {
  overlayTheme = theme === 'light' ? 'light' : 'dark';
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setBackgroundColor(overlayTheme === 'light' ? '#ffffff' : '#0f172a');
  }
  persistOverlayState();
}

function createOverlayWindow(show = false) {
  if (overlayWin && !overlayWin.isDestroyed()) {
    if (show) overlayWin.showInactive();
    return overlayWin;
  }
  const saved = readOverlayState();
  overlayTheme = saved.theme === 'light' ? 'light' : 'dark';
  overlayCollapsed = Boolean(saved.collapsed);
  const area = screen.getPrimaryDisplay().workArea;
  const bounds = overlayCollapsed ? OVERLAY_COLLAPSED : (saved.bounds ?? OVERLAY_EXPANDED);
  const width = Math.min(bounds.width ?? OVERLAY_EXPANDED.width, area.width);
  const height = Math.min(bounds.height ?? OVERLAY_EXPANDED.height, area.height);
  overlayWin = new BrowserWindow({
    width,
    height,
    x: saved.bounds?.x ?? area.x + area.width - OVERLAY_EXPANDED.width - 24,
    y: saved.bounds?.y ?? area.y + 24,
    minWidth: overlayCollapsed ? 180 : 320,
    minHeight: overlayCollapsed ? 36 : 220,
    frame: false,
    resizable: !overlayCollapsed,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: overlayTheme === 'light' ? '#ffffff' : '#0f172a',
    title: '附近精灵',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.loadURL(`${captureOrigin}/overlay/index.html`);
  overlayWin.once('ready-to-show', () => {
    if (show) overlayWin.showInactive();
  });
  overlayWin.on('close', () => persistOverlayState());
  overlayWin.on('closed', () => {
    overlayWin = null;
  });
  if (overlayClickThrough) {
    overlayWin.webContents.once('did-finish-load', () => overlayWin.setIgnoreMouseEvents(true, { forward: true }));
  }
  return overlayWin;
}

function registerOverlayIpc() {
  ipcMain.handle('overlay:update', (_event, text) => {
    overlayPayload = typeof text === 'string' ? text : '';
    const win = createOverlayWindow(false);
    const send = () => win.webContents.send('overlay:payload', overlayPayload);
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
    return '';
  });
  ipcMain.handle('overlay:show', () => {
    createOverlayWindow(true);
    return '';
  });
  ipcMain.handle('overlay:hide', () => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();
    return '';
  });
  ipcMain.handle('overlay:get-payload', () => overlayPayload);
  ipcMain.handle('overlay:get-state', () => JSON.stringify({
    theme: overlayTheme,
    collapsed: overlayCollapsed,
    clickThrough: overlayClickThrough,
  }));
  ipcMain.handle('overlay:set-theme', (_event, theme) => {
    applyOverlayTheme(theme);
    return '';
  });
  ipcMain.handle('overlay:set-collapsed', (_event, flag) => {
    const collapsed = Boolean(flag);
    if (!overlayWin || overlayWin.isDestroyed()) return '';
    const current = overlayWin.getBounds();
    const saved = readOverlayState();
    if (collapsed) {
      // 先把展开尺寸记下来，展开时还原
      persistOverlayState({ bounds: current });
      overlayCollapsed = true;
      overlayWin.setResizable(false);
      overlayWin.setMinimumSize(180, 36);
      overlayWin.setBounds({ x: current.x, y: current.y, width: OVERLAY_COLLAPSED.width, height: OVERLAY_COLLAPSED.height });
    } else {
      const target = saved.bounds ?? { ...OVERLAY_EXPANDED, x: current.x, y: current.y };
      overlayCollapsed = false;
      overlayWin.setResizable(true);
      overlayWin.setMinimumSize(320, 220);
      overlayWin.setBounds({ x: target.x ?? current.x, y: target.y ?? current.y, width: target.width ?? OVERLAY_EXPANDED.width, height: target.height ?? OVERLAY_EXPANDED.height });
    }
    persistOverlayState();
    return '';
  });
  ipcMain.handle('overlay:click-through', (_event, flag) => {
    applyOverlayClickThrough(flag);
    return '';
  });
  globalShortcut.register('Control+Alt+O', () => applyOverlayClickThrough(!overlayClickThrough));
}

/** 把 /api/* 原样转给线上后端；失败时返回可读的 JSON，前端按普通错误处理 */
function proxyApi(req, res) {
  const headers = { ...req.headers, host: new URL(API_ORIGIN).host, origin: API_ORIGIN, referer: `${API_ORIGIN}/`, 'accept-encoding': 'identity' };
  delete headers.connection;

  const upstream = https.request(
    { protocol: 'https:', hostname: new URL(API_ORIGIN).hostname, port: 443, method: req.method, path: req.url, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.setTimeout(120_000, () => upstream.destroy(new Error('upstream timeout')));
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: '云端服务连接失败，请检查网络后重试' }));
    } else {
      res.end();
    }
  });
  req.pipe(upstream);
}

/**
 * 端口必须固定（2026-11-08 修复）。
 *
 * localStorage / IndexedDB / 教程已读标记都是按「源」隔离的，而源包含端口：
 * 之前用随机端口，每次重开都是新源 → 教程每次重新弹、导入的数据和设置也全丢。
 * 这里优先用 5178；被别的程序占用时才顺延，避免直接打不开。
 */
const FIXED_PORT = 5178;
const PORT_ATTEMPTS = 10;

function listenOn(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError);
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(port);
    });
  });
}

async function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) proxyApi(req, res);
      else if (url.pathname.startsWith('/capture/')) serveCapture(req, res, url);
      else if (url.pathname.startsWith('/overlay/')) serveOverlay(req, res, url);
      else serveStatic(req, res, url);
    } catch {
      res.writeHead(500);
      res.end('Internal Error');
    }
  });
  let lastError = null;
  for (let offset = 0; offset < PORT_ATTEMPTS; offset += 1) {
    const port = FIXED_PORT + offset;
    try {
      await listenOn(server, port);
      return { server, port, origin: `http://127.0.0.1:${port}` };
    } catch (error) {
      lastError = error;
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  throw lastError ?? new Error('本地端口都被占用');
}

/** 窗口大小/位置记在本机 userData 里，下次打开保持一致 */
function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return typeof state.width === 'number' && typeof state.height === 'number' ? state : null;
  } catch {
    return null;
  }
}

function saveWindowState(win) {
  if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getBounds(), maximized: false }));
  } catch {
    /* 写不进去就算了，不影响使用 */
  }
}

function createWindow(origin) {
  const saved = readWindowState();
  // 界面按手机宽度设计（max-w-md），默认开一个竖屏窗口；小屏幕笔记本上要收进可用区域
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: Math.min(saved?.width ?? 480, area.width),
    height: Math.min(saved?.height ?? 900, area.height),
    x: saved?.x,
    y: saved?.y,
    minWidth: 380,
    minHeight: 560,
    show: false,
    backgroundColor: '#f8fafc',
    title: '小布助手',
    icon: path.join(DIST_DIR, 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveWindowState(win));

  // 站外链接一律交给系统浏览器；页面自身禁止跳到别的源
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) event.preventDefault();
  });

  win.loadURL(origin);
  return win;
}

/** 打包后的自检：静态资源、首页、清单各取一次，全部正常才退 0（用于发布前验证） */
async function runSmoke(origin) {
  const get = (p) =>
    new Promise((resolve, reject) => {
      http
        .get(`${origin}${p}`, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body }));
        })
        .on('error', reject);
    });

  const home = await get('/');
  if (home.status !== 200 || !home.body.includes('id="root"')) throw new Error(`首页异常：${home.status}`);
  const asset = home.body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  if (!asset) throw new Error('首页里找不到入口 JS');
  const js = await get(asset);
  if (js.status !== 200 || js.body.length < 1000) throw new Error(`入口 JS 异常：${js.status}`);
  const manifest = await get('/manifest.webmanifest');
  if (manifest.status !== 200) throw new Error(`清单异常：${manifest.status}`);
  console.log(`SMOKE_OK ${origin} (${asset}, ${js.body.length} bytes)`);
}

// 只允许开一个实例，重复双击就把已有窗口提到前面
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 产品名改成「小布助手」后 userData 目录也跟着改名：首次启动把旧目录整体迁过来。
  // 放在拿到单实例锁之后，保证同一时刻只有一个进程在搬；迁移失败就退回旧目录继续用（老数据都在），不让启动失败。
  const userDataMigration = migrateUserData({
    appData: app.getPath('appData'),
    userData: app.getPath('userData'),
  });
  if (userDataMigration.status === 'migrated') {
    console.log(`[userData] 已迁移：${userDataMigration.legacy} → ${userDataMigration.to}`);
  } else if (userDataMigration.status === 'failed') {
    console.warn('[userData] 迁移失败，继续使用旧目录：', userDataMigration.error);
    if (fs.existsSync(userDataMigration.legacy)) app.setPath('userData', userDataMigration.legacy);
  }

  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    app.setAppUserModelId('com.localdatatool.toolbox');

    let origin;
    try {
      ({ origin } = await startServer());
    } catch (error) {
      console.error('本地服务启动失败', error);
      app.exit(1);
      return;
    }

    captureOrigin = origin;
    captureManager = new CaptureManager({
      dir: path.join(app.getPath('userData'), 'captures'),
      settingsFile: path.join(app.getPath('userData'), 'desktop-settings.json'),
    });
    captureManager.setOrigin(origin);
    registerCaptureIpc();
    overlayClickThrough = Boolean(readOverlayState().clickThrough);
    registerOverlayIpc();

    if (SMOKE) {
      try {
        await runSmoke(origin);
        app.exit(0);
      } catch (error) {
        console.error(`SMOKE_FAIL ${error.message}`);
        app.exit(1);
      }
      return;
    }

    createWindow(origin);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(origin);
    });
  });

  app.on('window-all-closed', () => app.quit());

  // 退出前让工作线程把正在写的 PCAP 收尾（文件头/最后几个包不丢）
  app.on('before-quit', () => captureManager?.shutdown());
}
