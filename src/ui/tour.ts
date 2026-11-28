/**
 * 新手引导（2026-11-25 第三轮：v5「任务式」大纲）。
 *
 * 这一版不再做「界面导览」，而是带人做完一条任务线：
 *   把数据导进来 → 看到自己的缺口 → 知道怎么补 → 知道蛋在哪、去哪换。
 *
 * 结构：
 * - `start`：首启主线 7 步（6 步内容 + 收尾），跨「我的 · 游戏数据 → 我的身份 → 看板 → 家园」四个页面；
 *   第 2 步按平台二选一（有采集桥讲「开始采集」，网页讲「网页不能采集」），第 3 步讲同账号登录同步；
 * - 其余分段跟着页签走：第一次进入看板 / 收集 / 附近 / 换蛋 / 家园时各弹一次；
 * - 顶部「教程」按钮 = 直接重播**当前页**那一段（文字教程已下线）。
 *
 * 条件步骤：只有「已登录 + 已入组 / 有数据」才渲染的锚点（蛋仓、换蛋广场、雷达等）标
 * `skipWhenMissing`，找不到锚点时由浮层自动跳到下一步，不把卡片飘在屏幕中间。
 *
 * 已读按**分段 + 版本号**记：改文案或步骤时把 `TOUR_VERSION` +1，让老用户再看一次。
 */
import { readShared, syncShared, writeShared } from '../api/sharedPrefs';

/** 旧版（固定 15 步）的已读键，只用于老用户迁移，不再写入 */
const LEGACY_TOUR_SEEN_KEY = 'roco.tourSeen';
const TOUR_SEEN_PREFIX = 'roco.tourSeen.';

/**
 * 引导版本：改任一分段的步骤时 +1（4 = 按场景分段；5 = 任务式）。
 *
 * 2026-11-27 换蛋段补了「把游戏账号绑到小组」一步，但**有意不 +1**：
 * 这一步只对「先导入后入组 / 从没导入过」的人有用，不值得让所有人重走一遍整段；
 * 老用户仍是 22 步，新用户拿到 23 步。
 */
export const TOUR_VERSION = '6';

/** 目标元素上挂的锚点属性；找不到时退化成居中说明卡（除非该步标了 skipWhenMissing）。 */
export const TOUR_ANCHOR_ATTR = 'data-tour';

/** 收尾「从教程重看」这一步的固定 id：跳过时会先跳到它，再点一次才真正关闭。 */
export const TOUR_HINT_STEP_ID = 'tour-hint';

/**
 * 这里刻意不 import `navigation.ts`：本文件要被 e2e 工程直接引用（读版本号/步骤），
 * 而 e2e 的 TS 工程只收自包含模块。下列字面量类型与导航合同结构兼容，由 App 转成意图。
 */
export type TourPage = 'dashboard' | 'home' | 'collection' | 'nearby' | 'groups' | 'profile';
export type TourCollection =
  | { kind: 'mothers'; status: 'missing' | 'collecting' | 'collected' }
  | { kind: 'studs'; view: 'coverage' }
  | { kind: 'inventory' };
export type TourProfileSection = 'groups' | 'identity' | 'data';

/** 引导分段：`start` 是首启主线，其余与页签名一一对应。 */
export type TourSegment = 'start' | TourPage;

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** 要高亮的元素的 data-tour 值（与 selector 二选一，selector 优先） */
  anchor?: string;
  /**
   * 直接用 CSS 选择器定位（2026-11-25）：页面里已有稳定的 `data-testid` 时用它，
   * 这样不必为了教程去改别人的组件。只允许 `[data-tour="..."]` / `[data-testid="..."]`，
   * 由 `tour.anchors.test.ts` 保证。
   */
  selector?: string;
  /**
   * 条件步骤（2026-11-25）：锚点只在「已登录 + 已入组 / 有数据」时渲染。
   * 找不到锚点时自动跳下一步，不在空位置飘一张居中说明卡。
   */
  skipWhenMissing?: boolean;
  /** 进入该步骤前要切到的页签（不填 = 停在当前页） */
  page?: TourPage;
  /** 切到收集页的某个视图（隐含 page = collection） */
  collection?: TourCollection;
  /** 切到「我的」的某个分区（隐含 page = profile） */
  profileSection?: TourProfileSection;
  /** 家园的三个分页由本机偏好记住，不属于导航合同 */
  homeView?: 'nests' | 'demands' | 'stock';
  /** 本机还没有数据时停在这一步，数据到位后自动继续 */
  waitForImport?: boolean;
  /** 收尾的「从教程重看」一步：按钮文案为「知道了」 */
  hint?: boolean;
}

/** 收尾步：高亮顶部「教程」，告诉用户随时可以重看引导（只在 start 段保留）。 */
const hintStep = (body: string): TourStep => ({
  id: TOUR_HINT_STEP_ID,
  title: '随时能重看引导',
  body,
  anchor: 'guide-open',
  hint: true,
});

/** 首启第 2 步要按环境二选一：有没有原生采集桥、是不是桌面壳。 */
export interface TourStartEnv {
  hasCapture: boolean;
  desktop: boolean;
}

/** 读当前环境的采集能力：安卓壳 / 桌面 Npcap 都挂 `window.RocoCapture`，网页版没有。 */
export function detectStartEnv(): TourStartEnv {
  if (typeof window === 'undefined') return { hasCapture: false, desktop: false };
  // 本文件要被 e2e 工程单独引用（只收自包含模块），所以不用 nativeCollector 里的
  // `declare global` 增强，按结构读一下就好。
  const bridge = window as unknown as { RocoCapture?: unknown; rocoDesktop?: unknown };
  return { hasCapture: Boolean(bridge.RocoCapture), desktop: Boolean(bridge.rocoDesktop) };
}

/** 首启第 2 步：有采集桥就讲「开始采集」；网页版没有采集桥，只讲「装壳 + 登录同步」。 */
function collectStep(env: TourStartEnv): TourStep {
  if (!env.hasCapture) {
    return {
      id: 'start-collect',
      title: '网页版怎么拿到数据',
      body: '网页版不能采集，也不再有文件导入：装安卓版 / 电脑版采集一次，或到下一步用同一账号登录同步。',
      profileSection: 'data',
      anchor: 'profile-sync',
      // 网页版没有采集桥：不卡在这一步等数据，让用户继续看后面的页面
    };
  }
  if (env.desktop) {
    return {
      id: 'start-collect',
      title: '点「开始采集」',
      body: '我们到「我的 · 游戏数据」：先选抓包网卡（默认自动），再点「开始采集」；打开游戏走一遍精灵仓库、背包与蛋仓，进度走满会自动停止、保存并导入。',
      profileSection: 'data',
      anchor: 'collector-start',
      waitForImport: true,
    };
  }
  return {
    id: 'start-collect',
    title: '点「开始采集」',
    body: '我们到「我的 · 游戏数据」：点「开始采集」，同意 VPN 授权 → 打开游戏看一遍精灵仓库、背包与蛋仓；进度走满会自动停止、保存并导入。',
    profileSection: 'data',
    anchor: 'collector-start',
    waitForImport: true,
  };
}

/**
 * 首启主线（v6 任务线：采集 → 登录同步 → 看缺口）：6 步内容 + 收尾。
 * `TOUR_SEGMENTS.start` 用本机环境渲染一份并缓存，App 仍然只取 `TOUR_SEGMENTS[segment]`。
 */
export function startStepsFor(env: TourStartEnv): TourStep[] {
  return [
    {
      id: 'start-profile',
      title: '先让数据进来',
      body: '这个工具的一切都按你采集 / 同步进来的数据算，没有数据等于全空。先花一分钟到「我的」：装壳采集，或登录同一账号同步（顶部页签）。',
      // 顶部页签是动态渲染的（data-tour={`tab-${id}`}），框整条导航比框单个页签稳
      anchor: 'tab-nav',
    },
    collectStep(env),
    {
      id: 'start-sync',
      title: '登录同一账号同步',
      body: '多设备 / 换手机：到「我的身份」用同一账号登录，点「立即同步」拉云端快照。不用再传抓包文件或备份了。',
      profileSection: 'identity',
      anchor: 'profile-account',
    },
    {
      id: 'start-gap',
      title: '这就是你的缺口',
      body: '我们跳到「看板」：这块「种公全收集」和右边「母本全收集」就是你的缺口；上面的「追满分 / 追双牌」决定怎么算达标。',
      page: 'dashboard',
      selector: '[data-testid="progress-card-action-stud"]',
    },
    {
      id: 'start-fix',
      title: '点开一张卡看「怎么补」',
      body: '点开任意一张配窝卡 →「怎么补」：本号直配、跨号传蛋、组里谁能补。',
      anchor: 'dashboard-nest',
    },
    {
      id: 'start-egg',
      title: '你孵的蛋在这儿',
      body: '我们跳到「家园」：右上角「蛋仓」要登录并加入小组才看得到；自产 / 绿窝会打标，点开能标注和挂出。',
      page: 'home',
      homeView: 'nests',
      selector: '[data-testid="home-egg-stock"]',
    },
    hintStep(
      '点顶部「教程」能重看当前页的引导；想从头再走一遍，到「我的 · 游戏数据」点入门卡上的「教程」。',
    ),
  ];
}

/** 首启按环境缓存一份：同一环境里 `TOUR_SEGMENTS.start` 始终是同一个数组。 */
let cachedStart: { key: string; steps: TourStep[] } | null = null;

function cachedStartSteps(): TourStep[] {
  const env = detectStartEnv();
  const key = `${env.hasCapture}:${env.desktop}`;
  if (!cachedStart || cachedStart.key !== key) cachedStart = { key, steps: startStepsFor(env) };
  return cachedStart.steps;
}

/**
 * 分段步骤。
 * - `start` 只保证「第一次完整导一次数据 + 知道缺口和蛋仓在哪」；
 * - 页内分段讲这一页的进阶用法（目标模式、覆盖矩阵、蛋仓细节、换蛋流程…）。
 */
export const TOUR_SEGMENTS: Record<TourSegment, TourStep[]> = {
  get start() {
    return cachedStartSteps();
  },
  dashboard: [
    {
      id: 'dashboard-target',
      title: '先定你的目标',
      body: '追满分看声音 ±100，追双牌看声音奖牌；四档组合决定种公覆盖和配窝怎么算。右上角账号可多选，只看某几个号。',
      page: 'dashboard',
      anchor: 'dashboard-target',
    },
    {
      id: 'dashboard-transfer',
      title: '跨号传蛋',
      body: '多号时这里会列出「跨号传蛋」：窝记在出蛋号，记得去那个号勾占窝。',
      selector: '[data-testid="transfer-task-list"]',
      skipWhenMissing: true,
    },
  ],
  collection: [
    {
      id: 'collection-kinds',
      title: '收集页三个视图',
      body: '精灵背包（现有的）/ 母本（还缺哪些蛋）/ 种公（覆盖度）。',
      collection: { kind: 'mothers', status: 'missing' },
      anchor: 'collection-kinds',
    },
    {
      id: 'collection-mothers',
      title: '母本三种状态',
      body: '未收集（含「其他号可补」）/ 收集中（计划·需求·已接单）/ 已收集；点未收集的卡进「怎么补」。',
      collection: { kind: 'mothers', status: 'missing' },
      anchor: 'collection-mothers',
    },
    {
      id: 'collection-studs',
      title: '覆盖矩阵怎么读',
      body: '绿 = 这个蛋组已有达标种公，点一行展开看缺哪只。',
      collection: { kind: 'studs', view: 'coverage' },
      anchor: 'collection-studs',
    },
  ],
  nearby: [
    {
      id: 'nearby-status',
      title: '附近在哪',
      body: '在「我的 · 附近精灵」或底部「附近」：顶部筛选 全部/稀有/需求/目标，可切地图或列表。',
      page: 'nearby',
      selector: '[data-testid="nearby-status"]',
    },
    {
      id: 'nearby-radar',
      title: '雷达怎么读',
      body: '圆点 = 精灵，越靠外越远；橙 / 紫 / 粉是稀有，红圈是可主动提醒。普通精灵离开视野即清理，高价值保留 10 分钟。',
      page: 'nearby',
      anchor: 'nearby-radar',
      skipWhenMissing: true,
    },
  ],
  groups: [
    {
      id: 'group-join',
      title: '换蛋要先入组',
      body: '点这里去「我的 · 小组」新建或加入；进组后才有组内广场和我的收集。',
      page: 'groups',
      selector: '[data-testid="group-feed-hint"]',
      skipWhenMissing: true,
    },
    {
      id: 'group-bind',
      title: '把游戏账号绑到小组',
      // 用户「不知道这个怎么操作」：写成编号步骤，并写明可以多选（一人多号是常态）
      body:
        '到「我的 · 小组」的组卡里点「绑定游戏账号」：' +
        '① 勾上要用的游戏号（可以多选，绑几个都行）→ ② 点「发布我的资源」→ ③ 回群里查蛋，机器人就能把蛋同步进蛋仓。' +
        '没列出你要的号？点列表下面「＋ 没有找到你的游戏号？」，先在那个号上采集一次（或登录同步）。' +
        '不绑的话机器人同步不了蛋仓——会回「这个 UID 还没绑定到小组成员」。',
      // 按钮在「我的 · 小组」，不在换蛋页签
      profileSection: 'groups',
      selector: '[data-testid="group-edit-resources"]',
      // 只在「已登录 + 已入组」时渲染
      skipWhenMissing: true,
    },
    {
      id: 'group-plaza',
      title: '广场在哪',
      body: '切「组内广场」看别人的需求（可「只看我能接」）；「我的收集」是你自己发的需求；右边「蛋仓」和家园里的蛋仓是同一份。',
      page: 'groups',
      anchor: 'egg-matching-hub',
      skipWhenMissing: true,
    },
    {
      id: 'group-trade',
      title: '发起与成交',
      body: '点一张广场卡 → 选「我能给蛋」或「我能孵」→ 确认发起；对方确认后，进度和成交都在「我的换蛋」。',
      page: 'groups',
      anchor: 'egg-matching-hub',
      skipWhenMissing: true,
    },
  ],
  home: [
    {
      id: 'home-tabs',
      title: '家园分三块',
      body: '家园现状（窝和实际配对）/ 接单上窝（接的单上哪个窝）/ 我的蛋仓（手上的蛋）。',
      page: 'home',
      homeView: 'nests',
      anchor: 'home-tabs',
    },
    {
      id: 'home-pairs',
      title: '配窝卡',
      body: '每对父母、窝位、预计能出几只；卡底三格是个体三维，没采到会显「—」。',
      page: 'home',
      homeView: 'nests',
      selector: '[data-testid="home-pair-cards"]',
      skipWhenMissing: true,
    },
    {
      id: 'home-stock-character',
      title: '蛋仓先选角色',
      body: '一次只看一个角色：下拉里带每个号的蛋数，没有「全部角色」；主号没蛋也停在主号，免得以为丢蛋。',
      page: 'home',
      homeView: 'stock',
      selector: '[aria-label="按游戏角色筛选"]',
      skipWhenMissing: true,
    },
    {
      id: 'home-stock-label',
      title: '标注与挂出',
      body: '点开一颗蛋 → 标注性格/体型/声音/绿窝，或「标注所有同类蛋」；「挂出」后才会进换蛋广场。五项齐全会自动挂出，你手动下架过的不会被挂回。',
      page: 'home',
      homeView: 'stock',
      selector: '[data-testid="egg-stock-grid"]',
      skipWhenMissing: true,
    },
  ],
  // 2026-11-28 CLEAN2：文件导入已删除，「我的」段改为「采集 + 登录同步」任务线
  profile: [
    {
      id: 'profile-collect',
      title: '采集与登录同步',
      body: '点这里开始采集（安卓 / 电脑版）；网页版登录同一账号后点「立即同步」。入库结果留在本页，不会自动跳走。',
      profileSection: 'data',
      anchor: 'profile-sync',
    },
    {
      id: 'profile-account',
      title: '云同步（可选）',
      body: '开启后换手机不丢数据，也能在小组里认出是同一人。用用户名和密码登录，忘记密码找管理员重置。',
      profileSection: 'identity',
      anchor: 'profile-account',
    },
  ],
};

/** 分段顺序（首启主线在最前）；e2e 也按它预置「全部已读」。 */
export const TOUR_SEGMENT_ORDER: TourSegment[] = [
  'start',
  'dashboard',
  'collection',
  'nearby',
  'groups',
  'home',
  'profile',
];

/** 页签 → 分段（两边的 id 故意保持一致，重播当前页时直接取）。 */
export function segmentOfPage(page: TourPage): TourSegment {
  return page;
}

function readSeen(segment: TourSegment): string | null {
  if (typeof window === 'undefined') return null;
  // 经共享层读取：测试站与正式站各自一个 origin，切服后不该重弹教程
  return readShared(TOUR_SEEN_PREFIX + segment);
}

function writeSeen(segment: TourSegment): void {
  if (typeof window === 'undefined') return;
  writeShared(TOUR_SEEN_PREFIX + segment, TOUR_VERSION);
}

/** 这一段是否还没看过（版本号变了也算没看过）。 */
export function segmentPending(segment: TourSegment): boolean {
  return readSeen(segment) !== TOUR_VERSION;
}

export function markSegmentSeen(segment: TourSegment): void {
  writeSeen(segment);
}

/** 把本环境已有的「已读」同步进壳，切服后不再重弹（首次装新版时调用一次即可）。 */
export function syncTourSeen(): void {
  for (const segment of TOUR_SEGMENT_ORDER) syncShared(TOUR_SEEN_PREFIX + segment);
}

/** 首启主线是否还没走（只有它会在打开应用时自动弹）。 */
export function startTourPending(): boolean {
  return segmentPending('start');
}

/**
 * 测试版不自动弹新手引导（2026-11-09 用户口径：故意设计，别改）。
 *
 * `test.` / `internal.` 子域是给自己验收用的，每个页签都弹一次很打断；
 * 只关自动弹，顶部「教程」入口保留，仍可手动重播。正式域名与本地开发不受影响。
 */
export function tourSuppressed(hostname?: string): boolean {
  const host = hostname ?? (typeof window === 'undefined' ? '' : window.location.hostname);
  return host.startsWith('test.') || host.startsWith('internal.');
}

/** 是否还有任一分段待看（更新弹窗据此让路，避免两层浮层叠加）。 */
export function anyTourPending(): boolean {
  return TOUR_SEGMENT_ORDER.some(segmentPending);
}

/**
 * 老用户迁移（2026-11-01 拍板：重弹一次新的首启主线）。
 *
 * 旧键 `roco.tourSeen` 有值 = 看过旧版固定 15 步：这些用户已熟悉各页，
 * 分页引导不再自动打扰（标为已看），只把新的首启主线再弹一次。
 */
export function migrateLegacyTourSeen(): void {
  if (typeof window === 'undefined') return;
  let legacy: string | null = null;
  try {
    legacy = window.localStorage.getItem(LEGACY_TOUR_SEEN_KEY);
  } catch {
    return;
  }
  if (legacy === null) return;
  for (const segment of TOUR_SEGMENT_ORDER) {
    if (segment === 'start') continue;
    if (readSeen(segment) === null) writeSeen(segment);
  }
}
