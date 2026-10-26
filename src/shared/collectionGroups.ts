/**
 * 小组收集二期：母本组 / 种公组的跨端类型、常量与纯校验。
 *
 * 与 `motherGroups.ts` 的关系：旧接口与旧类型保持不动，本文件只描述二期新增的
 * 「组类型 + 组目标 + 种公摘要 + 认领任务」。Functions 会直接类型导入本文件，
 * 因此**不能有 React / DOM / IndexedDB 依赖**，也不能 import `src/domain/*`
 * （那里依赖图鉴与浏览器数据）。档位与模式的字面量在这里单独声明，领域层用结构化
 * 兼容的同名字面量赋值。
 *
 * 设计见 `docs/superpowers/specs/2026-10-25-小组收集二期-母本组与种公组-design.md`。
 */
import { MOTHER_CRITERIA_ID, type PublishedMotherResource } from './motherGroups';

export const COLLECTION_GROUP_SCHEMA_VERSION = 1 as const;

/** 一个组只收一种目标；创建后不可修改。 */
export const COLLECTION_GROUP_TYPES = ['mother', 'stud'] as const;
export type CollectionGroupType = (typeof COLLECTION_GROUP_TYPES)[number];

export const GROUP_TYPE_LABELS: Record<CollectionGroupType, string> = {
  mother: '母本收集',
  stud: '种公收集',
};

export const TARGET_MODES = ['perfect', 'medal'] as const;
export type CollectionTargetMode = (typeof TARGET_MODES)[number];

export const TARGET_GRADES = ['大婉', '小婉', '大粗', '小粗'] as const;
export type CollectionTargetGrade = (typeof TARGET_GRADES)[number];

export const TARGET_MODES_LABELS: Record<CollectionTargetMode, string> = {
  perfect: '追满分',
  medal: '追双牌',
};

/** 母本声音 / 体型选项（与领域层同名字面量一致）。 */
export const MOTHER_TARGET_VOICES = ['婉转声', '+100', '-100', '粗嗓门'] as const;
export const MOTHER_TARGET_BODIES = ['大块头', '小不点'] as const;

/** 每个模式允许的母本声音：满分只看 ±100，双牌只看婉转/粗嗓。 */
export const motherVoicesForTargetMode = (mode: CollectionTargetMode): string[] =>
  mode === 'perfect' ? ['+100', '-100'] : ['婉转声', '粗嗓门'];

/** 种公组目标槽位上限；超过显式报错，不截断。 */
export const STUD_TARGET_MAX_SLOTS = 256;
/** 种公摘要：单账号最多 512 个覆盖格（已覆盖 + 可迭代）。 */
export const STUD_RESOURCE_MAX_SLOTS_PER_ACCOUNT = 512;
/** 种公摘要：最多 50 个账号（与母本一致，便于共用选号界面）。 */
export const STUD_RESOURCE_MAX_ACCOUNTS = 50;
/** 种公摘要请求体上限 256KiB。 */
export const STUD_RESOURCE_MAX_BODY_BYTES = 256 * 1024;

/** 母本自选口径的 criteriaId：默认沿用固定口径，自选时用稳定的 FNV 短哈希。 */
export function motherCriteriaIdOf(input: {
  mode: CollectionTargetMode;
  bodies: readonly string[];
  voices: readonly string[];
  /** 组内是否要求母本性格为推荐性格（2026-10-25）。 */
  requireRecommendedNatures?: boolean;
  /** 组长那一份推荐性格覆盖（蛋 gameId → 性格名）。 */
  natureOverrides?: Record<string, string[]>;
}): string {
  const bodies = [...new Set(input.bodies)].sort().join(',');
  const voices = [...new Set(input.voices)].sort().join(',');
  const requireNatures = input.requireRecommendedNatures === true;
  const isDefault =
    input.mode === 'perfect' && bodies === '大块头' && voices === '+100';
  if (isDefault && !requireNatures) return MOTHER_CRITERIA_ID;
  const natures = requireNatures
    ? `|natures|${natureOverridesSignature(input.natureOverrides)}`
    : '';
  return `mother-v2-${fnv1a(`${input.mode}|${bodies}|${voices}${natures}`)}`;
}

/** 推荐性格覆盖表的稳定签名：键排序、值去重排序，空值忽略。 */
export function natureOverridesSignature(overrides?: Record<string, string[]>): string {
  if (!overrides) return '';
  return Object.keys(overrides)
    .filter((key) => Array.isArray(overrides[key]) && overrides[key].length > 0)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .map((key) => `${key}:${[...new Set(overrides[key])].sort().join('/')}`)
    .join('|');
}

/**
 * 母本组口径的展示文案（界面「小组口径」用）：模式 + 体型 + 声音 + 是否要求推荐性格。
 * 与目标本身同源，别再写死「母 · 大块头 · +100dB」。
 */
export function motherTargetLabel(
  target: Pick<MotherTargetConfig, 'mode' | 'bodies' | 'voices' | 'requireRecommendedNatures'>,
): string {
  const bodies = target.bodies.join('/') || '体型不限';
  const voices = target.voices.join('/') || '声音不限';
  return `母 · ${bodies} · ${voices} · ${TARGET_MODES_LABELS[target.mode]}${
    target.requireRecommendedNatures ? ' · 推荐性格' : ''
  }`;
}

/** 种公目标的可比性标识：模式 + 排序后的槽位集合。 */
export function studSlotSetIdOf(target: {
  mode: CollectionTargetMode;
  slots: readonly Pick<StudTargetSlot, 'groupId' | 'natureId' | 'grade'>[];
}): string {
  const keys = target.slots.map(slotKeyOf).sort().join(',');
  return `stud-${fnv1a(`${target.mode}|${keys}`)}`;
}

/** 槽位键：蛋组 × 性格 × 档位。性格用 id，图鉴改名不影响。 */
export const slotKeyOf = (slot: Pick<StudTargetSlot, 'groupId' | 'natureId' | 'grade'>): string =>
  `${slot.groupId}:${slot.natureId}:${slot.grade}`;

/** 认领任务的目标键：母本按蛋血脉，种公按槽位。 */
export const motherTargetKey = (eggGameId: number): string => `mother:${eggGameId}`;
export const studTargetKey = (slot: Pick<StudTargetSlot, 'groupId' | 'natureId' | 'grade'>): string =>
  `stud:${slotKeyOf(slot)}`;

export interface MotherTargetConfig {
  kind: 'mother';
  criteriaId: string;
  mode: CollectionTargetMode;
  bodies: string[];
  voices: string[];
  catalogVersion: string;
  /**
   * 组内是否要求母本性格为推荐性格（2026-10-25 用户拍板，旧组默认关闭）。
   * 开启后按「组长那一份推荐性格表」判定，没改过的蛋用图鉴推荐 / 种族值兜底。
   */
  requireRecommendedNatures?: boolean;
  /** 组长那一份推荐性格覆盖：蛋 gameId → 性格名（只存改过的蛋）。 */
  natureOverrides?: Record<string, string[]>;
}

export interface StudTargetSlot {
  groupId: number;
  natureId: number;
  /** 性格显示名只用于展示；判定与比较都用 natureId。 */
  natureName: string;
  grade: CollectionTargetGrade;
}

export interface StudTargetConfig {
  kind: 'stud';
  mode: CollectionTargetMode;
  catalogVersion: string;
  slots: StudTargetSlot[];
}

export type GroupTargetConfig = MotherTargetConfig | StudTargetConfig;

/** 旧组的默认目标：母 · 大块头 · +100dB，与一期固定口径一致。 */
export function defaultMotherTarget(catalogVersion: string): MotherTargetConfig {
  return {
    kind: 'mother',
    criteriaId: MOTHER_CRITERIA_ID,
    mode: 'perfect',
    bodies: ['大块头'],
    voices: ['+100'],
    catalogVersion,
  };
}

/** 种公组尚未确认目标时的空目标（不计缺口，也不允许发布）。 */
export function emptyStudTarget(catalogVersion: string): StudTargetConfig {
  return { kind: 'stud', mode: 'perfect', catalogVersion, slots: [] };
}

export interface CollectionGroupConfig {
  groupType: CollectionGroupType;
  targetRevision: number;
  resourceEpoch: number;
  target: GroupTargetConfig | null;
  updatedAt: number;
}

export interface CollectionGroupInfo {
  id: string;
  name: string;
  ownerAccountId: string;
  createdAt: number;
  groupType: CollectionGroupType;
  targetRevision: number;
  resourceEpoch: number;
  target: GroupTargetConfig | null;
}

export interface CollectionGroupSummary {
  id: string;
  name: string;
  ownerAccountId: string;
  memberCount: number;
  groupType: CollectionGroupType;
  targetRevision: number;
  /** 种公组是否已确认目标；母本组恒为 true。 */
  targetReady: boolean;
}

/** 种公摘要里的一格：覆盖或可迭代的槽位 + 来源物种。 */
export interface StudSlotCoverage {
  groupId: number;
  natureId: number;
  grade: CollectionTargetGrade;
  /** 来源物种 gameId，仅用于回游戏里找；不传个体 ID / 声音数值 / 背包。 */
  gameId: number;
}

export interface SharedStudAccount {
  accountKey: string;
  accountName: string;
  sourceExportedAt: string;
  /** 真实公精灵覆盖的槽位（去重、排序）。 */
  covered: StudSlotCoverage[];
  /** 同账号内可自己孵出的槽位（母方带目标性格 + 公方存在 + 母方物种能出公）。 */
  breedable: StudSlotCoverage[];
}

export interface StudResourceDraft {
  schemaVersion: typeof COLLECTION_GROUP_SCHEMA_VERSION;
  kind: 'stud';
  mode: CollectionTargetMode;
  catalogVersion: string;
  /** 目标槽位集合的稳定标识；与服务器目标不一致时拒绝。 */
  targetId: string;
  targetRevision: number;
  accounts: SharedStudAccount[];
}

export interface PublishedStudResource extends StudResourceDraft {
  revision: number;
  publishedAt: number;
}

/** 组详情里的成员：母本组只有 `resource`，种公组只有 `studResource`。 */
export interface CollectionGroupMember {
  accountId: string;
  displayName: string;
  joinedAt: number;
  resourceRevision: number;
  resource: PublishedMotherResource | null;
  studResource: PublishedStudResource | null;
}

export interface CollectionGroupDetail {
  group: CollectionGroupInfo;
  members: CollectionGroupMember[];
}

/* ---------- 认领任务 ---------- */

export const TASK_STATUSES = ['open', 'claimed', 'closed'] as const;
export type CollectionTaskStatus = (typeof TASK_STATUSES)[number];

export interface CollectionTaskRecord {
  groupId: string;
  targetRevision: number;
  targetKey: string;
  round: number;
  status: CollectionTaskStatus;
  ownerAccountId: string | null;
  /** 每次状态变化递增，用于客户端判断是否过期。 */
  version: number;
  updatedAt: number;
  closedAt: number | null;
}

export interface CollectionTaskView extends CollectionTaskRecord {
  /** 当前目标修订下、已发布成员是否都确认无来源。 */
  confirmed: boolean;
  /** 未确认时的原因：有人未发布 / 版本不兼容。 */
  pendingMemberIds: string[];
}

/* ---------- 需求承接（2026-10-26） ---------- */

/**
 * 成员发布的需求：某颗蛋 + 一个性格。
 *
 * 2026-10-26 用户口径：**一个性格算一条需求**。发需求时勾了两个性格就成了两条，
 * 接单也按单条（一个人可以接「固执」那条，另一个人接「平和」那条）。
 * `nature === ''` 表示不挑性格。
 */
export const DEMAND_STATUSES = ['open', 'claimed', 'done'] as const;
export type CollectionDemandStatus = (typeof DEMAND_STATUSES)[number];

export const DEMAND_STATUS_LABELS: Record<CollectionDemandStatus, string> = {
  open: '待承接',
  claimed: '已接单',
  done: '已完成',
};

/** 一条需求最多几个性格、单个性格名的长度上限（防异常请求体）。 */
export const DEMAND_NATURE_MAX = 6;
export const DEMAND_NATURE_LENGTH_MAX = 8;

/**
 * 需求 / 承接上限（2026-10-26 用户给的产能模型）：
 * 20 人 × 约 5 蛋 ≈ 100 份供给，每人发 5 条需求正好闭环。
 * 所以按「5 × 本人在本组发布的游戏账号数」算，多号多额度。
 */
export const DEMAND_LIMIT_PER_ACCOUNT = 5;
/** 单成员绝对上限（防刷屏）。 */
export const DEMAND_LIMIT_PER_MEMBER_CAP = 20;
/** 单个小组需求总数上限（20 人 × 10）。 */
export const DEMAND_LIMIT_PER_GROUP = 200;

/** 某成员在当前小组的需求上限；账号数未发布时按 1 算。 */
export function demandLimitPerMember(accountCount: number): number {
  const accounts =
    Number.isFinite(accountCount) && accountCount > 0 ? Math.floor(accountCount) : 1;
  return Math.min(DEMAND_LIMIT_PER_ACCOUNT * accounts, DEMAND_LIMIT_PER_MEMBER_CAP);
}

export interface CollectionDemand {
  groupId: string;
  demanderAccountId: string;
  eggGameId: number;
  /** 这一条需求要的性格；空字符串 = 不挑性格。 */
  nature: string;
  status: CollectionDemandStatus;
  claimerAccountId: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

/** 需求性格是否合法：0~6 个、非空、长度受限、去重后仍合法。 */
export function isValidDemandNatures(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > DEMAND_NATURE_MAX) return false;
  return value.every(
    (nature) =>
      typeof nature === 'string' &&
      nature.trim().length > 0 &&
      nature.length <= DEMAND_NATURE_LENGTH_MAX,
  );
}

/* ---------- 校验辅助（前后端共用） ---------- */

export const isCollectionGroupType = (value: unknown): value is CollectionGroupType =>
  value === 'mother' || value === 'stud';

export const isTargetMode = (value: unknown): value is CollectionTargetMode =>
  value === 'perfect' || value === 'medal';

export const isTargetGrade = (value: unknown): value is CollectionTargetGrade =>
  typeof value === 'string' && (TARGET_GRADES as readonly string[]).includes(value);

/** 稳定短哈希（FNV-1a 32bit），只用于生成标识，不做安全用途。 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 组目标是否可以用于计算缺口 / 发布：种公组必须至少一个槽位。 */
export function isTargetReady(
  groupType: CollectionGroupType,
  target: GroupTargetConfig | null,
): boolean {
  if (!target) return false;
  if (groupType === 'mother') return target.kind === 'mother' && target.criteriaId.length > 0;
  return target.kind === 'stud' && target.slots.length > 0;
}

/** 推荐性格覆盖：最多多少个蛋、每颗蛋最多几个性格（防止异常请求体）。 */
export const NATURE_OVERRIDE_MAX_EGGS = 900;
export const NATURE_OVERRIDE_MAX_NATURES = 6;

/** 覆盖表是否合法：键是正整数、值是 1~6 个非空性格名。 */
export function isValidNatureOverrides(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > NATURE_OVERRIDE_MAX_EGGS) return false;
  return entries.every(([key, natures]) => {
    if (!/^[1-9]\d*$/.test(key)) return false;
    if (!Array.isArray(natures) || natures.length === 0) return false;
    if (natures.length > NATURE_OVERRIDE_MAX_NATURES) return false;
    return natures.every((nature) => typeof nature === 'string' && nature.trim().length > 0 && nature.length <= 8);
  });
}

/** 母本目标是否合法：模式与声音/体型必须匹配，覆盖表结构合法。 */
export function isValidMotherTarget(target: MotherTargetConfig): boolean {
  const allowedVoices = motherVoicesForTargetMode(target.mode);
  if (target.voices.length === 0 || target.bodies.length === 0) return false;
  if (target.voices.some((voice) => !allowedVoices.includes(voice))) return false;
  if (!target.bodies.every((body) => (MOTHER_TARGET_BODIES as readonly string[]).includes(body))) {
    return false;
  }
  if (target.natureOverrides !== undefined && !isValidNatureOverrides(target.natureOverrides)) {
    return false;
  }
  return true;
}

/** 种公目标是否合法：槽位不重复、数量与取值在范围内。 */
export function isValidStudTarget(target: StudTargetConfig): boolean {
  if (!isTargetMode(target.mode)) return false;
  if (target.slots.length === 0 || target.slots.length > STUD_TARGET_MAX_SLOTS) return false;
  const seen = new Set<string>();
  for (const slot of target.slots) {
    if (!Number.isSafeInteger(slot.groupId) || slot.groupId <= 0) return false;
    if (!Number.isSafeInteger(slot.natureId) || slot.natureId <= 0) return false;
    if (!isTargetGrade(slot.grade)) return false;
    if (typeof slot.natureName !== 'string' || slot.natureName.trim().length === 0) return false;
    const key = slotKeyOf(slot);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
