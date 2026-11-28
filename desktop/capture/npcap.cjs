/**
 * Windows Npcap 实时抓包（Electron 主进程 / Worker 线程共用）
 *
 * 为什么走 Npcap：PC 上拿不到手机那套 VPN 抓包通道，而游戏客户端（或模拟器）
 * 与服务器的 TCP 流都经过本机网卡。参考「ROCO附近精灵」的做法就是 Npcap 抓整条
 * TCP 流再按项目的协议解码，字段与手机抓包完全一致（已用三份手机 pcap 验证）。
 *
 * 实现要点：
 * - 用 koffi（Node-API FFI，免编译）加载 wpcap.dll，避免额外装编译工具链或 .NET 运行时；
 * - 只调用捕获相关 API，不做任何注入；pcap_pkthdr 在 Npcap 1.x x64 上是 4 个 u32（16 字节）；
 * - 过滤器默认 `tcp port 8195`（三份真实抓包的服务端端口都是 8195）。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 游戏服务端端口（来源：capture-1793900360948 / 1793902106531 / 1793905516970 三份真实抓包） */
const GAME_TCP_PORT = 8195;
const DEFAULT_FILTER = `tcp port ${GAME_TCP_PORT}`;
const PCAP_SNAPLEN = 65535;

const DLL_CANDIDATES = [
  'C:\\Windows\\System32\\Npcap\\wpcap.dll',
  'C:\\Windows\\System32\\wpcap.dll',
];

class NpcapMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NpcapMissingError';
    this.code = 'NPCAP_MISSING';
  }
}

let cached = null;

function loadBindings() {
  if (cached) return cached;

  // 2026-11-28：把「koffi 装不上」和「Npcap 没装」分开报，否则打包漏了 native 二进制
  // 会显示成「请安装 Npcap」，让人白装一遍驱动（本机明明有 Npcap 1.89 却报缺失）。
  let koffi;
  try {
    koffi = require('koffi');
  } catch (cause) {
    const error = new Error(
      `内置抓包组件加载失败（koffi）：${cause instanceof Error ? cause.message : String(cause)}。` +
      '这是安装包缺少原生模块，请更新到最新安装包。',
    );
    error.code = 'KOFFI_LOAD_FAILED';
    throw error;
  }
  const dll = DLL_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!dll) {
    throw new NpcapMissingError('未找到 Npcap（wpcap.dll）。请先安装 Npcap 后重试。');
  }

  const lib = koffi.load(dll);
  const pcap_if = koffi.struct('pcap_if', {
    next: 'pcap_if *',
    name: 'char *',
    description: 'char *',
    addresses: 'void *',
    flags: 'unsigned int',
  });
  const bpf_program = koffi.struct('bpf_program', { bf_len: 'unsigned int', bf_insns: 'void *' });

  cached = {
    koffi,
    lib,
    pcap_if,
    bpf_program,
    version: lib.func('const char *pcap_lib_version()'),
    findalldevs: lib.func('int pcap_findalldevs(_Out_ pcap_if **alldevs, char *errbuf)'),
    freealldevs: lib.func('void pcap_freealldevs(pcap_if *alldevs)'),
    create: lib.func('void *pcap_create(char *source, char *errbuf)'),
    setSnaplen: lib.func('int pcap_set_snaplen(void *p, int v)'),
    setPromisc: lib.func('int pcap_set_promisc(void *p, int v)'),
    setTimeout: lib.func('int pcap_set_timeout(void *p, int v)'),
    setBufSize: lib.func('int pcap_set_buffer_size(void *p, int v)'),
    activate: lib.func('int pcap_activate(void *p)'),
    datalink: lib.func('int pcap_datalink(void *p)'),
    compile: lib.func('int pcap_compile(void *p, _Out_ bpf_program *fp, char *filter, int optimize, unsigned int netmask)'),
    setfilter: lib.func('int pcap_setfilter(void *p, bpf_program *fp)'),
    freecode: lib.func('void pcap_freecode(bpf_program *fp)'),
    geterr: lib.func('char *pcap_geterr(void *p)'),
    nextEx: lib.func('int pcap_next_ex(void *p, _Out_ void **hdr, _Out_ void **data)'),
    stats: lib.func('int pcap_stats(void *p, _Out_ void *stat)'),
    close: lib.func('void pcap_close(void *p)'),
  };
  return cached;
}

function version() {
  try {
    return loadBindings().version();
  } catch {
    return '';
  }
}

/** 列出可以抓包的网卡；Npcap 未安装时抛出 NpcapMissingError */
function listDevices() {
  const b = loadBindings();
  const errbuf = Buffer.alloc(256);
  const head = [null];
  const rc = b.findalldevs(head, errbuf);
  if (rc !== 0) {
    throw new Error(`无法读取网卡列表：${errbuf.toString().split('\0')[0] || rc}`);
  }
  const devices = [];
  let node = head[0];
  try {
    while (node) {
      const item = b.koffi.decode(node, b.pcap_if);
      if (item.name) {
        devices.push({ name: item.name, description: item.description || item.name });
      }
      node = item.next;
    }
  } finally {
    b.freealldevs(head[0]);
  }
  return devices;
}

/** 自动挑一个最像物理网卡的设备（第一次启动不用手动选） */
function pickDefaultDevice(devices) {
  const virt = /Loopback|WAN Miniport|Virtual|VMware|VirtualBox|Hyper-V|Bluetooth|Wi-Fi Direct|TAP-|Npcap Loopback/i;
  const physical = devices.filter((device) => !virt.test(`${device.name} ${device.description}`));
  const prefer = physical.find((device) => /Ethernet|Wi-Fi|WLAN|Realtek|Intel|Killer|Broadcom/i.test(device.description));
  return (prefer || physical[0] || devices[0] || null)?.name ?? null;
}

const ACTIVATE_ERRORS = {
  '-1': 'Npcap 发生错误',
  '-3': '没有权限使用该网卡',
  '-4': '网卡不存在或已断开',
  '-5': '打开网卡失败（可能被安全软件拦截）',
  '-11': 'Npcap 拒绝访问：请以管理员身份运行工具箱',
  '-12': '网卡处于非激活状态',
};

class LiveCapture {
  /**
   * @param {{device: string, filter?: string}} options
   */
  constructor({ device, filter = DEFAULT_FILTER }) {
    this.device = device;
    this.filter = filter;
    this.handle = null;
    this.b = null;
    this.closed = false;
  }

  /** 打开网卡；失败抛错（含可读原因） */
  open() {
    const b = loadBindings();
    this.b = b;
    const errbuf = Buffer.alloc(256);
    const handle = b.create(this.device, errbuf);
    if (!handle) throw new Error(`打开网卡失败：${errbuf.toString().split('\0')[0] || '未知错误'}`);
    this.handle = handle;

    b.setSnaplen(handle, PCAP_SNAPLEN);
    b.setPromisc(handle, 0);
    b.setTimeout(handle, 100);
    b.setBufSize(handle, 8 * 1024 * 1024);

    const rc = b.activate(handle);
    if (rc < 0) {
      const detail = b.geterr(handle) || ACTIVATE_ERRORS[String(rc)] || `错误码 ${rc}`;
      this.close();
      throw new Error(`启用网卡失败：${detail}`);
    }

    const fp = {};
    const crc = b.compile(handle, fp, this.filter, 1, 0xffffffff);
    if (crc < 0) {
      const detail = b.geterr(handle) || `错误码 ${crc}`;
      this.close();
      throw new Error(`抓包过滤器无效（${this.filter}）：${detail}`);
    }
    b.setfilter(handle, fp);
    b.freecode(fp);

    this.linktype = b.datalink(handle) >= 0 ? b.datalink(handle) : 1;
    return this;
  }

  /**
   * 取下一个包；没有新包时返回 null（等了 100ms）。
   * 返回的 data 是本次抓到的完整帧（snaplen 65535，足够覆盖 MTU）。
   */
  next() {
    if (this.closed || !this.handle) return null;
    const hdr = [null];
    const data = [null];
    const rc = this.b.nextEx(this.handle, hdr, data);
    if (rc === 0) return null;
    if (rc === 1) {
      const meta = Buffer.from(this.b.koffi.decode(hdr[0], this.b.koffi.array('uint8_t', 16)));
      const caplen = meta.readUInt32LE(8);
      if (!caplen || caplen > PCAP_SNAPLEN) return null;
      const bytes = this.b.koffi.decode(data[0], this.b.koffi.array('uint8_t', caplen));
      return { tsSec: meta.readUInt32LE(0), tsUsec: meta.readUInt32LE(4), data: Buffer.from(bytes) };
    }
    if (rc === -2) return null;
    const detail = this.b.geterr(this.handle);
    throw new Error(`抓包中断：${detail || `错误码 ${rc}`}`);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.handle && this.b) {
      try {
        this.b.close(this.handle);
      } catch {
        /* 已经关闭 */
      }
    }
    this.handle = null;
  }
}

const PCAP_MAGIC = 0xa1b2c3d4;

/** 经典 PCAP 全局头（24 字节），与手机采集器写出的格式一致 */
function pcapHeader(linktype = 1) {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(PCAP_MAGIC, 0);
  header.writeUInt16LE(2, 4);
  header.writeUInt16LE(4, 6);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(0, 12);
  header.writeUInt32LE(PCAP_SNAPLEN, 16);
  header.writeUInt32LE(linktype, 20);
  return header;
}

function pcapRecord(buffer, tsSec, tsUsec) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(tsSec, 0);
  header.writeUInt32LE(tsUsec, 4);
  header.writeUInt32LE(buffer.length, 8);
  header.writeUInt32LE(buffer.length, 12);
  return [header, buffer];
}

module.exports = {
  DEFAULT_FILTER,
  GAME_TCP_PORT,
  NpcapMissingError,
  LiveCapture,
  listDevices,
  pickDefaultDevice,
  pcapHeader,
  pcapRecord,
  version,
  ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
  filePath: (dir, name) => path.join(dir, name),
};
