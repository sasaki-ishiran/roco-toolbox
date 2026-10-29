/**
 * 多人母本资源共享的跨端类型与常量（前后端共用）。
 *
 * 这个文件**不能有 React / DOM / IndexedDB 依赖**：`functions/tsconfig.json` 的 lib 只有 ES2022，
 * Functions 会直接类型导入它。只放类型、常量与纯校验辅助。
 *
 * 设计见 `docs/superpowers/specs/2026-10-23-多人母本资源共享-design.md`。
 */

/**
 * 一期固定口径：母 + 大块头 + +100dB，不限制性格。
 *
 * v2（2026-10-26）：合格判定加入身高极端值；2026-10-28 进一步改为
 * 「身高 100% / 0% 且体重 ≥95% / ≤5% 同时满足」。
 * 判据变了就必须换版本：旧摘要按旧阈值算出的产线不能再当成可比，
 * 否则组内会把实际已有的资源当成「已确认缺口」。旧摘要统一显示「需更新」。
 */
export const MOTHER_CRITERIA_ID = 'female-huge-voice100-v2' as const;

/**
 * 口径标识是稳定字符串：一期固定值 + 二期自选的 `mother-v2-<8hex>`。
 */
export type MotherCriteriaId = string;

/**
 * 母本资源的口径版本（2026-10-29 代码审查 B2-H01）。
 *
 * - v2（2026-10-28 晚）：合格体型改为「身高 100% + 体重 ≥95%」同时满足，产线会因此变化；
 * - v3（2026-10-29）：产线档位依赖目标模式（追满分要 ±100、追双牌 ≥96），模式必须跟着摘要走，
 *   否则组长切换模式后组内会混用两种产线口径。
 *
 * D1 没有 mode 列、本轮也不改迁移，所以把模式编进 criteriaId：服务端原样存储，客户端
 * `isMotherResourceComparable` 用「期望 criteriaId」比较，切模式后全员自动变成「需更新」。
 */
export type MotherResourceMode = 'perfect' | 'medal';

export const motherResourceCriteriaIdOf = (mode: MotherResourceMode): MotherCriteriaId =>
  mode === 'medal' ? 'all-mothers-v3-medal' : 'all-mothers-v3-perfect';

export const MOTHER_RESOURCE_SCHEMA_VERSION = 1 as const;

/** 每组最多 20 人（设计第 5 节）。 */
export const MOTHER_GROUP_MAX_MEMBERS = 20;
/** 每次发布最多 50 个游戏账号。 */
export const MOTHER_RESOURCE_MAX_ACCOUNTS = 50;
/** 每个账号最多 1024 个蛋血脉 ID。 */
export const MOTHER_RESOURCE_MAX_EGGS_PER_ACCOUNT = 1024;
/** 请求体上限 128KiB（按 UTF-8 字节算，不信任 Content-Length）。 */
export const MOTHER_RESOURCE_MAX_BODY_BYTES = 128 * 1024;
/** 账号名 1–80 个 Unicode 码点。 */
export const MOTHER_ACCOUNT_NAME_MAX = 80;
/** 图鉴版本 1–80 字符。 */
export const MOTHER_CATALOG_VERSION_MAX = 80;
/** 组名 1–40 个 Unicode 码点。 */
export const MOTHER_GROUP_NAME_MAX = 40;
/**
 * 小组昵称长度上限（2026-10-26 收紧到 6）：
 * 与卡片里昵称的展示宽度一致——卡片最多显示 6 个字，超过就会截断，
 * 所以在创建 / 加入小组时就限制住，避免出现「卡片里被截断」的情况。
 */
export const MOTHER_DISPLAY_NAME_MAX = 6;
/** 邀请码长度（明文只返回一次）。 */
export const MOTHER_INVITE_CODE_LENGTH = 8;

/** 产线档位：与领域层的 PetGrade 同名字面量。 */
export const PRODUCTION_LINE_GRADES = ['大婉', '小婉', '大粗', '小粗'] as const;
export type ProductionLineGrade = (typeof PRODUCTION_LINE_GRADES)[number];

/** 单账号最多共享多少条产线；超过显式拒绝，不静默截断。 */
export const PRODUCTION_LINE_MAX_PER_ACCOUNT = 1024;
/** 单条产线最多多少个性格（母本 + 可配公）。 */
export const PRODUCTION_LINE_MAX_NATURES = 30;

/**
 * 一条可共享的产线：同账号、双方同档位、能产出的蛋 × 性格。
 * 这是从完整精灵库算出来的派生数据，不上传整箱精灵。
 */
export interface SharedProductionLine {
  eggGameId: number;
  grade: ProductionLineGrade;
  /** 去重、排序；母本性格 ∪ 同档位可配公的性格。 */
  natures: string[];
}

/** 一个共享的游戏账号（按游戏 UID 识别，不靠显示名）。 */
export interface SharedMotherAccount {
  /** 规范形式 `uid:<正整数>`，服务端校验。 */
  accountKey: string;
  accountName: string;
  /** 有效 ISO 时间，来自游戏数据导出（`AccountSnapshot.exportedAt`）。 */
  sourceExportedAt: string;
  /** 去重、升序；只含达标母本的蛋血脉 ID。 */
  eggGameIds: number[];
  /**
   * 同账号产线（2026-10-27）。
   * `undefined` = 旧摘要没带（未知，需要重新发布）；`[]` = 已发布但确实没有产线。
   */
  lines?: SharedProductionLine[];
}

/** 按蛋 + 档位聚合产线，合并性格并稳定排序；不做合法性校验。 */
export function canonicalProductionLines(
  lines: readonly SharedProductionLine[],
): SharedProductionLine[] {
  const byKey = new Map<string, Set<string>>();
  for (const line of lines) {
    const key = `${line.eggGameId}|${line.grade}`;
    const natures = byKey.get(key) ?? new Set<string>();
    for (const nature of line.natures) {
      if (typeof nature === 'string' && nature.trim()) natures.add(nature);
    }
    byKey.set(key, natures);
  }
  return [...byKey.entries()]
    .map(([key, natures]) => {
      const [eggGameId, grade] = key.split('|');
      return {
        eggGameId: Number(eggGameId),
        grade: grade as ProductionLineGrade,
        natures: [...natures].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
      };
    })
    .sort(
      (a, b) =>
        a.eggGameId - b.eggGameId ||
        PRODUCTION_LINE_GRADES.indexOf(a.grade) - PRODUCTION_LINE_GRADES.indexOf(b.grade),
    );
}

export const isProductionLineGrade = (value: unknown): value is ProductionLineGrade =>
  typeof value === 'string' && (PRODUCTION_LINE_GRADES as readonly string[]).includes(value);

export interface MotherResourceDraft {
  schemaVersion: typeof MOTHER_RESOURCE_SCHEMA_VERSION;
  criteriaId: MotherCriteriaId;
  catalogVersion: string;
  accounts: SharedMotherAccount[];
}

export interface PublishedMotherResource extends MotherResourceDraft {
  /** 每次写入（含撤回）都递增，不因空摘要归零。 */
  revision: number;
  /** 服务器毫秒时间。 */
  publishedAt: number;
}

export interface MotherGroupMember {
  /** 工具箱身份，服务器从 token 获取写入方；客户端不能自报。 */
  accountId: string;
  displayName: string;
  joinedAt: number;
  resourceRevision: number;
  /** null = 尚未发布或已停止共享。 */
  resource: PublishedMotherResource | null;
}

export interface MotherGroupInfo {
  id: string;
  name: string;
  ownerAccountId: string;
  createdAt: number;
}

export interface MotherGroupSummary {
  id: string;
  name: string;
  ownerAccountId: string;
  memberCount: number;
}

export interface MotherGroupDetail {
  group: MotherGroupInfo;
  members: MotherGroupMember[];
}

/** 覆盖行里的一位拥有者，保留来源游戏账号。 */
export interface MotherCoverageHolder {
  accountId: string;
  accountKeys: string[];
}

export interface MotherCoverageRow {
  eggGameId: number;
  /** 蛋物种的显示名（`speciesDisplayName()`）。 */
  name: string;
  holders: MotherCoverageHolder[];
  /** 已发布且口径/图鉴一致的成员里，没有这枚母本的。 */
  missingMemberIds: string[];
  /** 尚未发布、已停止共享或口径/图鉴不兼容的成员；未知不当成缺。 */
  unknownMemberIds: string[];
}

export type MotherApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_MEMBER'
  | 'NOT_OWNER'
  | 'GROUP_NOT_FOUND'
  | 'GROUP_FULL'
  | 'INVALID_INPUT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'REVISION_CONFLICT'
  | 'STALE_SOURCE'
  | 'SOURCE_MISMATCH'
  | 'GAME_ACCOUNT_ALREADY_SHARED'
  | 'OWNER_MUST_DISSOLVE'
  | 'INTERNAL';

export interface MotherApiError {
  ok: false;
  code: MotherApiErrorCode;
  error: string;
}

export type MotherApiSuccess<T> = { ok: true } & T;
export type MotherApiResult<T> = MotherApiSuccess<T> | MotherApiError;

/** 游戏账号键是否规范：`uid:<正整数>`（且能安全表示为整数）。 */
export function isCanonicalMotherAccountKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  if (!/^uid:[1-9]\d*$/.test(key)) return false;
  return Number.isSafeInteger(Number(key.slice(4)));
}

/**
 * 是否是有效 ISO 时间（带日期与时间、允许毫秒与时区）。
 * 只认字符串里真实可解析的时刻；`''`、纯日期、随机文本都算无效。
 */
export function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

/** 蛋血脉 ID 规范化：只留正安全整数，去重并升序。 */
export function canonicalEggGameIds(ids: readonly unknown[]): number[] {
  const set = new Set<number>();
  for (const id of ids) {
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) set.add(id);
  }
  return [...set].sort((a, b) => a - b);
}
