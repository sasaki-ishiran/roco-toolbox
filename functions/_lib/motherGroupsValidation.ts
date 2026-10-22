/**
 * 多人母本共享：不信任客户端的输入校验与规范化。
 *
 * 所有错误都抛 `MotherInputError`（400 INVALID_INPUT / 413 PAYLOAD_TOO_LARGE），
 * 由 HTTP 层统一映射。校验失败的请求不会进入仓储层，因此不会落库。
 */
import {
  MOTHER_ACCOUNT_NAME_MAX,
  MOTHER_CATALOG_VERSION_MAX,
  MOTHER_CRITERIA_ID,
  MOTHER_DISPLAY_NAME_MAX,
  MOTHER_GROUP_NAME_MAX,
  MOTHER_INVITE_CODE_LENGTH,
  MOTHER_RESOURCE_MAX_ACCOUNTS,
  MOTHER_RESOURCE_MAX_BODY_BYTES,
  MOTHER_RESOURCE_MAX_EGGS_PER_ACCOUNT,
  MOTHER_RESOURCE_SCHEMA_VERSION,
  canonicalEggGameIds,
  isCanonicalMotherAccountKey,
  isValidIsoTimestamp,
  type MotherResourceDraft,
  type SharedMotherAccount,
} from '../../src/shared/motherGroups';

export class MotherInputError extends Error {
  readonly code: 'INVALID_INPUT' | 'PAYLOAD_TOO_LARGE';

  constructor(code: 'INVALID_INPUT' | 'PAYLOAD_TOO_LARGE', message: string) {
    super(message);
    this.name = 'MotherInputError';
    this.code = code;
  }
}

function invalid(message: string): never {
  throw new MotherInputError('INVALID_INPUT', message);
}

const asRecord = (value: unknown, field: string): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid(`${field} 必须是对象`);

/** code point 长度（`[...text].length`），不是 UTF-16 单元数。 */
const codePoints = (text: string): number => [...text].length;

/** 读请求体：先按 UTF-8 字节数限制（不信任 Content-Length），再严格解析 JSON。 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MOTHER_RESOURCE_MAX_BODY_BYTES) {
    throw new MotherInputError('PAYLOAD_TOO_LARGE', '请求体超过 128KiB');
  }
  if (raw.trim().length === 0) invalid('请求体为空');
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return invalid('不是有效的 JSON');
  }
}

export function parseGroupName(value: unknown): string {
  if (typeof value !== 'string') invalid('组名必须是字符串');
  const name = value.trim();
  const length = codePoints(name);
  if (length < 1 || length > MOTHER_GROUP_NAME_MAX) {
    invalid(`组名需要 1–${MOTHER_GROUP_NAME_MAX} 个字符`);
  }
  return name;
}

export function parseDisplayName(value: unknown): string {
  if (typeof value !== 'string') invalid('昵称必须是字符串');
  const name = value.trim();
  const length = codePoints(name);
  if (length < 1 || length > MOTHER_DISPLAY_NAME_MAX) {
    invalid(`昵称需要 1–${MOTHER_DISPLAY_NAME_MAX} 个字符`);
  }
  return name;
}

/** 邀请码：去掉首尾空白并转大写后必须是 8 位字母数字（字母表不含易混的 0/O/1/I）。 */
export function parseInviteCode(value: unknown): string {
  if (typeof value !== 'string') invalid('邀请码必须是字符串');
  const code = value.trim().toUpperCase();
  if (code.length !== MOTHER_INVITE_CODE_LENGTH || !/^[0-9A-Z]+$/.test(code)) {
    invalid('邀请码格式不对');
  }
  return code;
}

export interface ParsedPublishBody {
  baseRevision: number;
  resource: MotherResourceDraft;
}

export function parsePublishBody(body: unknown): ParsedPublishBody {
  const record = asRecord(body, '请求体');
  const baseRevision = record.baseRevision;
  if (
    typeof baseRevision !== 'number' ||
    !Number.isSafeInteger(baseRevision) ||
    baseRevision < 0
  ) {
    invalid('baseRevision 必须是非负整数');
  }
  return { baseRevision, resource: parseMotherResource(record.resource) };
}

export function parseMotherResource(value: unknown): MotherResourceDraft {
  const record = asRecord(value, 'resource');
  if (record.schemaVersion !== MOTHER_RESOURCE_SCHEMA_VERSION) {
    invalid('schemaVersion 不受支持');
  }
  if (record.criteriaId !== MOTHER_CRITERIA_ID) invalid('criteriaId 不受支持');

  const catalogVersion = record.catalogVersion;
  if (
    typeof catalogVersion !== 'string' ||
    catalogVersion.trim().length === 0 ||
    catalogVersion.length > MOTHER_CATALOG_VERSION_MAX
  ) {
    invalid(`catalogVersion 需要 1–${MOTHER_CATALOG_VERSION_MAX} 个字符`);
  }

  const rawAccounts = record.accounts;
  if (!Array.isArray(rawAccounts)) invalid('accounts 必须是数组');
  if (rawAccounts.length > MOTHER_RESOURCE_MAX_ACCOUNTS) {
    invalid(`最多共享 ${MOTHER_RESOURCE_MAX_ACCOUNTS} 个游戏账号`);
  }

  const seen = new Set<string>();
  const accounts: SharedMotherAccount[] = rawAccounts.map((item) => {
    const account = parseSharedAccount(item);
    if (seen.has(account.accountKey)) invalid(`游戏账号重复：${account.accountKey}`);
    seen.add(account.accountKey);
    return account;
  });
  accounts.sort((a, b) => Number(a.accountKey.slice(4)) - Number(b.accountKey.slice(4)));

  return {
    schemaVersion: MOTHER_RESOURCE_SCHEMA_VERSION,
    criteriaId: MOTHER_CRITERIA_ID,
    catalogVersion,
    accounts,
  };
}

function parseSharedAccount(value: unknown): SharedMotherAccount {
  const record = asRecord(value, '账号');
  const accountKey = record.accountKey;
  if (!isCanonicalMotherAccountKey(accountKey)) {
    invalid('accountKey 必须是规范的 uid:<正整数>');
  }
  const accountName = record.accountName;
  if (typeof accountName !== 'string') invalid('accountName 必须是字符串');
  const nameLength = codePoints(accountName);
  if (nameLength < 1 || nameLength > MOTHER_ACCOUNT_NAME_MAX) {
    invalid(`accountName 需要 1–${MOTHER_ACCOUNT_NAME_MAX} 个字符`);
  }
  const sourceExportedAt = record.sourceExportedAt;
  if (!isValidIsoTimestamp(sourceExportedAt)) invalid('sourceExportedAt 必须是有效 ISO 时间');

  const rawIds = record.eggGameIds;
  if (!Array.isArray(rawIds)) invalid('eggGameIds 必须是数组');
  if (rawIds.length > MOTHER_RESOURCE_MAX_EGGS_PER_ACCOUNT) {
    invalid(`每个账号最多 ${MOTHER_RESOURCE_MAX_EGGS_PER_ACCOUNT} 个蛋血脉`);
  }
  for (const id of rawIds) {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      invalid('eggGameIds 只能包含正安全整数');
    }
  }

  return {
    accountKey,
    accountName,
    sourceExportedAt,
    eggGameIds: canonicalEggGameIds(rawIds),
  };
}
