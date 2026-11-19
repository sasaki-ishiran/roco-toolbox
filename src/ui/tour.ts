/**
 * 新手引导（2026-11-01 第二轮：按场景分段，不再固定一条 15 步主线）。
 *
 * 分段规则：
 * - `start`：首次打开只讲「先采集一次数据」，采集/导入成功后收尾提示「教程」入口；
 * - 其余分段跟着页签走：用户第一次进入看板 / 收集 / 小组 / 家园 / 我的时各弹一次；
 * - 顶部「教程」按钮 = 直接重播**当前页**那一段（文字教程已下线）。
 *
 * 已读按**分段 + 版本号**记：以后某段步骤大改，把 `TOUR_VERSION` +1 即可让该段再弹一次。
 */
import { readShared, syncShared, writeShared } from '../api/sharedPrefs';

/** 旧版（固定 15 步）的已读键，只用于老用户迁移，不再写入 */
const LEGACY_TOUR_SEEN_KEY = 'roco.tourSeen';
const TOUR_SEEN_PREFIX = 'roco.tourSeen.';

/** 引导版本：改任一分段的步骤时 +1（1 = 固定 15 步；2 = 按场景分段；3 = 首启改为「开始采集」） */
export const TOUR_VERSION = '3';

/** 目标元素上挂的锚点属性；找不到时退化成居中说明卡。 */
export const TOUR_ANCHOR_ATTR = 'data-tour';

/** 收尾「从教程重看」这一步的固定 id：跳过时会先跳到它，再点一次才真正关闭。 */
export const TOUR_HINT_STEP_ID = 'tour-hint';

/**
 * 这里刻意不 import `navigation.ts`：本文件要被 e2e 工程直接引用（读版本号/步骤），
 * 而 e2e 的 TS 工程只收自包含模块。下列字面量类型与导航合同结构兼容，由 App 转成意图。
 */
export type TourPage = 'dashboard' | 'home' | 'collection' | 'nearby' | 'groups' | 'profile';
export type TourCollection =
  | { kind: 'mothers'; status: 'missing' | 'collected' | 'plan' }
  | { kind: 'studs'; view: 'coverage' }
  | { kind: 'inventory' };
export type TourProfileSection = 'identity' | 'data' | 'sync';

/** 引导分段：`start` 是首启主线，其余与页签名一一对应。 */
export type TourSegment = 'start' | TourPage;

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** 进入该步骤前要切到的页签（不填 = 停在当前页） */
  page?: TourPage;
  /** 切到收集页的某个视图（隐含 page = collection） */
  collection?: TourCollection;
  /** 切到「我的」的某个分区（隐含 page = profile） */
  profileSection?: TourProfileSection;
  /** 家园的两个分页由本机偏好记住，不属于导航合同 */
  homeView?: 'nests' | 'demands';
  /** 要高亮的元素的 data-tour 值 */
  anchor?: string;
  /** 本机还没有导入数据时停在这一步，导入成功后自动继续（「先导入一次」那步） */
  waitForImport?: boolean;
  /** 收尾的「从教程重看」一步：按钮文案为「知道了」 */
  hint?: boolean;
}

/** 收尾步：高亮顶部「教程」，告诉用户随时可以重看引导（只在 start 段保留，其余分段不再重复）。 */
const hintStep = (body: string): TourStep => ({
  id: TOUR_HINT_STEP_ID,
  title: '随时能重看引导',
  body,
  anchor: 'guide-open',
  hint: true,
});

/**
 * 分段步骤。
 * - `start` 只确保「第一次完整导入一次数据」，其余功能等用户进页面再讲；
 * - 页签分段沿用原来的讲解，只在开头补一次明确的页面跳转，保证从任意页重播都能落到正确位置。
 */
export const TOUR_SEGMENTS: Record<TourSegment, TourStep[]> = {
  start: [
    {
      id: 'start-profile',
      title: '先采集一次游戏数据',
      body: '第一次用，先到「我的 · 游戏数据」采集一次。看板的缺口、推荐种公、配窝建议都按这份数据算，没采集等于什么都看不到。',
      anchor: 'tab-profile',
    },
    {
      id: 'start-collect',
      title: '点「开始采集」',
      body: '在安卓版小布助手里点「开始采集」，按提示同意 VPN 授权，再打开游戏依次看一遍精灵仓库、背包与蛋仓。进度走满会自动停止、保存并导入；采集成功后会自动继续。',
      profileSection: 'data',
      anchor: 'collector-start',
      waitForImport: true,
    },
    hintStep('数据采集好后，看板会按它算缺口。随时点顶部「教程」，能重看当前页的分步引导；还没采集的话，也可以回「我的 · 游戏数据」再采一次。'),
  ],
  dashboard: [
    {
      id: 'dashboard-target',
      title: '先定种公目标',
      body: '全站按这里的当前模式和奖牌组合计算。四种组合选一项；追满分时声音须达到 +100 / -100，追双牌时按对应声音奖牌判定。',
      page: 'dashboard',
      anchor: 'dashboard-target',
    },
    {
      id: 'dashboard-actions',
      title: '今天该补什么',
      body: '这里按推荐性格列出还缺的母本与种公，点进去能看到具体缺哪几个蛋组。',
      anchor: 'dashboard-actions',
    },
    {
      id: 'dashboard-nest',
      title: '配窝建议',
      body: '按账号给出 11 个窝怎么摆、谁和谁配、每条线在补什么。摆位按游戏的窝尺寸与配对距离画。',
      anchor: 'dashboard-nest',
    },
  ],
  collection: [
    {
      id: 'collection-kinds',
      title: '收集页三个视图',
      body: '母本全收集看还缺哪些蛋，种公全收集看覆盖度，精灵背包看自己现有的精灵。',
      collection: { kind: 'mothers', status: 'missing' },
      anchor: 'collection-kinds',
    },
    {
      id: 'collection-studs',
      title: '覆盖度矩阵',
      body: '每个蛋组 × 每个要收的性格，绿色代表已有种公能覆盖。点一行展开看具体缺哪只。',
      collection: { kind: 'studs', view: 'coverage' },
      anchor: 'collection-studs',
    },
    {
      id: 'collection-mothers',
      title: '母本全收集',
      body: '按蛋统计还缺哪颗、缺什么性格。点开一颗蛋能看到组里谁有、怎么补最快。',
      collection: { kind: 'mothers', status: 'missing' },
      anchor: 'collection-mothers',
    },
  ],
  nearby: [
    {
      id: 'nearby-radar',
      title: '附近雷达',
      body: '采集时把视野内的野生精灵画成雷达：圆点是精灵，越靠外越远。橙色/紫/粉色点代表稀有，红圈代表可主动提醒。',
      page: 'nearby',
      anchor: 'nearby-radar',
    },
    {
      id: 'nearby-filters',
      title: '只看你要找的',
      body: '顶部「稀有」只看稀有精灵，「需求」只看需求中心在找的种族，「目标」只蹲你点名勾选的那几只。普通精灵离开视野即清理，高价值会保留 10 分钟。',
      anchor: 'nearby-filters',
    },
  ],
  groups: [
    {
      id: 'group-setup',
      title: '和朋友一起收集',
      body: '登录后新建小组，或填邀请码加入。组内共享母本与种公清单，不用各自重复收集。',
      page: 'groups',
      anchor: 'group-setup',
    },
    {
      id: 'group-card',
      title: '资源自动同步',
      body: '导入数据后会自动同步到小组，不用手动发布；只想共享部分账号，可以在这里调选号。',
      anchor: 'group-card',
    },
    {
      id: 'group-demands',
      title: '我缺的 / 需求中心 / 共同寻找',
      body: '「我缺的」发需求，「需求中心」接别人的单，「共同寻找」一起认领全组都没有的缺口。',
      anchor: 'group-demands',
    },
  ],
  home: [
    {
      id: 'home-tabs',
      title: '家园分两页',
      body: '「家园现状」看窝和实际配对；「接单上窝」看你在需求中心接的单该怎么上窝。',
      page: 'home',
      homeView: 'nests',
      anchor: 'home-tabs',
    },
    {
      id: 'home-placement',
      title: '接单上窝',
      body: '每个账号给出母本 / 种公和窝位，并标出大概能孵出多少符合要求的蛋；已在家园的会标绿。',
      homeView: 'demands',
      anchor: 'home-placement',
    },
  ],
  profile: [
    {
      id: 'profile-import',
      title: '先导入一次数据',
      body: '点这里采集或选文件导入。导入结果留在本页，不会自动跳走；数据旧了随时可以再导一次。',
      profileSection: 'data',
      anchor: 'profile-import',
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
 * 测试版不自动弹新手引导（2026-11-09 用户口径）。
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
