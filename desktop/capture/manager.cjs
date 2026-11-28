/**
 * 桌面版采集管理：维护「我的 · 游戏数据 → 本机采集」需要的状态与文件列表。
 *
 * 状态结构与安卓壳的 RocoCapture.getState() 完全一致（version 1），
 * 这样网页端 NativeCollectorPanel / 自动导入 / 附近雷达一行代码都不用改。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const npcap = require('./npcap.cjs');

const MAX_FILES = 10;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
/** 到上限后的可读原因：桌面端不做滚动裁剪，只能提示用户停止后重新开始 */
const CAP_MESSAGE = '已达 128MiB 上限，请停止后重新开始';

const ID_PATTERN = /^capture-(\d+)\.pcap$/;

class CaptureManager {
  constructor({ dir, settingsFile }) {
    this.dir = dir;
    this.settingsFile = settingsFile;
    this.origin = '';
    this.worker = null;
    this.phase = 'idle';
    this.message = '';
    this.packets = 0;
    this.bytes = 0;
    this.openedCount = 0;
    this.activeId = null;
    this.activePath = null;
    this.startedAt = 0;
    this.npcapError = '';
    this.settings = this.readSettings();
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      this.npcapVersion = npcap.version();
      if (!this.npcapVersion) this.npcapError = '未找到 Npcap（wpcap.dll），请先安装 Npcap';
    } catch (cause) {
      this.npcapVersion = '';
      // 2026-11-28：区分「Npcap 没装」与「安装包缺原生模块」——
      // 后者以前也显示成「请安装 Npcap」，用户会白装一遍驱动（本机明明有 Npcap）。
      const message = cause instanceof Error ? cause.message : String(cause);
      this.npcapError = cause && cause.code === 'NPCAP_MISSING'
        ? '未找到 Npcap（wpcap.dll），请先安装 Npcap'
        : `内置抓包组件不可用：${message}`;
    }
  }

  readSettings() {
    try {
      return JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')) || {};
    } catch {
      return {};
    }
  }

  writeSettings(next) {
    this.settings = { ...this.settings, ...next };
    try {
      fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
    } catch {
      /* 写不进去不影响采集 */
    }
  }

  /** 本地服务启动后由主进程告知，用来拼出可被 fetch 的抓包地址 */
  setOrigin(origin) {
    this.origin = origin;
  }

  get supported() {
    return !this.npcapError;
  }

  devices() {
    if (!this.supported) {
      return { ok: false, error: this.npcapError, devices: [], selected: null, version: '' };
    }
    try {
      const devices = npcap.listDevices();
      const selected = this.resolveDevice(devices);
      return { ok: true, error: '', devices, selected, version: this.npcapVersion };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), devices: [], selected: null, version: this.npcapVersion };
    }
  }

  resolveDevice(devices) {
    const saved = this.settings.device;
    // 默认自动：一次打开所有物理 / 虚拟（如加速器 TAP）网卡，用户不用猜流量走哪块
    if (!saved || saved === 'auto') return 'auto';
    const picked = devices.find((device) => device.name === saved);
    if (!picked) return 'auto';
    // 旧版本（含测试）可能存过回环网卡：它抓不到游戏流量，直接退回自动
    if (/loopback/i.test(`${picked.name} ${picked.description}`)) {
      this.writeSettings({ device: 'auto' });
      return 'auto';
    }
    return saved;
  }

  selectDevice(name) {
    if (name === 'auto') {
      this.writeSettings({ device: 'auto' });
      return '';
    }
    const { devices } = this.devices();
    const picked = devices.find((device) => device.name === name);
    if (!picked) return '没有找到这块网卡，请刷新后重试';
    if (/loopback/i.test(`${picked.name} ${picked.description}`)) {
      return '回环网卡抓不到游戏流量，请选「自动」或对应的物理 / 加速器网卡';
    }
    this.writeSettings({ device: name });
    return '';
  }

  /** 自动 = 除回环外的所有网卡；手动 = 指定的一块 */
  devicesToOpen() {
    const { devices, error, selected } = this.devices();
    if (error) return { devices: [], error };
    if (selected && selected !== 'auto') return { devices: [selected], error: '' };
    return {
      devices: devices
        .filter((device) => !/loopback/i.test(`${device.name} ${device.description}`))
        .map((device) => device.name),
      error: devices.length === 0 ? '没有可用的网卡' : '',
    };
  }

  /** 文件名即 id，网页端据此拼 URL 与展示 */
  listFiles() {
    let names = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    return names
      .filter((name) => ID_PATTERN.test(name))
      .map((name) => {
        const file = path.join(this.dir, name);
        const stat = fs.statSync(file);
        return {
          id: name,
          name,
          size: stat.size,
          createdAt: Number(ID_PATTERN.exec(name)[1]) || stat.mtimeMs,
          valid: name !== this.activeId && stat.size > 24,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_FILES);
  }

  state() {
    const files = this.listFiles();
    const last = files[0];
    const state = {
      version: 1,
      supported: this.supported,
      phase: this.phase,
      message: this.message || (this.supported ? '准备采集' : this.npcapError),
      packets: this.packets,
      bytes: this.bytes,
      files,
    };
    // 让「采集进度 / 自动导入」能像安卓壳一样拿到增量读取所需的信息
    const session = this.activeId || (this.phase === 'idle' ? last?.id : undefined);
    if (session) {
      state.progressVersion = 1;
      state.fileId = session;
      state.savedBytes = this.activeId ? this.bytes : (files.find((file) => file.id === session)?.size ?? 0);
      // 桌面端不做滚动裁剪：超过上限时网页侧不能再整份判无效，必须带上真实原因
      if (state.savedBytes > MAX_FILE_BYTES) {
        state.capped = true;
        state.message = CAP_MESSAGE;
      }
    }
    return JSON.stringify(state);
  }

  inspect() {
    const id = this.activeId || this.listFiles().find((file) => file.valid)?.id;
    if (!id || !this.origin) return '';
    const file = path.join(this.dir, id);
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      return '';
    }
    // 超过上限不再提供增量读取入口（网页 worker 本身也拒绝 >128MiB）；
    // 状态里的 capped / message 负责把原因显示给用户。
    if (size <= 24 || size > MAX_FILE_BYTES) return '';
    return JSON.stringify({ id, size, url: `${this.origin}/capture/${id}` });
  }

  start() {
    if (!this.supported) return this.npcapError;
    if (this.phase !== 'idle' && this.phase !== 'failed') return '已经在采集了';
    const completed = this.listFiles().filter((file) => file.valid);
    if (completed.length >= MAX_FILES) return `最多保留 ${MAX_FILES} 个原包，请先删除旧的再开始`;

    const { devices, error } = this.devicesToOpen();
    if (error) return error;
    if (devices.length === 0) return '没有可用的网卡，请先安装 Npcap 并确认网络已连接';

    const id = `capture-${Date.now()}.pcap`;
    const file = path.join(this.dir, id);

    this.activeId = id;
    this.activePath = file;
    this.phase = 'starting';
    this.message = '正在打开网卡…';
    this.packets = 0;
    this.bytes = 0;
    this.startedAt = Date.now();

    const worker = new Worker(path.join(__dirname, 'worker.cjs'));
    this.worker = worker;
    worker.on('message', (message) => this.onWorkerMessage(message));
    worker.on('error', (error) => this.fail(error instanceof Error ? error.message : String(error)));
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = null;
    });
    worker.postMessage({ type: 'start', devices, file, filter: npcap.DEFAULT_FILTER });
    return '';
  }

  onWorkerMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'started') {
      this.phase = 'capturing';
      this.openedCount = message.opened || 0;
      this.message = `正在采集 · ${this.openedCount} 块网卡 · 请保持游戏连接`;
    } else if (message.type === 'stats') {
      this.packets = message.packets || 0;
      this.bytes = message.bytes || 0;
    } else if (message.type === 'error') {
      this.fail(message.message || '采集失败');
    } else if (message.type === 'stopped') {
      this.finish();
    }
  }

  stop() {
    if (this.phase !== 'capturing' && this.phase !== 'starting') return '当前没有在采集';
    this.phase = 'stopping';
    this.message = '正在保存本次采集…';
    this.startedAt = 0;
    try {
      this.worker?.postMessage({ type: 'stop' });
    } catch {
      this.finish();
    }
    return '';
  }

  finish() {
    this.phase = 'idle';
    this.message = '采集已停止，文件已保存';
    const finished = this.activeId;
    this.activeId = null;
    this.activePath = null;
    try {
      this.worker?.terminate();
    } catch {
      /* 已退出 */
    }
    this.worker = null;
    if (finished) {
      const file = path.join(this.dir, finished);
      try {
        this.bytes = fs.statSync(file).size;
      } catch {
        this.bytes = 0;
      }
    }
  }

  fail(message) {
    this.phase = 'failed';
    this.message = message;
    try {
      this.worker?.terminate();
    } catch {
      /* 已退出 */
    }
    this.worker = null;
    this.activeId = null;
    this.activePath = null;
  }

  delete(id) {
    if (!ID_PATTERN.test(id)) return '无效的采集文件';
    if (id === this.activeId) return '正在采集的文件不能删除';
    try {
      fs.unlinkSync(path.join(this.dir, id));
      return '';
    } catch {
      return '删除失败，文件可能已被移动';
    }
  }

  fileFor(id) {
    if (!ID_PATTERN.test(id)) return '';
    const file = path.join(this.dir, id);
    return fs.existsSync(file) ? file : '';
  }

  /** 进程退出前把正在写的文件收尾 */
  shutdown() {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'stop' });
      } catch {
        /* 已退出 */
      }
    }
  }
}

module.exports = { CaptureManager, MAX_FILES };
