/**
 * 小组收集二期：新增请求体的严格校验。
 *
 * 所有校验失败抛 `MotherInputError`（400 / 413），不落库。
 * 这里只处理二期新增的字段；母本摘要仍走 `motherGroupsValidation.parseMotherResource`。
 */
import { MotherInputError, parseMotherResource } from './motherGroupsValidation';
import {
  MOTHER_CATALOG_VERSION_MAX,
  MOTHER_DISPLAY_NAME_MAX,
  isCanonicalMotherAccountKey,
  isValidIsoTimestamp,
  type MotherResourceDraft,
} from '../../src/shared/motherGroups';
import {
  COLLECTION_GROUP_SCHEMA_VERSION,
  MOTHER_TARGET_BODIES,
  STUD_RESOURCE_MAX_ACCOUNTS,
  STUD_RESOURCE_MAX_SLOTS_PER_ACCOUNT,
  STUD_TARGET_MAX_SLOTS,
  defaultMotherTarget,
  isCollectionGroupType,
  isTargetGrade,
  isTargetMode,
  isValidMotherTarget,
  isValidNatureOverrides,
  motherCriteriaIdOf,
  motherVoicesForTargetMode,
  slotKeyOf,
  type CollectionGroupType,
  type CollectionTargetGrade,
  type CollectionTargetMode,
  type GroupTargetConfig,
  type MotherTargetConfig,
  type SharedStudAccount,
  type StudResourceDraft,
  type StudSlotCoverage,
  type StudTargetConfig,
} from '../../src/shared/collectionGroups';

function invalid(message: string): never {
  throw new MotherInputError('INVALID_INPUT', message);
}

const asRecord = (value: unknown, field: string): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid(`${field} 必须是对象`);

const codePoints = (text: string): number => [...text].length;

const parseCatalogVersion = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > MOTHER_CATALOG_VERSION_MAX
  ) {
    invalid(`catalogVersion 需要 1–${MOTHER_CATALOG_VERSION_MAX} 个字符`);
  }
  return value;
};

export interface ParsedCollectionCreate {
  name: string;
  displayName: string;
  groupType: CollectionGroupType;
  target: GroupTargetConfig;
}

/** 创建：类型 + 组名 + 昵称；种公组允许先建组、目标留空（稍后确认）。 */
export function parseCollectionCreateBody(body: unknown): ParsedCollectionCreate {
  const record = asRecord(body, '请求体');
  const groupType = record.groupType;
  if (!isCollectionGroupType(groupType)) invalid('groupType 必须是 mother 或 stud');

  const name = record.name;
  if (typeof name !== 'string') invalid('组名必须是字符串');
  if (codePoints(name.trim()) < 1 || codePoints(name.trim()) > 40) invalid('组名需要 1–40 个字符');

  const displayName = record.displayName;
  if (typeof displayName !== 'string') invalid('昵称必须是字符串');
  if (
    codePoints(displayName.trim()) < 1 ||
    codePoints(displayName.trim()) > MOTHER_DISPLAY_NAME_MAX
  ) {
    invalid(`昵称需要 1–${MOTHER_DISPLAY_NAME_MAX} 个字符`);
  }

  const target =
    record.target === undefined || record.target === null
      ? groupType === 'mother'
        ? defaultMotherTarget('')
        : { kind: 'stud' as const, mode: 'perfect' as const, catalogVersion: '', slots: [] }
      : parseCollectionTarget(record.target, groupType, { allowEmptyStud: true });

  return {
    name: name.trim(),
    displayName: displayName.trim(),
    groupType,
    target,
  };
}

export function parseCollectionTarget(
  value: unknown,
  groupType: CollectionGroupType,
  options: { allowEmptyStud?: boolean } = {},
): GroupTargetConfig {
  const record = asRecord(value, 'target');
  if (record.kind !== groupType) invalid('目标类型与小组类型不一致');
  if (!isTargetMode(record.mode)) invalid('mode 必须是 perfect 或 medal');
  const mode = record.mode as CollectionTargetMode;
  const catalogVersion = parseCatalogVersion(record.catalogVersion);

  if (groupType === 'mother') {
    const bodies = parseStringList(record.bodies, 'bodies');
    const voices = parseStringList(record.voices, 'voices');
    if (bodies.length === 0) invalid('至少选择一种体型');
    if (voices.length === 0) invalid('至少选择一种声音');
    const allowedVoices = motherVoicesForTargetMode(mode);
    if (voices.some((voice) => !allowedVoices.includes(voice))) {
      invalid('声音选项与目标模式不一致');
    }
    if (bodies.some((body) => !(MOTHER_TARGET_BODIES as readonly string[]).includes(body))) {
      invalid('体型选项不受支持');
    }
    const requireRecommendedNatures = record.requireRecommendedNatures === true;
    let natureOverrides: Record<string, string[]> | undefined;
    if (record.natureOverrides !== undefined && record.natureOverrides !== null) {
      if (!isValidNatureOverrides(record.natureOverrides)) invalid('推荐性格覆盖表不合法');
      natureOverrides = record.natureOverrides;
    }
    const target: MotherTargetConfig = {
      kind: 'mother',
      criteriaId: motherCriteriaIdOf({ mode, bodies, voices, requireRecommendedNatures, natureOverrides }),
      mode,
      bodies,
      voices,
      catalogVersion,
      ...(requireRecommendedNatures ? { requireRecommendedNatures: true } : {}),
      ...(natureOverrides ? { natureOverrides } : {}),
    };
    if (!isValidMotherTarget(target)) invalid('母本目标不合法');
    return target;
  }

  const rawSlots = record.slots;
  if (!Array.isArray(rawSlots)) invalid('slots 必须是数组');
  if (rawSlots.length > STUD_TARGET_MAX_SLOTS) {
    invalid(`槽位最多 ${STUD_TARGET_MAX_SLOTS} 个`);
  }
  if (rawSlots.length === 0 && options.allowEmptyStud !== true) {
    invalid('种公目标至少要有一个槽位');
  }
  const seen = new Set<string>();
  const slots: StudTargetConfig['slots'] = rawSlots.map((item) => {
    const slot = asRecord(item, '槽位');
    if (!Number.isSafeInteger(slot.groupId) || (slot.groupId as number) <= 0) {
      invalid('槽位 groupId 必须是正整数');
    }
    if (!Number.isSafeInteger(slot.natureId) || (slot.natureId as number) <= 0) {
      invalid('槽位 natureId 必须是正整数');
    }
    if (!isTargetGrade(slot.grade)) invalid('槽位档位不受支持');
    if (typeof slot.natureName !== 'string' || slot.natureName.trim().length === 0) {
      invalid('槽位缺少性格名');
    }
    const parsed = {
      groupId: slot.groupId as number,
      natureId: slot.natureId as number,
      natureName: slot.natureName.trim(),
      grade: slot.grade as CollectionTargetGrade,
    };
    const key = slotKeyOf(parsed);
    if (seen.has(key)) invalid('槽位重复');
    seen.add(key);
    return parsed;
  });
  slots.sort(
    (a, b) => a.groupId - b.groupId || a.natureId - b.natureId || a.grade.localeCompare(b.grade),
  );
  return { kind: 'stud', mode, catalogVersion, slots };
}

const parseStringList = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) invalid(`${field} 必须是数组`);
  const list = [...new Set(value.map((item) => {
    if (typeof item !== 'string' || item.trim().length === 0) invalid(`${field} 只能包含非空字符串`);
    return item.trim();
  }))];
  return list;
};

export interface ParsedCollectionPublish {
  baseRevision: number;
  /** null = 请求没带（旧客户端）；母本仍由 criteriaId 兜底。 */
  baseTargetRevision: number | null;
  resource: MotherResourceDraft | StudResourceDraft;
}

export function parseCollectionPublishBody(
  body: unknown,
  groupType: CollectionGroupType,
): ParsedCollectionPublish {
  const record = asRecord(body, '请求体');
  const baseRevision = record.baseRevision;
  if (
    typeof baseRevision !== 'number' ||
    !Number.isSafeInteger(baseRevision) ||
    baseRevision < 0
  ) {
    invalid('baseRevision 必须是非负整数');
  }
  const baseTargetRevision = record.baseTargetRevision;
  if (
    baseTargetRevision !== undefined &&
    (typeof baseTargetRevision !== 'number' ||
      !Number.isSafeInteger(baseTargetRevision) ||
      baseTargetRevision < 0)
  ) {
    invalid('baseTargetRevision 必须是非负整数');
  }

  if (groupType === 'mother') {
    return {
      baseRevision,
      baseTargetRevision: typeof baseTargetRevision === 'number' ? baseTargetRevision : null,
      resource: parseMotherResource(record.resource),
    };
  }
  if (typeof baseTargetRevision !== 'number') invalid('种公组发布必须带 baseTargetRevision');
  return {
    baseRevision,
    baseTargetRevision,
    resource: parseStudResource(record.resource),
  };
}

export function parseStudResource(value: unknown): StudResourceDraft {
  const record = asRecord(value, 'resource');
  if (record.schemaVersion !== COLLECTION_GROUP_SCHEMA_VERSION) invalid('schemaVersion 不受支持');
  if (record.kind !== 'stud') invalid('种公组只能发布种公摘要');
  if (!isTargetMode(record.mode)) invalid('mode 不受支持');
  const mode = record.mode as CollectionTargetMode;
  const catalogVersion = parseCatalogVersion(record.catalogVersion);
  if (typeof record.targetId !== 'string' || record.targetId.length === 0 || record.targetId.length > 80) {
    invalid('targetId 无效');
  }
  const targetRevision = record.targetRevision;
  if (
    typeof targetRevision !== 'number' ||
    !Number.isSafeInteger(targetRevision) ||
    targetRevision < 0
  ) {
    invalid('targetRevision 必须是非负整数');
  }
  const rawAccounts = record.accounts;
  if (!Array.isArray(rawAccounts)) invalid('accounts 必须是数组');
  if (rawAccounts.length > STUD_RESOURCE_MAX_ACCOUNTS) {
    invalid(`最多共享 ${STUD_RESOURCE_MAX_ACCOUNTS} 个游戏账号`);
  }
  const seen = new Set<string>();
  const accounts: SharedStudAccount[] = rawAccounts.map((item) => {
    const account = parseStudAccount(item);
    if (seen.has(account.accountKey)) invalid(`游戏账号重复：${account.accountKey}`);
    seen.add(account.accountKey);
    return account;
  });
  accounts.sort((a, b) => Number(a.accountKey.slice(4)) - Number(b.accountKey.slice(4)));

  return {
    schemaVersion: COLLECTION_GROUP_SCHEMA_VERSION,
    kind: 'stud',
    mode,
    catalogVersion,
    targetId: record.targetId,
    targetRevision,
    accounts,
  };
}

function parseStudAccount(value: unknown): SharedStudAccount {
  const record = asRecord(value, '账号');
  const accountKey = record.accountKey;
  if (!isCanonicalMotherAccountKey(accountKey)) {
    invalid('accountKey 必须是规范的 uid:<正整数>');
  }
  if (typeof record.accountName !== 'string') invalid('accountName 必须是字符串');
  if (codePoints(record.accountName) < 1 || codePoints(record.accountName) > 80) {
    invalid('accountName 需要 1–80 个字符');
  }
  if (!isValidIsoTimestamp(record.sourceExportedAt)) invalid('sourceExportedAt 必须是有效 ISO 时间');

  const covered = parseSlotList(record.covered, 'covered');
  const breedable = parseSlotList(record.breedable, 'breedable');
  if (covered.length + breedable.length > STUD_RESOURCE_MAX_SLOTS_PER_ACCOUNT) {
    invalid(`每个账号最多 ${STUD_RESOURCE_MAX_SLOTS_PER_ACCOUNT} 个覆盖格`);
  }
  return {
    accountKey,
    accountName: record.accountName,
    sourceExportedAt: record.sourceExportedAt,
    covered,
    breedable,
  };
}

function parseSlotList(value: unknown, field: string): StudSlotCoverage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid(`${field} 必须是数组`);
  const seen = new Set<string>();
  const slots: StudSlotCoverage[] = value.map((item) => {
    const record = asRecord(item, field);
    if (!Number.isSafeInteger(record.groupId) || (record.groupId as number) <= 0) {
      invalid(`${field}.groupId 必须是正整数`);
    }
    if (!Number.isSafeInteger(record.natureId) || (record.natureId as number) <= 0) {
      invalid(`${field}.natureId 必须是正整数`);
    }
    if (!isTargetGrade(record.grade)) invalid(`${field}.grade 不受支持`);
    if (!Number.isSafeInteger(record.gameId) || (record.gameId as number) <= 0) {
      invalid(`${field}.gameId 必须是正整数`);
    }
    const slot: StudSlotCoverage = {
      groupId: record.groupId as number,
      natureId: record.natureId as number,
      grade: record.grade as CollectionTargetGrade,
      gameId: record.gameId as number,
    };
    const key = slotKeyOf(slot);
    if (seen.has(key)) invalid(`${field} 槽位重复`);
    seen.add(key);
    return slot;
  });
  return slots.sort(
    (a, b) => a.groupId - b.groupId || a.natureId - b.natureId || a.grade.localeCompare(b.grade),
  );
}

/** 组长改目标：必须带 baseTargetRevision，目标类型与组一致。 */
export function parseTargetUpdateBody(
  value: unknown,
  groupType: CollectionGroupType,
): { baseTargetRevision: number; target: GroupTargetConfig } {
  const record = asRecord(value, '请求体');
  const baseTargetRevision = record.baseTargetRevision;
  if (
    typeof baseTargetRevision !== 'number' ||
    !Number.isSafeInteger(baseTargetRevision) ||
    baseTargetRevision < 0
  ) {
    invalid('baseTargetRevision 必须是非负整数');
  }
  return {
    baseTargetRevision,
    target: parseCollectionTarget(record.target, groupType),
  };
}
