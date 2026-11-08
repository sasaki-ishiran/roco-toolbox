/**
 * 小组收集二期：组类型 / 组目标 / 种公摘要的 D1 读写。
 *
 * 与一期的关系：
 * - 旧表 `mother_groups` / `mother_group_members` / `mother_group_accounts` 原样复用；
 * - 新增 `collection_group_configs` 保存类型、目标修订与资源版本；
 * - 旧组没有配置行时按「母本组 + 目标待确认」读取，不要求重新发布；
 * - 旧 `/api/mother-groups` 只能看到、写入母本组，类型门禁在 HTTP 层。
 */
import {
  MOTHER_GROUP_MAX_MEMBERS,
  MOTHER_RESOURCE_SCHEMA_VERSION,
  motherResourceCriteriaIdOf,
  type MotherCriteriaId,
  type MotherResourceDraft,
  type PublishedMotherResource,
  type SharedMotherAccount,
  type SharedProductionLine,
} from '../../src/shared/motherGroups';
import {
  COLLECTION_GROUP_SCHEMA_VERSION,
  DEFAULT_DEMAND_BODY,
  DEFAULT_DEMAND_GENDER,
  DEFAULT_DEMAND_VOICE,
  DEMAND_LIMIT_PER_GROUP,
  demandLimitPerMember,
  isDemandBody,
  isDemandGender,
  isDemandVoice,
  isTargetReady,
  motherTargetKey,
  studSlotSetIdOf,
  studTargetKey,
  slotKeyOf,
  type CollectionDemand,
  type CollectionDemandStatus,
  type CollectionGroupConfig,
  type CollectionGroupDetail,
  type CollectionGroupInfo,
  type CollectionGroupMember,
  type CollectionGroupSummary,
  type CollectionGroupType,
  type CollectionTargetGrade,
  type CollectionTargetMode,
  type CollectionTaskRecord,
  type CollectionTaskStatus,
  type DemandBody,
  type DemandGender,
  type DemandVoice,
  type GroupTargetConfig,
  type PublishedStudResource,
  type SharedStudAccount,
  type StudResourceDraft,
  type StudSlotCoverage,
} from '../../src/shared/collectionGroups';
import { MotherStoreError, isMember, publishMemberResource } from './motherGroupsStore';
import {
  MAX_ACTIVE_PLANS,
  PLAN_OVERFLOW_NOTICE,
  countActivePlans,
  matchablePlanEggIds,
  planCreateDecision,
  planNeedsConfirm,
  planProgressStep,
  planStartOutcome,
  shouldAutoCompletePlan,
  type CollectionPlan,
  type PlanOffer,
  type PlanProgressStep,
  type PlanStatus,
} from '../../src/shared/collectionPlans';

interface GroupRow {
  id: string;
  name: string;
  owner_account_id: string;
  created_at: number;
}

interface ConfigRow {
  group_id: string;
  group_type: string;
  target_revision: number;
  resource_epoch: number;
  target_json: string;
  updated_at: number;
}

interface MemberRow {
  account_id: string;
  display_name: string;
  joined_at: number;
  resource_revision: number;
  published_at: number | null;
  catalog_version: string | null;
  criteria_id: string | null;
}

interface MotherAccountRow {
  member_account_id: string;
  game_account_key: string;
  account_name: string;
  source_exported_at: string;
  egg_game_ids: string;
  lines_json: string | null;
}

interface StudAccountRow {
  member_account_id: string;
  game_account_key: string;
  account_name: string;
  source_exported_at: string;
  target_revision: number;
  slots_json: string;
}

const asGroupType = (value: unknown): CollectionGroupType =>
  value === 'stud' ? 'stud' : 'mother';

const CONFIG_COLUMNS = 'group_id, group_type, target_revision, resource_epoch, target_json, updated_at';

function configFromRow(row: ConfigRow | null | undefined): CollectionGroupConfig {
  if (!row) {
    return {
      groupType: 'mother',
      targetRevision: 0,
      resourceEpoch: 0,
      target: null,
      updatedAt: 0,
    };
  }
  return {
    groupType: asGroupType(row.group_type),
    targetRevision: row.target_revision,
    resourceEpoch: row.resource_epoch,
    target: parseStoredTarget(row.group_type, row.target_json),
    updatedAt: row.updated_at,
  };
}

/** 读取单个组的配置；没有行时按旧组默认值返回（不写库）。 */
export async function readGroupConfig(
  db: D1Database,
  groupId: string,
): Promise<CollectionGroupConfig> {
  const row = await db
    .prepare(
      `SELECT ${CONFIG_COLUMNS}
         FROM collection_group_configs WHERE group_id = ?`,
    )
    .bind(groupId)
    .first<ConfigRow>();
  return configFromRow(row);
}

function parseStoredTarget(rawType: string, raw: string): GroupTargetConfig | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record.kind === 'mother' && asGroupType(rawType) === 'mother') {
      const overrides = record.natureOverrides;
      return {
        kind: 'mother',
        criteriaId: String(record.criteriaId ?? ''),
        mode: record.mode === 'medal' ? 'medal' : 'perfect',
        bodies: Array.isArray(record.bodies) ? record.bodies.map(String) : [],
        voices: Array.isArray(record.voices) ? record.voices.map(String) : [],
        catalogVersion: String(record.catalogVersion ?? ''),
        ...(record.requireRecommendedNatures === true ? { requireRecommendedNatures: true } : {}),
        ...(overrides && typeof overrides === 'object' && !Array.isArray(overrides)
          ? { natureOverrides: overrides as Record<string, string[]> }
          : {}),
      };
    }
    if (record.kind === 'stud' && asGroupType(rawType) === 'stud') {
      return {
        kind: 'stud',
        mode: record.mode === 'medal' ? 'medal' : 'perfect',
        catalogVersion: String(record.catalogVersion ?? ''),
        slots: Array.isArray(record.slots)
          ? (record.slots as unknown[]).flatMap((item) => {
              if (typeof item !== 'object' || item === null) return [];
              const slot = item as Record<string, unknown>;
              if (
                typeof slot.groupId !== 'number' ||
                typeof slot.natureId !== 'number' ||
                typeof slot.natureName !== 'string' ||
                typeof slot.grade !== 'string'
              ) {
                return [];
              }
              return [{
                groupId: slot.groupId,
                natureId: slot.natureId,
                natureName: slot.natureName,
                grade: slot.grade as CollectionTargetGrade,
              }];
            })
          : [],
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function listCollectionGroups(
  db: D1Database,
  accountId: string,
): Promise<CollectionGroupSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.name, g.owner_account_id, g.created_at,
              (SELECT COUNT(*) FROM mother_group_members m WHERE m.group_id = g.id) AS member_count,
              COALESCE(c.group_type, 'mother') AS group_type,
              COALESCE(c.target_revision, 0) AS target_revision,
              COALESCE(c.target_json, '') AS target_json
         FROM mother_groups g
         LEFT JOIN collection_group_configs c ON c.group_id = g.id
         JOIN mother_group_members me ON me.group_id = g.id AND me.account_id = ?
        ORDER BY g.created_at ASC, g.id ASC`,
    )
    .bind(accountId)
    .all<GroupRow & {
      member_count: number;
      group_type: string;
      target_revision: number;
      target_json: string;
    }>();
  return results.map((row) => {
    const groupType = asGroupType(row.group_type);
    const target = parseStoredTarget(row.group_type, row.target_json);
    return {
      id: row.id,
      name: row.name,
      ownerAccountId: row.owner_account_id,
      memberCount: row.member_count,
      groupType,
      targetRevision: row.target_revision,
      targetReady: groupType === 'mother' ? true : isTargetReady(groupType, target),
    };
  });
}

export async function findCollectionGroup(
  db: D1Database,
  groupId: string,
): Promise<CollectionGroupInfo | null> {
  // 2026-11-01：组信息与配置一起批量查，少一次 D1 往返（认领 / 刷新都会走这里）
  const [groupResult, configResult] = await db.batch([
    db
      .prepare('SELECT id, name, owner_account_id, created_at FROM mother_groups WHERE id = ?')
      .bind(groupId),
    db
      .prepare(`SELECT ${CONFIG_COLUMNS} FROM collection_group_configs WHERE group_id = ?`)
      .bind(groupId),
  ]);
  const row = (groupResult.results as GroupRow[])[0];
  if (!row) return null;
  const config = configFromRow((configResult.results as ConfigRow[])[0]);
  return {
    id: row.id,
    name: row.name,
    ownerAccountId: row.owner_account_id,
    createdAt: row.created_at,
    groupType: config.groupType,
    targetRevision: config.targetRevision,
    resourceEpoch: config.resourceEpoch,
    target: config.target,
  };
}

export async function createCollectionGroup(
  db: D1Database,
  input: {
    id: string;
    ownerAccountId: string;
    name: string;
    inviteHash: string;
    displayName: string;
    groupType: CollectionGroupType;
    target: GroupTargetConfig | null;
    now: number;
  },
): Promise<CollectionGroupInfo> {
  const { id, ownerAccountId, name, inviteHash, displayName, groupType, target, now } = input;
  await db.batch([
    db
      .prepare(
        'INSERT INTO mother_groups (id, owner_account_id, name, invite_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(id, ownerAccountId, name, inviteHash, now),
    db
      .prepare(
        'INSERT INTO mother_group_members (group_id, account_id, display_name, joined_at) VALUES (?, ?, ?, ?)',
      )
      .bind(id, ownerAccountId, displayName, now),
    db
      .prepare(
        `INSERT INTO collection_group_configs
           (group_id, group_type, target_revision, resource_epoch, target_json, updated_at)
         VALUES (?, ?, 0, 0, ?, ?)`,
      )
      .bind(id, groupType, target ? JSON.stringify(target) : '', now),
  ]);
  return {
    id,
    name,
    ownerAccountId,
    createdAt: now,
    groupType,
    targetRevision: 0,
    resourceEpoch: 0,
    target,
  };
}

/** 加入任意类型的组；返回组 ID 与类型（旧接口另有母本门禁）。 */
export async function joinCollectionGroup(
  db: D1Database,
  input: { accountId: string; displayName: string; inviteHash: string; now: number },
): Promise<{ groupId: string; groupType: CollectionGroupType }> {
  const { accountId, displayName, inviteHash, now } = input;
  const inserted = await db
    .prepare(
      `INSERT INTO mother_group_members (group_id, account_id, display_name, joined_at)
       SELECT g.id, ?, ?, ?
         FROM mother_groups g
        WHERE g.invite_hash = ?
          AND (
            EXISTS (SELECT 1 FROM mother_group_members me
                     WHERE me.group_id = g.id AND me.account_id = ?)
            OR (SELECT COUNT(*) FROM mother_group_members m WHERE m.group_id = g.id) < ?
          )
       ON CONFLICT(group_id, account_id) DO NOTHING
       RETURNING group_id`,
    )
    .bind(accountId, displayName, now, inviteHash, accountId, MOTHER_GROUP_MAX_MEMBERS)
    .first<{ group_id: string }>();
  const groupId = inserted?.group_id ?? (await findGroupIdByInvite(db, inviteHash, accountId));
  if (!groupId) {
    const exists = await db
      .prepare('SELECT id FROM mother_groups WHERE invite_hash = ?')
      .bind(inviteHash)
      .first<{ id: string }>();
    if (!exists) throw new MotherStoreError('GROUP_NOT_FOUND', '邀请码不对或小组已解散');
    throw new MotherStoreError('GROUP_FULL', `小组已满 ${MOTHER_GROUP_MAX_MEMBERS} 人`);
  }
  const config = await readGroupConfig(db, groupId);
  return { groupId, groupType: config.groupType };
}

async function findGroupIdByInvite(
  db: D1Database,
  inviteHash: string,
  accountId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT m.group_id
         FROM mother_group_members m
         JOIN mother_groups g ON g.id = m.group_id
        WHERE g.invite_hash = ? AND m.account_id = ?`,
    )
    .bind(inviteHash, accountId)
    .first<{ group_id: string }>();
  return row?.group_id ?? null;
}

/** 加入前的确认信息：组名、类型、目标摘要；不返回成员与邀请码哈希。 */
export async function previewInviteGroup(
  db: D1Database,
  inviteHash: string,
): Promise<{
  name: string;
  groupType: CollectionGroupType;
  targetRevision: number;
  targetReady: boolean;
  target: GroupTargetConfig | null;
} | null> {
  const row = await db
    .prepare(
      `SELECT g.id, g.name, COALESCE(c.group_type, 'mother') AS group_type,
              COALESCE(c.target_revision, 0) AS target_revision,
              COALESCE(c.target_json, '') AS target_json
         FROM mother_groups g
         LEFT JOIN collection_group_configs c ON c.group_id = g.id
        WHERE g.invite_hash = ?`,
    )
    .bind(inviteHash)
    .first<{
      id: string;
      name: string;
      group_type: string;
      target_revision: number;
      target_json: string;
    }>();
  if (!row) return null;
  const groupType = asGroupType(row.group_type);
  const target = parseStoredTarget(row.group_type, row.target_json);
  return {
    name: row.name,
    groupType,
    targetRevision: row.target_revision,
    targetReady: groupType === 'mother' ? true : isTargetReady(groupType, target),
    target,
  };
}

/**
 * 组详情：一个 batch 读取组、配置、成员、母本账号与种公摘要，
 * 避免读到「成员版本已是新的、摘要还是旧的」。
 */
export async function readCollectionGroupDetail(
  db: D1Database,
  groupId: string,
): Promise<CollectionGroupDetail | null> {
  const [groupResult, configResult, memberResult, motherResult, studResult] = await db.batch([
    db.prepare('SELECT id, name, owner_account_id, created_at FROM mother_groups WHERE id = ?').bind(groupId),
    db
      .prepare(
        `SELECT group_id, group_type, target_revision, resource_epoch, target_json, updated_at
           FROM collection_group_configs WHERE group_id = ?`,
      )
      .bind(groupId),
    db
      .prepare(
        `SELECT account_id, display_name, joined_at, resource_revision,
                published_at, catalog_version, criteria_id
           FROM mother_group_members
          WHERE group_id = ?
          ORDER BY joined_at ASC, account_id ASC`,
      )
      .bind(groupId),
    db
      .prepare(
        `SELECT member_account_id, game_account_key, account_name,
                source_exported_at, egg_game_ids, lines_json
           FROM mother_group_accounts
          WHERE group_id = ?
          ORDER BY member_account_id ASC, game_account_key ASC`,
      )
      .bind(groupId),
    db
      .prepare(
        `SELECT member_account_id, game_account_key, account_name,
                source_exported_at, target_revision, slots_json
           FROM collection_group_stud_accounts
          WHERE group_id = ?
          ORDER BY member_account_id ASC, game_account_key ASC`,
      )
      .bind(groupId),
  ]);

  const groupRow = groupResult.results[0] as GroupRow | undefined;
  if (!groupRow) return null;
  const configRow = configResult.results[0] as ConfigRow | undefined;
  const config: CollectionGroupConfig = configRow
    ? {
        groupType: asGroupType(configRow.group_type),
        targetRevision: configRow.target_revision,
        resourceEpoch: configRow.resource_epoch,
        target: parseStoredTarget(configRow.group_type, configRow.target_json),
        updatedAt: configRow.updated_at,
      }
    : {
        groupType: 'mother',
        targetRevision: 0,
        resourceEpoch: 0,
        target: null,
        updatedAt: 0,
      };

  const motherByMember = new Map<string, SharedMotherAccount[]>();
  for (const row of motherResult.results as MotherAccountRow[]) {
    const list = motherByMember.get(row.member_account_id) ?? [];
    const lines = parseStoredLines(row.lines_json);
    list.push({
      accountKey: row.game_account_key,
      accountName: row.account_name,
      sourceExportedAt: row.source_exported_at,
      eggGameIds: parseStoredIds(row.egg_game_ids),
      ...(lines === undefined ? {} : { lines }),
    });
    motherByMember.set(row.member_account_id, list);
  }

  const studByMember = new Map<string, SharedStudAccount[]>();
  const studModeByMember = new Map<string, CollectionTargetMode>();
  for (const row of studResult.results as StudAccountRow[]) {
    const parsed = parseStoredStudSlots(row.slots_json);
    const list = studByMember.get(row.member_account_id) ?? [];
    list.push({
      accountKey: row.game_account_key,
      accountName: row.account_name,
      sourceExportedAt: row.source_exported_at,
      covered: parsed.covered,
      breedable: parsed.breedable,
    });
    studByMember.set(row.member_account_id, list);
    studModeByMember.set(row.member_account_id, parsed.mode);
  }

  /** 成员 → 种公目标修订：原来在 map 里 `results.find(...)`，成员 × 种公行数退化成平方级。 */
  const studTargetRevisionByMember = new Map<string, number>();
  for (const row of studResult.results as StudAccountRow[]) {
    studTargetRevisionByMember.set(row.member_account_id, row.target_revision);
  }

  const members: CollectionGroupMember[] = (memberResult.results as MemberRow[]).map((row) => {
    const published = row.published_at != null && row.catalog_version != null && row.criteria_id != null;
    const motherResource: PublishedMotherResource | null =
      published && config.groupType === 'mother'
        ? {
            schemaVersion: MOTHER_RESOURCE_SCHEMA_VERSION,
            criteriaId: row.criteria_id as MotherCriteriaId,
            catalogVersion: row.catalog_version as string,
            accounts: motherByMember.get(row.account_id) ?? [],
            revision: row.resource_revision,
            publishedAt: row.published_at as number,
          }
        : null;
    const studAccounts = studByMember.get(row.account_id) ?? [];
    const studResource: PublishedStudResource | null =
      published && config.groupType === 'stud'
        ? {
            schemaVersion: COLLECTION_GROUP_SCHEMA_VERSION,
            kind: 'stud',
            mode: studModeByMember.get(row.account_id) ?? 'perfect',
            catalogVersion: row.catalog_version as string,
            targetId: row.criteria_id as string,
            targetRevision: 0,
            accounts: studAccounts,
            revision: row.resource_revision,
            publishedAt: row.published_at as number,
          }
        : null;
    if (studResource) {
      studResource.targetRevision = studTargetRevisionByMember.get(row.account_id) ?? 0;
    }
    return {
      accountId: row.account_id,
      displayName: row.display_name,
      joinedAt: row.joined_at,
      resourceRevision: row.resource_revision,
      resource: motherResource,
      studResource,
    };
  });

  return {
    group: {
      id: groupRow.id,
      name: groupRow.name,
      ownerAccountId: groupRow.owner_account_id,
      createdAt: groupRow.created_at,
      groupType: config.groupType,
      targetRevision: config.targetRevision,
      resourceEpoch: config.resourceEpoch,
      target: config.target,
    },
    members,
  };
}

/**
 * 读摘要时不再重做规范化（2026-10-31）：写入时 `motherGroupsValidation` 已经去重 + 排序 + trim，
 * 这里再排序一次会把每次详情 GET（含轮询）拖成几十万次 localeCompare。
 */
function parseStoredIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}

/** `null` = 旧摘要没带产线（未知）；`[]` = 已发布但确实没有产线。 */
function parseStoredLines(raw: string | null): SharedProductionLine[] | undefined {
  if (raw == null || raw === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SharedProductionLine[]) : undefined;
  } catch {
    return undefined;
  }
}

/** 旧种公组兼容（说明见 `publishStudResource` 上方，R2-7-L02）。 */
function parseStoredStudSlots(raw: string): {
  mode: CollectionTargetMode;
  covered: StudSlotCoverage[];
  breedable: StudSlotCoverage[];
} {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const readSlots = (value: unknown): StudSlotCoverage[] =>
      Array.isArray(value)
        ? value.flatMap((item) => {
            if (typeof item !== 'object' || item === null) return [];
            const slot = item as Record<string, unknown>;
            if (
              typeof slot.groupId !== 'number' ||
              typeof slot.natureId !== 'number' ||
              typeof slot.grade !== 'string' ||
              typeof slot.gameId !== 'number'
            ) {
              return [];
            }
            return [{
              groupId: slot.groupId,
              natureId: slot.natureId,
              grade: slot.grade as CollectionTargetGrade,
              gameId: slot.gameId,
            }];
          })
        : [];
    return {
      mode: parsed.mode === 'medal' ? 'medal' : 'perfect',
      covered: readSlots(parsed.covered),
      breedable: readSlots(parsed.breedable),
    };
  } catch {
    return { mode: 'perfect', covered: [], breedable: [] };
  }
}

export interface PublishStudInput {
  groupId: string;
  accountId: string;
  baseRevision: number;
  resource: StudResourceDraft;
}

/**
 * 种公组整条链路（发布 / 读槽位 / 详情分支）**仅供未执行 2026-10-27-drop-stud-groups 迁移的旧库兼容**。
 * 创建接口已只接受母本组；确认线上已迁移后再整块删除（含 `parseStoredStudSlots`、
 * `readCollectionGroupDetail` 的 stud 分支、`handlePublish` 的 stud 分支、需求负数 eggGameId 语义）。
 * 见 R2-7-L02。
 */
export async function publishStudResource(
  db: D1Database,
  input: PublishStudInput,
): Promise<{ resourceRevision: number; publishedAt: number | null }> {
  const { groupId, accountId, baseRevision, resource } = input;

  const config = await readGroupConfig(db, groupId);
  if (config.groupType !== 'stud') {
    throw new MotherStoreError('GROUP_TYPE_MISMATCH', '这个小组不是种公组');
  }
  const target = config.target;
  if (!target || target.kind !== 'stud' || !isTargetReady('stud', target)) {
    throw new MotherStoreError('TARGET_NOT_READY', '本组目标还没确认，暂时不能发布');
  }
  if (resource.targetRevision !== config.targetRevision) {
    throw new MotherStoreError('TARGET_CHANGED', '本组目标已更新，请重新预览再发布');
  }
  if (resource.targetId !== studSlotSetIdOf(target) || resource.mode !== target.mode) {
    throw new MotherStoreError('TARGET_CHANGED', '本组目标与本次发布不一致，请重新预览');
  }
  if (target.catalogVersion && resource.catalogVersion !== target.catalogVersion) {
    throw new MotherStoreError('TARGET_CHANGED', '图鉴已更新，请先更新本组目标');
  }

  const member = await db
    .prepare(
      `SELECT resource_revision, published_at, catalog_version, criteria_id
         FROM mother_group_members WHERE group_id = ? AND account_id = ?`,
    )
    .bind(groupId, accountId)
    .first<{
      resource_revision: number;
      published_at: number | null;
      catalog_version: string | null;
      criteria_id: string | null;
    }>();
  if (!member) throw new MotherStoreError('NOT_MEMBER', '不是该组成员');

  const targetKeys = new Set(target.slots.map(slotKeyOf));
  const accounts = resource.accounts.map((account) => ({
    ...account,
    covered: dedupeSlots(account.covered.filter((slot) => targetKeys.has(slotKeyOf(slot)))),
    breedable: dedupeSlots(account.breedable.filter((slot) => targetKeys.has(slotKeyOf(slot)))),
  }));

  if (member.published_at != null) {
    await assertStudSourceNotStale(db, groupId, accountId, resource, accounts);
  }

  const now = Date.now();
  const writeToken = crypto.randomUUID();
  const published = accounts.length > 0;

  const statements = [
    db
      .prepare(
        `UPDATE mother_group_members
            SET resource_revision = resource_revision + 1,
                write_token = ?,
                published_at = ?,
                catalog_version = ?,
                criteria_id = ?
          WHERE group_id = ? AND account_id = ? AND resource_revision = ?
            AND EXISTS (SELECT 1 FROM collection_group_configs
                         WHERE group_id = ? AND target_revision = ?)`,
      )
      .bind(
        writeToken,
        published ? now : null,
        published ? resource.catalogVersion : null,
        published ? resource.targetId : null,
        groupId,
        accountId,
        baseRevision,
        groupId,
        resource.targetRevision,
      ),
    db
      .prepare(
        `DELETE FROM collection_group_stud_accounts
          WHERE group_id = ? AND member_account_id = ?
            AND EXISTS (SELECT 1 FROM mother_group_members
                         WHERE group_id = ? AND account_id = ? AND write_token = ?)`,
      )
      .bind(groupId, accountId, groupId, accountId, writeToken),
    db
      .prepare(
        `UPDATE collection_group_configs
            SET resource_epoch = resource_epoch + 1, updated_at = ?
          WHERE group_id = ?
            AND EXISTS (SELECT 1 FROM mother_group_members
                         WHERE group_id = ? AND account_id = ? AND write_token = ?)`,
      )
      .bind(now, groupId, groupId, accountId, writeToken),
    ...accounts.map((account) =>
      db
        .prepare(
          `INSERT INTO collection_group_stud_accounts
             (group_id, game_account_key, member_account_id, account_name,
              source_exported_at, target_revision, slots_json)
           SELECT ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM mother_group_members
                           WHERE group_id = ? AND account_id = ? AND write_token = ?)`,
        )
        .bind(
          groupId,
          account.accountKey,
          accountId,
          account.accountName,
          account.sourceExportedAt,
          resource.targetRevision,
          JSON.stringify({
            mode: resource.mode,
            covered: account.covered,
            breedable: account.breedable,
          }),
          groupId,
          accountId,
          writeToken,
        ),
    ),
  ];

  try {
    const results = await db.batch(statements);
    if ((results[0]?.meta.changes ?? 0) === 0) {
      // 先区分「目标在本次发布期间被改」还是「摘要被其他设备更新」
      const latest = await readGroupConfig(db, groupId);
      if (latest.targetRevision !== resource.targetRevision) {
        throw new MotherStoreError('TARGET_CHANGED', '本组目标已更新，请重新预览再发布');
      }
      throw new MotherStoreError('REVISION_CONFLICT', '小组资源已被其他设备更新，请重新预览再发布');
    }
  } catch (error) {
    if (error instanceof MotherStoreError) throw error;
    const message = String(error);
    if (message.includes('UNIQUE constraint failed: collection_group_stud_accounts')) {
      throw new MotherStoreError(
        'GAME_ACCOUNT_ALREADY_SHARED',
        '游戏账号已被其他组员共享，不能重复占用',
      );
    }
    throw error;
  }

  const keys = new Set(
    accounts.flatMap((account) => account.covered.map((slot) => studTargetKey(slot))),
  );
  await closeCoveredTasks(db, groupId, resource.targetRevision, keys);
  return { resourceRevision: baseRevision + 1, publishedAt: published ? now : null };
}

const dedupeSlots = (slots: readonly StudSlotCoverage[]): StudSlotCoverage[] => {
  const map = new Map<string, StudSlotCoverage>();
  for (const slot of slots) map.set(slotKeyOf(slot), slot);
  return [...map.values()].sort(
    (a, b) =>
      a.groupId - b.groupId ||
      a.natureId - b.natureId ||
      a.grade.localeCompare(b.grade),
  );
};

async function assertStudSourceNotStale(
  db: D1Database,
  groupId: string,
  accountId: string,
  resource: StudResourceDraft,
  accounts: readonly SharedStudAccount[],
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT game_account_key, source_exported_at, target_revision, slots_json
         FROM collection_group_stud_accounts
        WHERE group_id = ? AND member_account_id = ?`,
    )
    .bind(groupId, accountId)
    .all<{
      game_account_key: string;
      source_exported_at: string;
      target_revision: number;
      slots_json: string;
    }>();
  const previous = new Map(results.map((row) => [row.game_account_key, row]));
  for (const account of accounts) {
    const before = previous.get(account.accountKey);
    if (!before) continue;
    const beforeTime = Date.parse(before.source_exported_at);
    const nextTime = Date.parse(account.sourceExportedAt);
    if (nextTime < beforeTime) {
      throw new MotherStoreError('STALE_SOURCE', `账号 ${account.accountKey} 的数据比已共享的旧，请先导入更新`);
    }
    if (nextTime === beforeTime && before.target_revision === resource.targetRevision) {
      const prior = parseStoredStudSlots(before.slots_json);
      if (
        !sameSlotList(prior.covered, account.covered) ||
        !sameSlotList(prior.breedable, account.breedable)
      ) {
        throw new MotherStoreError('SOURCE_MISMATCH', `账号 ${account.accountKey} 在同一份数据上算出了不同覆盖，请重新导入`);
      }
    }
  }
}

const sameSlotList = (a: readonly StudSlotCoverage[], b: readonly StudSlotCoverage[]): boolean => {
  if (a.length !== b.length) return false;
  const left = dedupeSlots(a);
  const right = dedupeSlots(b);
  return left.every(
    (slot, index) =>
      slot.groupId === right[index]?.groupId &&
      slot.natureId === right[index]?.natureId &&
      slot.grade === right[index]?.grade &&
      slot.gameId === right[index]?.gameId,
  );
};

/** 目标的可比较签名：忽略槽位 / 体型 / 声音 / 覆盖表的书写顺序。 */
const sortedNatureOverrides = (value?: Record<string, string[]>): Record<string, string[]> => {
  if (!value) return {};
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(value).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))) {
    if (value[key].length > 0) out[key] = [...new Set(value[key])].sort();
  }
  return out;
};

const targetSignatureOf = (target: GroupTargetConfig | null): string => {
  if (!target) return '';
  if (target.kind === 'mother') {
    return JSON.stringify({
      kind: target.kind,
      mode: target.mode,
      bodies: [...new Set(target.bodies)].sort(),
      voices: [...new Set(target.voices)].sort(),
      catalogVersion: target.catalogVersion,
      requireRecommendedNatures: target.requireRecommendedNatures === true,
      natureOverrides: sortedNatureOverrides(target.natureOverrides),
      criteriaId: target.criteriaId,
    });
  }
  return JSON.stringify({
    kind: target.kind,
    mode: target.mode,
    catalogVersion: target.catalogVersion,
    slots: target.slots.map(slotKeyOf).sort(),
  });
};

/** 组长修改目标：CAS 递增 target_revision；旧摘要不删除，但按修订视为不可比。 */
export async function updateCollectionTarget(
  db: D1Database,
  input: {
    groupId: string;
    ownerAccountId: string;
    baseTargetRevision: number;
    target: GroupTargetConfig;
    now: number;
  },
): Promise<{ targetRevision: number }> {
  const { groupId, ownerAccountId, baseTargetRevision, target, now } = input;
  const config = await readGroupConfig(db, groupId);
  if (config.groupType !== target.kind) {
    throw new MotherStoreError('TARGET_NOT_READY', '目标类型与小组类型不一致');
  }
  // 目标完全没变就不要递增修订：否则全组摘要会无故失效，已覆盖的槽位会被当成缺口。
  // 但带了过期的 baseTargetRevision 仍要报冲突，保持 CAS 语义。
  if (targetSignatureOf(config.target) === targetSignatureOf(target)) {
    if (baseTargetRevision !== config.targetRevision) {
      throw new MotherStoreError('REVISION_CONFLICT', '本组目标已被其他设备更新，请刷新后再改');
    }
    return { targetRevision: config.targetRevision };
  }
  // 旧组没有配置行：先补一行默认配置，否则下面的 CAS 永远匹配不到（表现为「目标已被其他设备更新」）
  await db
    .prepare(
      `INSERT INTO collection_group_configs
         (group_id, group_type, target_revision, resource_epoch, target_json, updated_at)
       SELECT ?, ?, 0, 0, '', ?
        WHERE EXISTS (SELECT 1 FROM mother_groups WHERE id = ?)
       ON CONFLICT(group_id) DO NOTHING`,
    )
    .bind(groupId, config.groupType, now, groupId)
    .run();
  const result = await db
    .prepare(
      `UPDATE collection_group_configs
          SET target_revision = target_revision + 1,
              resource_epoch = resource_epoch + 1,
              target_json = ?,
              updated_at = ?
        WHERE group_id = ? AND target_revision = ?
          AND EXISTS (SELECT 1 FROM mother_groups
                       WHERE id = ? AND owner_account_id = ?)`,
    )
    .bind(JSON.stringify(target), now, groupId, baseTargetRevision, groupId, ownerAccountId)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    const owner = await db
      .prepare('SELECT owner_account_id FROM mother_groups WHERE id = ?')
      .bind(groupId)
      .first<{ owner_account_id: string }>();
    if (!owner) throw new MotherStoreError('GROUP_NOT_FOUND', '小组不存在');
    if (owner.owner_account_id !== ownerAccountId) {
      throw new MotherStoreError('NOT_OWNER', '只有组长可以修改本组目标');
    }
    throw new MotherStoreError('REVISION_CONFLICT', '本组目标已被其他设备更新，请刷新后再改');
  }
  // 让旧修订下的寻找任务只作历史；新修订重新生成。只关旧修订，不能把并发新认领一起关掉。
  await db
    .prepare(
      `UPDATE collection_group_tasks
          SET status = 'closed', closed_at = ?, updated_at = ?, version = version + 1
        WHERE group_id = ? AND status <> 'closed' AND target_revision <> ?`,
    )
    .bind(now, now, groupId, baseTargetRevision + 1)
    .run();
  return { targetRevision: baseTargetRevision + 1 };
}

/** 退出 / 被移除的公共清理：释放承接、递增资源版本、删成员（共享资源随外键级联删除）。 */
async function removeMemberCleanup(
  db: D1Database,
  groupId: string,
  accountId: string,
  cancelUnfinishedDemands: boolean,
): Promise<void> {
  const now = Date.now();
  const statements = [
    db
      .prepare(
        `UPDATE collection_group_tasks
            SET owner_account_id = NULL, status = 'open',
                updated_at = ?, version = version + 1
          WHERE group_id = ? AND owner_account_id = ? AND status = 'claimed'`,
      )
      .bind(now, groupId, accountId),
    // 需求承接也要释放，否则退出的人留下的「已接单」会永远卡住别人的需求
    db
      .prepare(
        `UPDATE collection_group_demands
            SET status = 'open', claimer_account_id = NULL,
                updated_at = ?, version = version + 1
          WHERE group_id = ? AND claimer_account_id = ? AND status = 'claimed'`,
      )
      .bind(now, groupId, accountId),
    // 成员离开改变了组内资源集合：递增 epoch。注意：客户端目前**没有**消费这个字段
    // （缓存失效靠整份重拉），这里只是预留，别把它当成已生效的失效信号（R2-7-L03）
    db
      .prepare(
        `UPDATE collection_group_configs
            SET resource_epoch = resource_epoch + 1, updated_at = ?
          WHERE group_id = ?`,
      )
      .bind(now, groupId),
  ];
  if (cancelUnfinishedDemands) {
    // 被移除的人未完成的需求一并取消；已完成的行在归档表里，与成员行无关。
    // 必须排在删成员行之前——删除成员会触发外键级联，之后的 DELETE 一行也删不到。
    statements.push(
      db
        .prepare(
          `DELETE FROM collection_group_demands
            WHERE group_id = ? AND demander_account_id = ? AND status != 'done'`,
        )
        .bind(groupId, accountId),
    );
  }
  const memberIndex = statements.length;
  statements.push(
    db
      .prepare('DELETE FROM mother_group_members WHERE group_id = ? AND account_id = ?')
      .bind(groupId, accountId),
  );
  const result = await db.batch(statements);
  if ((result[memberIndex]?.meta.changes ?? 0) === 0) {
    throw new MotherStoreError('NOT_MEMBER', '不是该组成员');
  }
}

/** 普通成员退出：释放自己认领的任务与需求，删成员（种公摘要随外键级联删除），并递增资源版本。 */
export async function leaveCollectionGroup(
  db: D1Database,
  groupId: string,
  accountId: string,
): Promise<void> {
  await removeMemberCleanup(db, groupId, accountId, false);
}

/** 组长移除组员：在退出清理之外，取消他未完成的需求（已完成保留）。 */
export async function removeCollectionGroupMember(
  db: D1Database,
  groupId: string,
  accountId: string,
): Promise<void> {
  await removeMemberCleanup(db, groupId, accountId, true);
}

/** 供 handler 判断旧接口能否操作该组：非母本组一律当作不存在。 */
export async function isMotherGroup(db: D1Database, groupId: string): Promise<boolean> {
  const config = await readGroupConfig(db, groupId);
  return config.groupType === 'mother';
}

/** 发布母本摘要到任意类型的组：类型必须匹配，其余复用一期原子写入。 */
export async function publishMotherResourceToGroup(
  db: D1Database,
  input: {
    groupId: string;
    accountId: string;
    baseRevision: number;
    /** 发布体带上客户端看到的目标修订；不一致说明组目标已变，必须让客户端重新预览。 */
    baseTargetRevision?: number;
    resource: MotherResourceDraft;
  },
): Promise<{ resourceRevision: number; publishedAt: number | null }> {
  const config = await readGroupConfig(db, input.groupId);
  if (config.groupType !== 'mother') {
    throw new MotherStoreError('GROUP_TYPE_MISMATCH', '这个小组不是母本组');
  }
  if (input.baseTargetRevision != null && input.baseTargetRevision !== config.targetRevision) {
    throw new MotherStoreError('TARGET_CHANGED', '本组口径已更新，请重新预览再发布');
  }
  // 2026-10-28：小组不再按母本口径过滤，发布不再校验口径 / 组目标的图鉴版本。
  const result = await publishMemberResource(db, input);
  const keys = new Set(
    input.resource.accounts.flatMap((account) => account.eggGameIds.map(motherTargetKey)),
  );
  await closeCoveredTasks(db, input.groupId, config.targetRevision, keys);
  return result;
}

/* ---------- 共同寻找与认领 ---------- */

interface TaskRow {
  group_id: string;
  target_revision: number;
  target_key: string;
  round: number;
  status: string;
  owner_account_id: string | null;
  version: number;
  updated_at: number;
  closed_at: number | null;
}

export interface CollectionTasksView {
  targetRevision: number;
  /** 所有成员都已按当前目标发布 = 缺口可确认；否则只能展示、不能认领。 */
  confirmed: boolean;
  pendingMemberIds: string[];
  tasks: CollectionTaskRecord[];
}

const expectedCriteriaOf = (config: CollectionGroupConfig): string => {
  // 2026-10-28：母本组不再有口径，所有成员统一按「全部母本」摘要比较；
  // 2026-10-29：产线口径（目标模式）编进 criteriaId，必须按组目标模式算期望值，
  // 否则 v3 摘要会被一律判成不可比（共同寻找永远无法确认）。
  if (config.groupType === 'mother' || config.target?.kind === 'mother') {
    return motherResourceCriteriaIdOf(
      config.target?.kind === 'mother' ? config.target.mode : 'perfect',
    );
  }
  if (config.target?.kind === 'stud') return studSlotSetIdOf(config.target);
  return motherResourceCriteriaIdOf('perfect');
};

const targetCatalogOf = (config: CollectionGroupConfig): string =>
  config.target?.catalogVersion ?? '';

const isMemberComparableForTarget = (row: MemberRow, config: CollectionGroupConfig): boolean => {
  if (row.published_at == null || row.criteria_id == null || row.catalog_version == null) return false;
  if (row.criteria_id !== expectedCriteriaOf(config)) return false;
  // 母本组不再绑定组目标的图鉴版本：各成员按自己导入的图鉴发布即可，
  // 旧组遗留的 target.catalogVersion 不能把所有人永远卡在「待确认」。
  if (config.groupType === 'mother' || config.target?.kind === 'mother') return true;
  const catalog = targetCatalogOf(config);
  return catalog.length === 0 || row.catalog_version === catalog;
};

const toTaskRecord = (row: TaskRow): CollectionTaskRecord => ({
  groupId: row.group_id,
  targetRevision: row.target_revision,
  targetKey: row.target_key,
  round: row.round,
  status: (row.status === 'claimed' || row.status === 'closed' ? row.status : 'open') as CollectionTaskStatus,
  ownerAccountId: row.owner_account_id,
  version: row.version,
  updatedAt: row.updated_at,
  closedAt: row.closed_at,
});

/** 当前目标修订下的任务与「是否全员确认」。 */
export async function listCollectionTasks(
  db: D1Database,
  groupId: string,
  preloaded?: CollectionGroupConfig,
): Promise<CollectionTasksView> {
  const config = preloaded ?? (await readGroupConfig(db, groupId));
  const [memberResult, taskResult] = await db.batch([
    db
      .prepare(
        `SELECT account_id, display_name, joined_at, resource_revision,
                published_at, catalog_version, criteria_id
           FROM mother_group_members WHERE group_id = ?
          ORDER BY joined_at ASC, account_id ASC`,
      )
      .bind(groupId),
    db
      .prepare(
        `SELECT group_id, target_revision, target_key, round, status,
                owner_account_id, version, updated_at, closed_at
           FROM collection_group_tasks
          WHERE group_id = ? AND target_revision = ? AND status <> 'closed'
          ORDER BY updated_at DESC`,
      )
      .bind(groupId, config.targetRevision),
  ]);
  const members = memberResult.results as MemberRow[];
  const pendingMemberIds = members
    .filter((row) => !isMemberComparableForTarget(row, config))
    .map((row) => row.account_id);
  // 旧组 / 默认目标没有记录 catalogVersion：不能因此跳过图鉴比较。
  // 2026-10-29：只对遗留的种公组生效——母本组各成员按自己导入的图鉴发布，
  // 不能因为「组目标没存过图鉴版本」就把所有人卡在「待确认」。
  if (config.groupType === 'stud' && targetCatalogOf(config).length === 0) {
    const catalogs = new Set(
      members
        .filter((row) => row.published_at != null && row.catalog_version != null)
        .map((row) => row.catalog_version as string),
    );
    if (catalogs.size > 1) {
      return {
        targetRevision: config.targetRevision,
        confirmed: false,
        pendingMemberIds: members.map((row) => row.account_id),
        tasks: (taskResult.results as TaskRow[]).map(toTaskRecord),
      };
    }
  }
  return {
    targetRevision: config.targetRevision,
    confirmed: pendingMemberIds.length === 0,
    pendingMemberIds,
    tasks: (taskResult.results as TaskRow[]).map(toTaskRecord),
  };
}

const taskKeyBelongsToTarget = (
  config: CollectionGroupConfig,
  targetKey: string,
): boolean => {
  if (config.groupType === 'mother') {
    return /^mother:[1-9]\d*$/.test(targetKey);
  }
  if (config.groupType !== 'stud' || config.target?.kind !== 'stud') return false;
  return config.target.slots.some((slot) => studTargetKey(slot) === targetKey);
};

async function findActiveTask(
  db: D1Database,
  groupId: string,
  targetRevision: number,
  targetKey: string,
): Promise<TaskRow | null> {
  return db
    .prepare(
      `SELECT group_id, target_revision, target_key, round, status,
              owner_account_id, version, updated_at, closed_at
         FROM collection_group_tasks
        WHERE group_id = ? AND target_revision = ? AND target_key = ? AND status <> 'closed'
        ORDER BY round DESC LIMIT 1`,
    )
    .bind(groupId, targetRevision, targetKey)
    .first<TaskRow>();
}

async function coveredKeysOf(
  db: D1Database,
  groupId: string,
  config: CollectionGroupConfig,
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (config.groupType === 'mother') {
    const { results } = await db
      .prepare('SELECT egg_game_ids FROM mother_group_accounts WHERE group_id = ?')
      .bind(groupId)
      .all<{ egg_game_ids: string }>();
    for (const row of results) {
      for (const id of parseStoredIds(row.egg_game_ids)) keys.add(motherTargetKey(id));
    }
    return keys;
  }
  if (config.target?.kind !== 'stud') return keys;
  const { results } = await db
    .prepare(
      `SELECT slots_json FROM collection_group_stud_accounts
        WHERE group_id = ? AND target_revision = ?`,
    )
    .bind(groupId, config.targetRevision)
    .all<{ slots_json: string }>();
  for (const row of results) {
    for (const slot of parseStoredStudSlots(row.slots_json).covered) {
      keys.add(studTargetKey(slot));
    }
  }
  return keys;
}

async function memberName(
  db: D1Database,
  groupId: string,
  accountId: string,
): Promise<string> {
  const row = await db
    .prepare('SELECT display_name FROM mother_group_members WHERE group_id = ? AND account_id = ?')
    .bind(groupId, accountId)
    .first<{ display_name: string }>();
  return row?.display_name ?? '其他成员';
}

export interface ClaimTaskInput {
  groupId: string;
  accountId: string;
  targetKey: string;
  expectedVersion?: number;
}

/** 认领：只有全员确认的缺口可认领；同一目标并发时只有一个成功。 */
async function claimCollectionTaskInner(
  db: D1Database,
  input: ClaimTaskInput,
  config: CollectionGroupConfig,
): Promise<CollectionTaskRecord> {
  const { groupId, accountId, targetKey, expectedVersion } = input;
  if (!taskKeyBelongsToTarget(config, targetKey)) {
    throw new MotherStoreError('TASK_NOT_FOUND', '这个目标不属于本组当前目标');
  }
  const [view, covered] = await Promise.all([
    listCollectionTasks(db, groupId, config),
    coveredKeysOf(db, groupId, config),
  ]);
  if (!view.confirmed) {
    throw new MotherStoreError('TASKS_NOT_CONFIRMED', '还有成员未发布或目标不一致，暂时不能认领');
  }
  if (covered.has(targetKey)) {
    throw new MotherStoreError('TASK_ALREADY_COVERED', '这个目标已经被组内已发布资源补上了');
  }

  const claimExisting = async (row: TaskRow): Promise<CollectionTaskRecord> => {
    if (row.owner_account_id === accountId) return toTaskRecord(row);
    if (row.status === 'claimed' && row.owner_account_id) {
      const name = await memberName(db, groupId, row.owner_account_id);
      throw new MotherStoreError('TASK_TAKEN', `这个目标已由 ${name} 认领`);
    }
    if (expectedVersion != null && row.version !== expectedVersion) {
      throw new MotherStoreError('TASK_TAKEN', '任务状态已更新，请刷新后再试');
    }
    const now = Date.now();
    const updated = await db
      .prepare(
        `UPDATE collection_group_tasks
            SET status = 'claimed', owner_account_id = ?,
                version = version + 1, updated_at = ?
          WHERE group_id = ? AND target_revision = ? AND target_key = ? AND round = ?
            AND version = ? AND status <> 'closed'
            AND (owner_account_id IS NULL OR owner_account_id = ?)`,
      )
      .bind(accountId, now, groupId, row.target_revision, targetKey, row.round, row.version, accountId)
      .run();
    if ((updated.meta.changes ?? 0) === 0) {
      const latest = await findActiveTask(db, groupId, row.target_revision, targetKey);
      if (latest?.owner_account_id && latest.owner_account_id !== accountId) {
        const name = await memberName(db, groupId, latest.owner_account_id);
        throw new MotherStoreError('TASK_TAKEN', `这个目标已由 ${name} 认领`);
      }
      throw new MotherStoreError('TASK_TAKEN', '任务状态已更新，请刷新后再试');
    }
    // 本地拼出结果，省掉认领后再 SELECT 一次（2026-11-01 优化：这条路原来有 12 次 D1 往返）
    return {
      ...toTaskRecord(row),
      status: 'claimed',
      ownerAccountId: accountId,
      version: row.version + 1,
      updatedAt: now,
    };
  };

  const active = await findActiveTask(db, groupId, config.targetRevision, targetKey);
  if (active) return claimExisting(active);

  const maxRow = await db
    .prepare(
      `SELECT MAX(round) AS max_round FROM collection_group_tasks
        WHERE group_id = ? AND target_revision = ? AND target_key = ?`,
    )
    .bind(groupId, config.targetRevision, targetKey)
    .first<{ max_round: number | null }>();
  const round = (maxRow?.max_round ?? -1) + 1;
  const now = Date.now();
  const inserted = await db
    .prepare(
      `INSERT INTO collection_group_tasks
         (group_id, target_revision, target_key, round, status, owner_account_id,
          version, created_at, updated_at, closed_at)
       SELECT ?, ?, ?, ?, 'claimed', ?, 1, ?, ?, NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM collection_group_tasks
           WHERE group_id = ? AND target_revision = ? AND target_key = ? AND status <> 'closed'
        )`,
    )
    .bind(groupId, config.targetRevision, targetKey, round, accountId, now, now,
      groupId, config.targetRevision, targetKey)
    .run();
  if ((inserted.meta.changes ?? 0) > 0) {
    return {
      groupId,
      targetRevision: config.targetRevision,
      targetKey,
      round,
      status: 'claimed',
      ownerAccountId: accountId,
      version: 1,
      updatedAt: now,
      closedAt: null,
    };
  }
  const raced = await findActiveTask(db, groupId, config.targetRevision, targetKey);
  if (!raced) throw new MotherStoreError('TASK_TAKEN', '任务状态已更新，请刷新后再试');
  return claimExisting(raced);
}

/**
 * 认领的对外入口：先走原有裁决，再复核一次「是否已被组内资源补上」。
 *
 * 认领与「他人发布补齐」是两个请求：发布事务提交后才关任务，中间窗口里新建的认领
 * 不会被关任务扫到。复核一次能把这种任务立即关闭，避免「资源已覆盖却仍挂着负责人」。
 */
export async function claimCollectionTask(
  db: D1Database,
  input: ClaimTaskInput,
): Promise<CollectionTaskRecord> {
  const config = await readGroupConfig(db, input.groupId);
  const record = await claimCollectionTaskInner(db, input, config);
  const covered = await coveredKeysOf(db, record.groupId, config);
  if (!covered.has(record.targetKey)) return record;
  const now = Date.now();
  await db
    .prepare(
      `UPDATE collection_group_tasks
          SET status = 'closed', closed_at = ?, updated_at = ?, version = version + 1
        WHERE group_id = ? AND target_revision = ? AND target_key = ? AND status <> 'closed'`,
    )
    .bind(now, now, record.groupId, record.targetRevision, record.targetKey)
    .run();
  throw new MotherStoreError('TASK_ALREADY_COVERED', '这个目标已经被组内已发布资源补上了');
}

export interface ReleaseTaskInput {
  groupId: string;
  accountId: string;
  targetKey: string;
  expectedVersion?: number;
}

/** 释放：负责人或组长可以把任务放回未认领。 */
export async function releaseCollectionTask(
  db: D1Database,
  input: ReleaseTaskInput,
): Promise<CollectionTaskRecord> {
  const { groupId, accountId, targetKey, expectedVersion } = input;
  const config = await readGroupConfig(db, groupId);
  const active = await findActiveTask(db, groupId, config.targetRevision, targetKey);
  if (!active) throw new MotherStoreError('TASK_NOT_FOUND', '这个目标没有进行中的认领');
  const group = await db
    .prepare('SELECT owner_account_id FROM mother_groups WHERE id = ?')
    .bind(groupId)
    .first<{ owner_account_id: string }>();
  if (active.owner_account_id !== accountId && group?.owner_account_id !== accountId) {
    throw new MotherStoreError('TASK_NOT_YOURS', '只有负责人或组长可以释放这个任务');
  }
  if (expectedVersion != null && active.version !== expectedVersion) {
    throw new MotherStoreError('TASK_TAKEN', '任务状态已更新，请刷新后再试');
  }
  const now = Date.now();
  const updated = await db
    .prepare(
      `UPDATE collection_group_tasks
          SET status = 'open', owner_account_id = NULL,
              version = version + 1, updated_at = ?
        WHERE group_id = ? AND target_revision = ? AND target_key = ? AND round = ?
          AND version = ? AND status <> 'closed'`,
    )
    .bind(now, groupId, active.target_revision, targetKey, active.round, active.version)
    .run();
  if ((updated.meta.changes ?? 0) === 0) {
    throw new MotherStoreError('TASK_TAKEN', '任务状态已更新，请刷新后再试');
  }
  return {
    ...toTaskRecord(active),
    status: 'open',
    ownerAccountId: null,
    version: active.version + 1,
    updatedAt: now,
  };
}

export interface TransferTaskInput {
  groupId: string;
  actorAccountId: string;
  targetKey: string;
  toAccountId: string;
  expectedVersion?: number;
}

/** 转交：只有组长可以转给现有成员。 */
export async function transferCollectionTask(
  db: D1Database,
  input: TransferTaskInput,
): Promise<CollectionTaskRecord> {
  const { groupId, actorAccountId, targetKey, toAccountId, expectedVersion } = input;
  const config = await readGroupConfig(db, groupId);
  const group = await db
    .prepare('SELECT owner_account_id FROM mother_groups WHERE id = ?')
    .bind(groupId)
    .first<{ owner_account_id: string }>();
  if (!group) throw new MotherStoreError('GROUP_NOT_FOUND', '小组不存在');
  if (group.owner_account_id !== actorAccountId) {
    throw new MotherStoreError('NOT_OWNER', '只有组长可以转交任务');
  }
  if (!(await isMember(db, groupId, toAccountId))) {
    throw new MotherStoreError('TASK_NOT_YOURS', '只能转交给本组成员');
  }
  const active = await findActiveTask(db, groupId, config.targetRevision, targetKey);
  if (!active) throw new MotherStoreError('TASK_NOT_FOUND', '这个目标没有进行中的认领');
  if (expectedVersion != null && active.version !== expectedVersion) {
    throw new MotherStoreError('TASK_TAKEN', '任务状态已更新，请刷新后再试');
  }
  const now = Date.now();
  const updated = await db
    .prepare(
      `UPDATE collection_group_tasks
          SET status = 'claimed', owner_account_id = ?,
              version = version + 1, updated_at = ?
        WHERE group_id = ? AND target_revision = ? AND target_key = ? AND round = ?
          AND version = ? AND status <> 'closed'`,
    )
    .bind(toAccountId, now, groupId, active.target_revision, targetKey, active.round, active.version)
    .run();
  if ((updated.meta.changes ?? 0) === 0) {
    throw new MotherStoreError('TASK_TAKEN', '任务状态已更新，请刷新后再试');
  }
  return {
    ...toTaskRecord(active),
    status: 'claimed',
    ownerAccountId: toAccountId,
    version: active.version + 1,
    updatedAt: now,
  };
}

/**
 * 发布后复核：被新摘要覆盖的目标自动结束任务。
 * 只在当前目标修订内关闭；已关闭任务不会因为后来撤回而复活，下次认领会开新轮次。
 */
async function closeCoveredTasks(
  db: D1Database,
  groupId: string,
  targetRevision: number,
  keys: Set<string>,
): Promise<void> {
  if (keys.size === 0) return;
  const { results } = await db
    .prepare(
      `SELECT target_key, round FROM collection_group_tasks
        WHERE group_id = ? AND target_revision = ? AND status <> 'closed'`,
    )
    .bind(groupId, targetRevision)
    .all<{ target_key: string; round: number }>();
  const hits = results.filter((row) => keys.has(row.target_key));
  const now = Date.now();
  for (let index = 0; index < hits.length; index += 25) {
    const chunk = hits.slice(index, index + 25);
    await db.batch(
      chunk.map((row) =>
        db
          .prepare(
            `UPDATE collection_group_tasks
                SET status = 'closed', closed_at = ?, updated_at = ?, version = version + 1
              WHERE group_id = ? AND target_revision = ? AND target_key = ? AND round = ?
                AND status <> 'closed'`,
          )
          .bind(now, now, groupId, targetRevision, row.target_key, row.round),
      ),
    );
  }
}

/* ---------- 需求承接（2026-10-26 / 口径 2026-10-27） ---------- */

interface DemandRow {
  group_id: string;
  demander_account_id: string;
  egg_game_id: number;
  nature: string;
  gender: string;
  body: string;
  voice: string;
  require_green_nest?: number | null;
  status: string;
  claimer_account_id: string | null;
  /** 认领人标记「已上窝」的时间（2026-11-08）；NULL = 还没上窝。 */
  placed_at?: number | null;
  /** 上窝使用的游戏账号（uid:<gameId>），只在服务端留存，别人的视图不返回。 */
  placed_by_account_key?: string | null;
  version: number;
  created_at: number;
  updated_at: number;
}

const normalizeDemandGender = (value: unknown): DemandGender =>
  isDemandGender(value) ? value : DEFAULT_DEMAND_GENDER;
const normalizeDemandBody = (value: unknown): DemandBody =>
  isDemandBody(value) ? value : DEFAULT_DEMAND_BODY;
const normalizeDemandVoice = (value: unknown): DemandVoice =>
  isDemandVoice(value) ? value : DEFAULT_DEMAND_VOICE;

const toDemand = (row: DemandRow): CollectionDemand => ({
  groupId: row.group_id,
  demanderAccountId: row.demander_account_id,
  eggGameId: row.egg_game_id,
  nature: row.nature ?? '',
  gender: normalizeDemandGender(row.gender),
  body: normalizeDemandBody(row.body),
  voice: normalizeDemandVoice(row.voice),
  status: (row.status === 'claimed' || row.status === 'done' ? row.status : 'open') as CollectionDemandStatus,
  claimerAccountId: row.claimer_account_id,
  placedAt: row.placed_at ?? null,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.require_green_nest === 1 ? { requireGreenNest: true } : {}),
});

const DEMAND_COLUMNS = `group_id, demander_account_id, egg_game_id, nature,
  gender, body, voice, require_green_nest, status, claimer_account_id, placed_at,
  placed_by_account_key, version, created_at, updated_at`;

interface CompletionRow {
  group_id: string;
  demander_account_id: string;
  claimer_account_id: string;
  egg_game_id: number;
  nature: string;
  gender: string;
  body: string;
  voice: string;
  require_green_nest?: number | null;
  created_at: number;
  completed_at: number;
}

const COMPLETION_COLUMNS = `group_id, demander_account_id, claimer_account_id, egg_game_id, nature,
  gender, body, voice, require_green_nest, created_at, completed_at`;

/** 归档行映射回需求形状：前端仍按 `status = 'done'` 统计已结单，接口契约不变。 */
const toCompletedDemand = (row: CompletionRow): CollectionDemand => ({
  groupId: row.group_id,
  demanderAccountId: row.demander_account_id,
  eggGameId: row.egg_game_id,
  nature: row.nature ?? '',
  gender: normalizeDemandGender(row.gender),
  body: normalizeDemandBody(row.body),
  voice: normalizeDemandVoice(row.voice),
  status: 'done',
  claimerAccountId: row.claimer_account_id,
  // 已完成的单不再参与状态机，version 只为满足契约类型。
  version: 0,
  createdAt: row.created_at,
  updatedAt: row.completed_at,
  ...(row.require_green_nest === 1 ? { requireGreenNest: true } : {}),
});

/**
 * 组内未完成需求（open / claimed），按更新时间倒序。
 *
 * 已完成的单不再随列表下发（2026-11-01）：历史归档行只增不减，全量返回会让长期小组的
 * 响应随历史线性增长。已结单改为聚合计数 + 「我承接的最近 N 条」两份小数据，见 `readDemandFeed`。
 */
export async function listCollectionDemands(
  db: D1Database,
  groupId: string,
): Promise<CollectionDemand[]> {
  const [active] = await db.batch([
    db
      .prepare(
        `SELECT ${DEMAND_COLUMNS} FROM collection_group_demands
          WHERE group_id = ? AND status <> 'done'`,
      )
      .bind(groupId),
  ]);
  const activeRows = (active.results ?? []) as unknown as DemandRow[];
  return activeRows.map(toDemand).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 「你承接的需求已完成」回执只需要最近这些条，不做全量历史。 */
export const DEMAND_RECENT_COMPLETED_LIMIT = 20;

export interface CollectionDemandFeed {
  /** 未完成的需求（open / claimed）。 */
  demands: CollectionDemand[];
  /** 按承接人累计的已结单数（全时段，只算有承接人的归档行）。 */
  completedCounts: Record<string, number>;
  /** 当前身份承接的最近 N 条已完成，供完成回执计算水位与需求方名字。 */
  myRecentCompleted: CollectionDemand[];
}

/**
 * 需求中心的完整数据：未完成列表 + 已结单聚合 + 我的最近完成回执（2026-11-01）。
 *
 * 服务端一次给全，前端不再本地统计历史：成员区「已结单 N」用 `completedCounts`，
 * 回执条用 `myRecentCompleted`。
 */
export async function readDemandFeed(
  db: D1Database,
  groupId: string,
  viewerAccountId: string,
): Promise<CollectionDemandFeed> {
  const [demands, counts, recent] = await Promise.all([
    listCollectionDemands(db, groupId),
    db
      .prepare(
        `SELECT claimer_account_id AS claimer, COUNT(*) AS total
           FROM collection_group_demand_completions
          WHERE group_id = ? AND claimer_account_id IS NOT NULL
          GROUP BY claimer_account_id`,
      )
      .bind(groupId)
      .all<{ claimer: string; total: number }>(),
    db
      .prepare(
        `SELECT ${COMPLETION_COLUMNS} FROM collection_group_demand_completions
          WHERE group_id = ? AND claimer_account_id = ?
          ORDER BY completed_at DESC
          LIMIT ?`,
      )
      .bind(groupId, viewerAccountId, DEMAND_RECENT_COMPLETED_LIMIT)
      .all<CompletionRow>(),
  ]);
  const completedCounts: Record<string, number> = {};
  for (const row of (counts.results ?? []) as unknown as { claimer: string; total: number }[]) {
    completedCounts[row.claimer] = row.total;
  }
  return {
    demands,
    completedCounts,
    myRecentCompleted: ((recent.results ?? []) as unknown as CompletionRow[]).map(
      toCompletedDemand,
    ),
  };
}

export interface CollectionGroupVersionRow {
  detail: string;
  demands: string;
  tasks: string;
}

/**
 * 轻量版本号（2026-10-31）：轮询先拿这一小段，没变就不拉整包详情 / 需求 / 任务。
 *
 * 一条 SQL 里用主键前缀的子查询拼出三段指纹：成员数 + 资源修订、目标修订（详情）、
 * 需求条数与更新时间、任务条数与更新时间。比整包（几百 KB）便宜得多。
 */
export async function readCollectionGroupVersion(
  db: D1Database,
  groupId: string,
): Promise<CollectionGroupVersionRow> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM mother_group_members WHERE group_id = ?) AS member_count,
         (SELECT COALESCE(MAX(resource_revision), 0) FROM mother_group_members
           WHERE group_id = ?) AS resource_revision,
         (SELECT COALESCE(target_revision, 0) FROM collection_group_configs
           WHERE group_id = ?) AS target_revision,
         (SELECT COUNT(*) FROM mother_group_members WHERE group_id = ? AND published_at IS NOT NULL)
           AS published_count,
         (SELECT COUNT(*) FROM collection_group_demands WHERE group_id = ?) AS demand_count,
         (SELECT COALESCE(MAX(updated_at), 0) FROM collection_group_demands
           WHERE group_id = ?) AS demand_updated_at,
         (SELECT COUNT(*) FROM collection_group_demand_completions WHERE group_id = ?)
           AS demand_done_count,
         (SELECT COUNT(*) FROM collection_group_tasks WHERE group_id = ?) AS task_count,
         (SELECT COALESCE(MAX(updated_at), 0) FROM collection_group_tasks
           WHERE group_id = ?) AS task_updated_at`,
    )
    .bind(groupId, groupId, groupId, groupId, groupId, groupId, groupId, groupId, groupId)
    .first<{
      member_count: number;
      resource_revision: number;
      target_revision: number;
      published_count: number;
      demand_count: number;
      demand_updated_at: number;
      demand_done_count: number;
      task_count: number;
      task_updated_at: number;
    }>();
  return {
    detail: `${row?.member_count ?? 0}:${row?.resource_revision ?? 0}:${row?.target_revision ?? 0}:${row?.published_count ?? 0}`,
    demands: `${row?.demand_count ?? 0}:${row?.demand_updated_at ?? 0}:${row?.demand_done_count ?? 0}`,
    tasks: `${row?.task_count ?? 0}:${row?.task_updated_at ?? 0}`,
  };
}

export interface DemandCriteriaInput {
  demanderAccountId: string;
  eggGameId: number;
  nature: string;
  gender: DemandGender;
  body: DemandBody;
  voice: DemandVoice;
}

async function findDemand(
  db: D1Database,
  groupId: string,
  criteria: DemandCriteriaInput,
): Promise<DemandRow | null> {
  return db
    .prepare(
      `SELECT ${DEMAND_COLUMNS} FROM collection_group_demands
        WHERE group_id = ? AND demander_account_id = ? AND egg_game_id = ?
          AND nature = ? AND gender = ? AND body = ? AND voice = ?`,
    )
    .bind(
      groupId,
      criteria.demanderAccountId,
      criteria.eggGameId,
      criteria.nature,
      criteria.gender,
      criteria.body,
      criteria.voice,
    )
    .first<DemandRow>();
}

/** 同一条需求的最近一次完成记录（归档表里可能有多次：同一颗蛋允许再次发布）。 */
async function findCompletion(
  db: D1Database,
  groupId: string,
  criteria: DemandCriteriaInput,
): Promise<CompletionRow | null> {
  return db
    .prepare(
      `SELECT ${COMPLETION_COLUMNS} FROM collection_group_demand_completions
        WHERE group_id = ? AND demander_account_id = ? AND egg_game_id = ?
          AND nature = ? AND gender = ? AND body = ? AND voice = ?
        ORDER BY completed_at DESC LIMIT 1`,
    )
    .bind(
      groupId,
      criteria.demanderAccountId,
      criteria.eggGameId,
      criteria.nature,
      criteria.gender,
      criteria.body,
      criteria.voice,
    )
    .first<CompletionRow>();
}

/** 本人在本组发布过的游戏账号数（决定需求额度）。 */
async function sharedAccountCount(
  db: D1Database,
  groupId: string,
  accountId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT game_account_key) AS total FROM mother_group_accounts
        WHERE group_id = ? AND member_account_id = ?`,
    )
    .bind(groupId, accountId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function assertMotherGroup(db: D1Database, groupId: string): Promise<void> {
  const config = await readGroupConfig(db, groupId);
  if (config.groupType !== 'mother') {
    throw new MotherStoreError('DEMAND_UNSUPPORTED', '只有母本组支持需求承接');
  }
}

export interface PublishDemandInput {
  groupId: string;
  accountId: string;
  eggGameId: number;
  /** 要发布的性格；空数组 = 不挑性格（记成一条空性格）。 */
  natures: string[];
  gender: DemandGender;
  body: DemandBody;
  voice: DemandVoice;
  /** 要求这对亲本进学院小窝（绿窝）；缺省 false（2026-11-01）。 */
  requireGreenNest?: boolean;
}

/**
 * 发布需求：**一个性格一条**。
 *
 * - 勾 2 个性格 = 2 条需求，占 2 个额度；
 * - 同蛋 + 同性格 + 同性别 / 体型 / 声音 视为同一条，重复发布**不覆盖**已有行，
 *   避免把「已接单」重置成「待承接」；
 * - 不勾性格时记一条 `nature = ''`，表示不挑。
 */
export async function publishCollectionDemand(
  db: D1Database,
  input: PublishDemandInput,
): Promise<CollectionDemand[]> {
  const { groupId, accountId, eggGameId, gender, body, voice } = input;
  const requireGreenNest = input.requireGreenNest === true ? 1 : 0;
  await assertMotherGroup(db, groupId);
  // 入库统一 trim：校验只 trim 判空、入库若原样保留，' 胆小' 会变成另一条需求永远接不上（R2-7-L01）
  const natures =
    input.natures.length > 0 ? [...new Set(input.natures.map((nature) => nature.trim()))] : [''];

  const existing = await db
    .prepare(
      `SELECT nature FROM collection_group_demands
        WHERE group_id = ? AND demander_account_id = ? AND egg_game_id = ?
          AND gender = ? AND body = ? AND voice = ?
          AND nature IN (${natures.map(() => '?').join(', ')})`,
    )
    .bind(groupId, accountId, eggGameId, gender, body, voice, ...natures)
    .all<{ nature: string }>();
  const existingNatures = new Set((existing.results ?? []).map((row) => row.nature));
  const newRows = natures.filter((nature) => !existingNatures.has(nature)).length;
  const [accountCount, countRow] =
    newRows > 0
      ? await Promise.all([
          sharedAccountCount(db, groupId, accountId),
          db
            .prepare(
              `SELECT COUNT(*) AS total_open,
                      SUM(CASE WHEN demander_account_id = ? THEN 1 ELSE 0 END) AS mine_open
                 FROM collection_group_demands
                WHERE group_id = ? AND status <> 'done'`,
            )
            .bind(accountId, groupId)
            .first<{ total_open: number; mine_open: number | null }>(),
        ])
      : [0, null];
  const limit = demandLimitPerMember(accountCount);
  if (newRows > 0) {
    if ((countRow?.total_open ?? 0) + newRows > DEMAND_LIMIT_PER_GROUP) {
      throw new MotherStoreError('DEMAND_LIMIT', '本组需求已满，等有人完成或撤回后再发');
    }
    if ((countRow?.mine_open ?? 0) + newRows > limit) {
      throw new MotherStoreError(
        'DEMAND_LIMIT',
        `你的需求额度是 ${limit} 条（一个性格算一条），这次要多发 ${newRows} 条`,
      );
    }
  }

  const now = Date.now();
  if (newRows > 0) {
    // 额度判定下沉到插入语句：COUNT 与 INSERT 之间不再有间隙，并发发布也不会超额（R2-7-M01）。
    // 一次写入全部性格；额度不足时整条语句 0 行，一条也不落库。
    const natureRows =
      natures.length === 1
        ? 'SELECT ? AS nature'
        : natures.map(() => 'SELECT ? AS nature').join(' UNION ALL ');
    await db
      .prepare(
        `INSERT INTO collection_group_demands
           (group_id, demander_account_id, egg_game_id, nature, gender, body, voice,
            require_green_nest, status, claimer_account_id, version, created_at, updated_at)
         SELECT ?, ?, ?, n.nature, ?, ?, ?, ?, 'open', NULL, 0, ?, ?
           FROM (${natureRows}) AS n
          WHERE (SELECT COUNT(*) FROM collection_group_demands
                   WHERE group_id = ? AND status <> 'done') + ? <= ?
            AND (SELECT COUNT(*) FROM collection_group_demands
                   WHERE group_id = ? AND demander_account_id = ? AND status <> 'done') + ? <= ?
         ON CONFLICT (group_id, demander_account_id, egg_game_id, nature, gender, body, voice)
         DO NOTHING`,
      )
      .bind(
        groupId,
        accountId,
        eggGameId,
        gender,
        body,
        voice,
        requireGreenNest,
        now,
        now,
        ...natures,
        groupId,
        newRows,
        DEMAND_LIMIT_PER_GROUP,
        groupId,
        accountId,
        newRows,
        limit,
      )
      .run();
  }

  // 一次取回这几条（原来是按性格各查一次，N 个性格 = N 条 SQL）
  if (newRows > 0) {
    await touchPlanUpdatedAt(db, groupId, accountId, eggGameId, now);
  }
  const savedRows = await db
    .prepare(
      `SELECT ${DEMAND_COLUMNS} FROM collection_group_demands
        WHERE group_id = ? AND demander_account_id = ? AND egg_game_id = ?
          AND gender = ? AND body = ? AND voice = ?
          AND nature IN (${natures.map(() => '?').join(', ')})`,
    )
    .bind(groupId, accountId, eggGameId, gender, body, voice, ...natures)
    .all<DemandRow>();
  const byNature = new Map((savedRows.results ?? []).map((row) => [row.nature, row]));
  // 单条语句保证额度：若仍有性格没落库，只可能是「插入时额度刚好满」，不能当成发布成功
  if (newRows > 0 && natures.some((nature) => !byNature.has(nature))) {
    throw new MotherStoreError('DEMAND_LIMIT', '本组或你的需求额度刚好满了，刷新后再发');
  }
  return natures
    .map((nature) => byNature.get(nature))
    .filter((row): row is DemandRow => row != null)
    .map(toDemand);
}

/** 需求状态变化时同步推进计划的 updated_at：卡面「停几天」以最近一次状态变更为准。 */
async function touchPlanUpdatedAt(
  db: D1Database,
  groupId: string,
  demanderAccountId: string,
  eggGameId: number,
  at = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE collection_plans SET updated_at = ?
        WHERE group_id = ? AND member_account_id = ? AND egg_game_id = ? AND status = 'active'`,
    )
    .bind(at, groupId, demanderAccountId, eggGameId)
    .run();
}

/** 撤回自己的某一条需求（按蛋 + 性格 + 性别 / 体型 / 声音单独撤回）。 */
export async function withdrawCollectionDemand(
  db: D1Database,
  groupId: string,
  accountId: string,
  eggGameId: number,
  nature: string,
  gender: DemandGender,
  body: DemandBody,
  voice: DemandVoice,
): Promise<void> {
  const normalizedNature = nature.trim();
  const criteria: DemandCriteriaInput = {
    demanderAccountId: accountId,
    eggGameId,
    nature: normalizedNature,
    gender,
    body,
    voice,
  };
  const existing = await findDemand(db, groupId, criteria);
  if (!existing) {
    // 已完成的单已归档：仍然要明确告诉需求方「不能撤回」，不能报成不存在
    const completed = await findCompletion(db, groupId, criteria);
    if (completed) {
      throw new MotherStoreError('DEMAND_ALREADY_DONE', '已完成的需求不能撤回');
    }
    throw new MotherStoreError('DEMAND_NOT_FOUND', '这条需求已经不在了');
  }
  // 已完成的单是「已结单」计数的凭据，不能撤回（否则承接人的贡献会倒退）
  if (existing.status === 'done') {
    throw new MotherStoreError('DEMAND_ALREADY_DONE', '已完成的需求不能撤回');
  }
  const result = await db
    .prepare(
      `DELETE FROM collection_group_demands
        WHERE group_id = ? AND demander_account_id = ? AND egg_game_id = ? AND nature = ?
          AND gender = ? AND body = ? AND voice = ?
          AND status <> 'done'`,
    )
    .bind(groupId, accountId, eggGameId, normalizedNature, gender, body, voice)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    // 读到的快照与删除之间可能刚被确认完成：0 行删除不能当作撤回成功
    const latest = await findDemand(db, groupId, criteria);
    if (!latest) {
      const completed = await findCompletion(db, groupId, criteria);
      if (completed) {
        throw new MotherStoreError('DEMAND_ALREADY_DONE', '已完成的需求不能撤回');
      }
      throw new MotherStoreError('DEMAND_NOT_FOUND', '这条需求已经不在了');
    }
    if (latest.status === 'done') {
      throw new MotherStoreError('DEMAND_ALREADY_DONE', '已完成的需求不能撤回');
    }
    throw new MotherStoreError('DEMAND_TAKEN', '需求状态已更新，刷新后再看');
  }
}

export interface DemandActionInput {
  groupId: string;
  accountId: string;
  demanderAccountId: string;
  eggGameId: number;
  /** 接的是哪个性格的那一条（空字符串 = 不挑）。 */
  nature: string;
  gender: DemandGender;
  body: DemandBody;
  voice: DemandVoice;
  expectedVersion?: number;
}

const actionCriteria = (input: DemandActionInput): DemandCriteriaInput => ({
  demanderAccountId: input.demanderAccountId,
  eggGameId: input.eggGameId,
  nature: input.nature.trim(),
  gender: input.gender,
  body: input.body,
  voice: input.voice,
});

/** 接单：不能接自己的；同一需求只能有一个承接人。 */
export async function claimCollectionDemand(
  db: D1Database,
  input: DemandActionInput,
): Promise<CollectionDemand> {
  const { groupId, accountId, demanderAccountId, expectedVersion } = input;
  if (accountId === demanderAccountId) {
    throw new MotherStoreError('DEMAND_SELF', '不能接自己的需求');
  }
  const criteria = actionCriteria(input);
  const existing = await findDemand(db, groupId, criteria);
  if (!existing) throw new MotherStoreError('DEMAND_NOT_FOUND', '这条需求已经不在了');
  if (existing.status === 'done') {
    throw new MotherStoreError('DEMAND_ALREADY_DONE', '这条需求已经完成了');
  }
  if (existing.status === 'claimed' && existing.claimer_account_id != null) {
    if (existing.claimer_account_id !== accountId) {
      throw new MotherStoreError('DEMAND_TAKEN', '这条需求已经被别人接了');
    }
    return toDemand(existing);
  }
  const now = Date.now();
  // 承接人注销账号时外键会把 claimer 置 NULL 但状态仍是 claimed，这里一并视为可重新接单
  const result = await db
    .prepare(
      `UPDATE collection_group_demands
          SET status = 'claimed', claimer_account_id = ?, version = version + 1, updated_at = ?
        WHERE group_id = ? AND demander_account_id = ? AND egg_game_id = ? AND nature = ?
          AND gender = ? AND body = ? AND voice = ?
          AND (status = 'open' OR (status = 'claimed' AND claimer_account_id IS NULL))
          AND version = ?`,
    )
    .bind(
      accountId,
      now,
      groupId,
      demanderAccountId,
      input.eggGameId,
      input.nature,
      input.gender,
      input.body,
      input.voice,
      expectedVersion ?? existing.version,
    )
    .run();
  if ((result.meta?.changes ?? 0) === 0) {
    throw new MotherStoreError('DEMAND_TAKEN', '这条需求刚被抢走了，刷新后再看');
  }
  await touchPlanUpdatedAt(db, groupId, demanderAccountId, input.eggGameId, now);
  const saved = await findDemand(db, groupId, criteria);
  if (!saved) throw new MotherStoreError('DEMAND_NOT_FOUND', '这条需求已经不在了');
  return toDemand(saved);
}

/** 释放接单：只有承接人自己可以放弃。 */
export async function releaseCollectionDemand(
  db: D1Database,
  input: DemandActionInput,
): Promise<CollectionDemand> {
  const { groupId, accountId, demanderAccountId, expectedVersion } = input;
  const criteria = actionCriteria(input);
  const existing = await findDemand(db, groupId, criteria);
  if (!existing) throw new MotherStoreError('DEMAND_NOT_FOUND', '这条需求已经不在了');
  if (existing.status !== 'claimed' || existing.claimer_account_id !== accountId) {
    throw new MotherStoreError('DEMAND_NOT_YOURS', '只有接单的人可以放弃');
  }
  const now = Date.now();
  const result = await db
    .prepare(
      `UPDATE collection_group_demands
          SET status = 'open', claimer_account_id = NULL, version = version + 1, updated_at = ?
        WHERE group_id = ? AND demander_account_id = ? AND egg_game_id = ? AND nature = ?
          AND gender = ? AND body = ? AND voice = ?
          AND status = 'claimed' AND claimer_account_id = ? AND version = ?`,
    )
    .bind(
      now,
      groupId,
      demanderAccountId,
      input.eggGameId,
      input.nature,
      input.gender,
      input.body,
      input.voice,
      accountId,
      expectedVersion ?? existing.version,
    )
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    // 0 行更新不能当作成功：需求可能刚被需求方确认完成，或状态被别人改过
    const latest = await findDemand(db, groupId, criteria);
    if (!latest) throw new MotherStoreError('DEMAND_NOT_FOUND', '这条需求已经不在了');
    if (latest.status === 'done') {
      throw new MotherStoreError('DEMAND_ALREADY_DONE', '这条需求已经完成了');
    }
    throw new MotherStoreError('DEMAND_TAKEN', '需求状态已更新，刷新后再看');
  }
  await touchPlanUpdatedAt(db, groupId, demanderAccountId, input.eggGameId, now);
  const saved = await findDemand(db, groupId, criteria);
  if (!saved) throw new MotherStoreError('DEMAND_NOT_FOUND', '这条需求已经不在了');
  return toDemand(saved);
}

/** 完成确认：只有需求方（或组长）可以点。 */
export async function completeCollectionDemand(
  db: D1Database,
  input: DemandActionInput & { isOwner: boolean },
): Promise<CollectionDemand> {
  const { groupId, accountId, demanderAccountId, isOwner } = input;
  if (accountId !== demanderAccountId && !isOwner) {
    throw new MotherStoreError('DEMAND_NOT_YOURS', '只有需求方或组长可以确认完成');
  }
  const criteria = actionCriteria(input);
  const existing = await findDemand(db, groupId, criteria);
  if (!existing) {
    // 已经归档 = 别的设备刚完成过；按最近一次完成返回，重复提交保持幂等
    const completed = await findCompletion(db, groupId, criteria);
    if (completed) return toCompletedDemand(completed);
    throw new MotherStoreError('DEMAND_NOT_FOUND', '这条需求已经不在了');
  }
  if (existing.status === 'done') return toDemand(existing);
  if (existing.status !== 'claimed') {
    throw new MotherStoreError('DEMAND_NOT_CLAIMED', '还没有人接单，不能确认完成');
  }
  if (existing.claimer_account_id == null) {
    throw new MotherStoreError(
      'DEMAND_NOT_CLAIMED',
      '承接人已注销账号，无法确认完成；请撤回后重新发布',
    );
  }
  const now = Date.now();
  const version = input.expectedVersion ?? existing.version;
  const [inserted, removed] = await db.batch([
    db
      .prepare(
        `INSERT INTO collection_group_demand_completions
          (group_id, demander_account_id, claimer_account_id, egg_game_id, nature,
           gender, body, voice, require_green_nest, created_at, completed_at)
         SELECT group_id, demander_account_id, claimer_account_id, egg_game_id, nature,
                gender, body, voice, require_green_nest, created_at, ?
           FROM collection_group_demands
          WHERE group_id = ? AND demander_account_id = ? AND egg_game_id = ? AND nature = ?
            AND gender = ? AND body = ? AND voice = ?
            AND status = 'claimed' AND claimer_account_id IS NOT NULL AND version = ?`,
      )
      .bind(
        now,
        groupId,
        demanderAccountId,
        input.eggGameId,
        input.nature,
        input.gender,
        input.body,
        input.voice,
        version,
      ),
    db
      .prepare(
        `DELETE FROM collection_group_demands
          WHERE group_id = ? AND demander_account_id = ? AND egg_game_id = ? AND nature = ?
            AND gender = ? AND body = ? AND voice = ?
            AND status = 'claimed' AND claimer_account_id IS NOT NULL AND version = ?`,
      )
      .bind(
        groupId,
        demanderAccountId,
        input.eggGameId,
        input.nature,
        input.gender,
        input.body,
        input.voice,
        version,
      ),
  ]);
  if ((removed?.meta.changes ?? 0) === 0 || (inserted?.meta.changes ?? 0) === 0) {
    // 0 行变化不能当作成功：承接人可能刚放弃（改回 open），或别的设备已经完成
    const completed = await findCompletion(db, groupId, criteria);
    if (completed) return toCompletedDemand(completed);
    const latest = await findDemand(db, groupId, criteria);
    if (!latest) throw new MotherStoreError('DEMAND_NOT_FOUND', '这条需求已经不在了');
    if (latest.status === 'done') return toDemand(latest);
    if (latest.status !== 'claimed') {
      throw new MotherStoreError('DEMAND_NOT_CLAIMED', '对方刚放弃了这条需求，请刷新后再看');
    }
    throw new MotherStoreError('DEMAND_TAKEN', '需求状态已更新，刷新后再看');
  }
  return {
    groupId: existing.group_id,
    demanderAccountId: existing.demander_account_id,
    eggGameId: existing.egg_game_id,
    nature: existing.nature ?? '',
    gender: normalizeDemandGender(existing.gender),
    body: normalizeDemandBody(existing.body),
    voice: normalizeDemandVoice(existing.voice),
    status: 'done',
    claimerAccountId: existing.claimer_account_id,
    version: 0,
    createdAt: existing.created_at,
    updatedAt: now,
  };
}

/* ---------- 收集计划（2026-11-08） ---------- */

interface PlanRow {
  id: string;
  group_id: string;
  member_account_id: string;
  egg_game_id: number;
  note: string;
  status: string;
  version: number;
  created_at: number;
  updated_at: number;
}

interface OfferRow {
  id: string;
  group_id: string;
  plan_id: string;
  offer_account_id: string;
  note: string;
  status: string;
  created_at: number;
  updated_at: number;
}

const PLAN_COLUMNS = `id, group_id, member_account_id, egg_game_id, note, status,
  version, created_at, updated_at`;
const OFFER_COLUMNS = `id, group_id, plan_id, offer_account_id, note, status,
  created_at, updated_at`;

export const PLAN_NOTE_MAX = 200;

const normalizePlanStatus = (value: unknown): PlanStatus =>
  value === 'active' || value === 'done' ? value : 'backlog';

const toPlan = (row: PlanRow): CollectionPlan => ({
  id: row.id,
  groupId: row.group_id,
  memberAccountId: row.member_account_id,
  eggGameId: row.egg_game_id,
  note: row.note ?? '',
  status: normalizePlanStatus(row.status),
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toOffer = (row: OfferRow): PlanOffer => ({
  id: row.id,
  groupId: row.group_id,
  planId: row.plan_id,
  offerAccountId: row.offer_account_id,
  note: row.note ?? '',
  status: 'pending',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** 计划卡里展示的条件：只取这颗蛋仍在下发列表里的需求（open / claimed）。 */
export interface PlanDemandView {
  nature: string;
  gender: DemandGender;
  body: DemandBody;
  voice: DemandVoice;
  status: 'open' | 'claimed';
  claimerAccountId: string | null;
  placedAt: number | null;
}

export interface PlanOfferView {
  offerAccountId: string;
  offerDisplayName: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlanView extends CollectionPlan {
  memberDisplayName: string;
  progressStep: PlanProgressStep;
  needsConfirm: boolean;
  demands: PlanDemandView[];
  offers: PlanOfferView[];
}

export interface CollectionPlansView {
  plans: PlanView[];
  members: { accountId: string; displayName: string }[];
  /** 「你能补的」：别人进行中、而我发布过的蛋，按蛋去重。 */
  matchableEggIds: number[];
  /** 当前身份进行中的计划条数（展示「7/8」与额度提示）。 */
  myActiveCount: number;
  maxActivePlans: number;
}

/** 按组读计划列表：所有人（含自己）+ 需求条件 + 提供标记 + 「你能补的」。 */
export async function readCollectionPlans(
  db: D1Database,
  groupId: string,
  viewerAccountId: string,
): Promise<CollectionPlansView> {
  const [members, planRows, offerRows, demands, completions, myAccounts] = await Promise.all([
    db
      .prepare(
        `SELECT account_id, display_name FROM mother_group_members WHERE group_id = ?`,
      )
      .bind(groupId)
      .all<{ account_id: string; display_name: string }>(),
    db
      .prepare(`SELECT ${PLAN_COLUMNS} FROM collection_plans WHERE group_id = ?`)
      .bind(groupId)
      .all<PlanRow>(),
    db
      .prepare(`SELECT ${OFFER_COLUMNS} FROM plan_offers WHERE group_id = ?`)
      .bind(groupId)
      .all<OfferRow>(),
    listCollectionDemands(db, groupId),
    db
      .prepare(
        `SELECT demander_account_id, egg_game_id FROM collection_group_demand_completions
          WHERE group_id = ?`,
      )
      .bind(groupId)
      .all<{ demander_account_id: string; egg_game_id: number }>(),
    db
      .prepare(
        `SELECT egg_game_ids FROM mother_group_accounts
          WHERE group_id = ? AND member_account_id = ?`,
      )
      .bind(groupId, viewerAccountId)
      .all<{ egg_game_ids: string }>(),
  ]);

  const memberList = (members.results ?? []).map((row) => ({
    accountId: row.account_id,
    displayName: row.display_name,
  }));
  const nameOf = new Map(memberList.map((member) => [member.accountId, member.displayName]));
  const plans = (planRows.results ?? []).map(toPlan);
  const offers = (offerRows.results ?? []).map(toOffer);
  const completionRows = completions.results ?? [];
  // 状态徽标流只认未结单的需求（open / claimed），归档行按「已完成」由 completions 表达
  const planDemandLikes = demands.flatMap((row) =>
    row.status === 'open' || row.status === 'claimed'
      ? [
          {
            eggGameId: row.eggGameId,
            demanderAccountId: row.demanderAccountId,
            status: row.status,
            placedAt: row.placedAt ?? null,
          },
        ]
      : [],
  );
  const completionLikes = completionRows.map((row) => ({
    eggGameId: row.egg_game_id,
    demanderAccountId: row.demander_account_id,
  }));

  const offersByPlan = new Map<string, PlanOfferView[]>();
  for (const offer of offers) {
    const list = offersByPlan.get(offer.planId) ?? [];
    list.push({
      offerAccountId: offer.offerAccountId,
      offerDisplayName: nameOf.get(offer.offerAccountId) ?? '某成员',
      note: offer.note,
      createdAt: offer.createdAt,
      updatedAt: offer.updatedAt,
    });
    offersByPlan.set(offer.planId, list);
  }

  const views: PlanView[] = plans.map((plan) => {
    const mine = demands.filter(
      (row) => row.demanderAccountId === plan.memberAccountId && row.eggGameId === plan.eggGameId,
    );
    const progressStep = planProgressStep({
      plan,
      demands: planDemandLikes,
      completions: completionLikes,
      viewerAccountId,
    });
    return {
      ...plan,
      memberDisplayName: nameOf.get(plan.memberAccountId) ?? '某成员',
      progressStep,
      needsConfirm: planNeedsConfirm(progressStep),
      demands: mine
        .filter((row) => row.status === 'open' || row.status === 'claimed')
        .map((row) => ({
          nature: row.nature,
          gender: row.gender,
          body: row.body,
          voice: row.voice,
          status: row.status === 'claimed' ? 'claimed' : 'open',
          claimerAccountId: row.claimerAccountId,
          placedAt: row.placedAt ?? null,
        })),
      offers: (offersByPlan.get(plan.id) ?? []).sort((a, b) => a.createdAt - b.createdAt),
    };
  });

  const myEggGameIds = (myAccounts.results ?? []).flatMap((row) => parseStoredIds(row.egg_game_ids));
  const myPlans = plans.filter((plan) => plan.memberAccountId === viewerAccountId);

  return {
    plans: views,
    members: memberList,
    matchableEggIds: matchablePlanEggIds({
      myAccountId: viewerAccountId,
      myEggGameIds,
      plans,
    }),
    myActiveCount: countActivePlans(myPlans),
    maxActivePlans: MAX_ACTIVE_PLANS,
  };
}

export interface CreatePlansResult {
  plans: CollectionPlan[];
  skipped: number;
  doneSkipped: number;
  /** 想直接开始但额度已满、实际落成「想收」的条数。 */
  overflow: number;
  notice: string | null;
}

async function findPlanRow(
  db: D1Database,
  groupId: string,
  planId: string,
): Promise<PlanRow | null> {
  return db
    .prepare(`SELECT ${PLAN_COLUMNS} FROM collection_plans WHERE group_id = ? AND id = ?`)
    .bind(groupId, planId)
    .first<PlanRow>();
}

async function activePlanCount(
  db: D1Database,
  groupId: string,
  accountId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM collection_plans
        WHERE group_id = ? AND member_account_id = ? AND status = 'active'`,
    )
    .bind(groupId, accountId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/** 超出 8 条时把新多出来的进行中退回「想收」（保留最早的 8 条，避免并发插入破上限）。 */
async function capActivePlans(
  db: D1Database,
  groupId: string,
  accountId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE collection_plans SET status = 'backlog'
        WHERE id IN (
          SELECT id FROM collection_plans
           WHERE group_id = ? AND member_account_id = ? AND status = 'active'
           ORDER BY created_at ASC, id ASC
           LIMIT -1 OFFSET ?
        )`,
    )
    .bind(groupId, accountId, MAX_ACTIVE_PLANS)
    .run();
}

/**
 * 创建 / 批量导入计划：同一个蛋只建一条，已存在（含已完成）跳过。
 *
 * 状态判定全部来自 `planCreateDecision`，这里只负责落库与并发兜底。
 */
export async function createCollectionPlans(
  db: D1Database,
  input: {
    groupId: string;
    accountId: string;
    eggGameIds: number[];
    note?: string;
    /** 是否顺带开始；批量导入缺口传 false。 */
    start?: boolean;
  },
): Promise<CreatePlansResult> {
  const { groupId, accountId } = input;
  const existingRows = await db
    .prepare(
      `SELECT egg_game_id, status FROM collection_plans
        WHERE group_id = ? AND member_account_id = ?`,
    )
    .bind(groupId, accountId)
    .all<{ egg_game_id: number; status: string }>();
  const existing = (existingRows.results ?? []).map((row) => ({
    eggGameId: row.egg_game_id,
    status: normalizePlanStatus(row.status),
  }));
  const decision = planCreateDecision({
    eggGameIds: input.eggGameIds,
    existing,
    start: input.start === true,
    activeCount: countActivePlans(existing),
  });

  const note = (input.note ?? '').slice(0, PLAN_NOTE_MAX);
  const now = Date.now();
  if (decision.create.length > 0) {
    await db.batch(
      decision.create.map((item) =>
        db
          .prepare(
            `INSERT INTO collection_plans
               (id, group_id, member_account_id, egg_game_id, note, status, version,
                created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
             ON CONFLICT (group_id, member_account_id, egg_game_id) DO NOTHING`,
          )
          .bind(
            crypto.randomUUID(),
            groupId,
            accountId,
            item.eggGameId,
            note,
            item.status,
            now,
            now,
          ),
      ),
    );
  }
  if (decision.create.some((item) => item.status === 'active')) {
    await capActivePlans(db, groupId, accountId);
  }

  const eggIds = decision.create.map((item) => item.eggGameId);
  const savedRows =
    eggIds.length === 0
      ? []
      : (
          await db
            .prepare(
              `SELECT ${PLAN_COLUMNS} FROM collection_plans
                WHERE group_id = ? AND member_account_id = ?
                  AND egg_game_id IN (${eggIds.map(() => '?').join(', ')})`,
            )
            .bind(groupId, accountId, ...eggIds)
            .all<PlanRow>()
        ).results ?? [];
  const saved = savedRows.map(toPlan);
  const byEgg = new Map(saved.map((plan) => [plan.eggGameId, plan]));
  // 决策阶段因额度不足落想收的 + 并发兜底被退回想收的，都是「满 8 条」的提示来源
  const cappedOverflow = decision.create.filter(
    (item) => item.status === 'active' && byEgg.get(item.eggGameId)?.status === 'backlog',
  ).length;
  const overflow = decision.overflow + cappedOverflow;

  return {
    plans: saved,
    skipped: decision.skipped,
    doneSkipped: decision.doneSkipped,
    overflow,
    notice: overflow > 0 ? PLAN_OVERFLOW_NOTICE : null,
  };
}

export interface PlanActionResult {
  plan: CollectionPlan;
  /** 想开始但额度已满：计划仍是「想收」，附一句提示，不报错。 */
  overflow: boolean;
  notice: string | null;
}

async function requireOwnPlan(
  db: D1Database,
  groupId: string,
  accountId: string,
  planId: string,
): Promise<PlanRow> {
  const row = await findPlanRow(db, groupId, planId);
  if (!row) throw new MotherStoreError('PLAN_NOT_FOUND', '这条计划已经不在了');
  if (row.member_account_id !== accountId) {
    throw new MotherStoreError('PLAN_NOT_YOURS', '只有计划的主人可以操作');
  }
  return row;
}

/** 开始：想收 → 进行中；已满 8 条时留在想收并提示，不报错。 */
export async function startCollectionPlan(
  db: D1Database,
  input: { groupId: string; accountId: string; planId: string },
): Promise<PlanActionResult> {
  const { groupId, accountId, planId } = input;
  const row = await requireOwnPlan(db, groupId, accountId, planId);
  const outcome = planStartOutcome(normalizePlanStatus(row.status), await activePlanCount(db, groupId, accountId));
  if (outcome === 'done') {
    throw new MotherStoreError('PLAN_ALREADY_DONE', '已完成的计划不能重新开始');
  }
  if (outcome === 'overflow') {
    return { plan: toPlan(row), overflow: true, notice: PLAN_OVERFLOW_NOTICE };
  }
  if (outcome === 'already-active') {
    return { plan: toPlan(row), overflow: false, notice: null };
  }
  const now = Date.now();
  const updated = await db
    .prepare(
      `UPDATE collection_plans
          SET status = 'active', version = version + 1, updated_at = ?
        WHERE id = ? AND group_id = ? AND member_account_id = ? AND status = 'backlog'
          AND (SELECT COUNT(*) FROM collection_plans
                WHERE group_id = ? AND member_account_id = ? AND status = 'active') < ?`,
    )
    .bind(now, planId, groupId, accountId, groupId, accountId, MAX_ACTIVE_PLANS)
    .run();
  if ((updated.meta.changes ?? 0) === 0) {
    // 0 行不是失败：可能刚被另一台设备开始（幂等），也可能额度刚好被别人占满
    const latest = await findPlanRow(db, groupId, planId);
    if (!latest) throw new MotherStoreError('PLAN_NOT_FOUND', '这条计划已经不在了');
    if (normalizePlanStatus(latest.status) === 'active') {
      return { plan: toPlan(latest), overflow: false, notice: null };
    }
    return { plan: toPlan(latest), overflow: true, notice: PLAN_OVERFLOW_NOTICE };
  }
  const saved = await findPlanRow(db, groupId, planId);
  if (!saved) throw new MotherStoreError('PLAN_NOT_FOUND', '这条计划已经不在了');
  return { plan: toPlan(saved), overflow: false, notice: null };
}

/** 完成：想收也能直接完成（用户手里已经有这颗蛋）；已完成幂等。 */
export async function completeCollectionPlan(
  db: D1Database,
  input: { groupId: string; accountId: string; planId: string },
): Promise<CollectionPlan> {
  const { groupId, accountId, planId } = input;
  const row = await requireOwnPlan(db, groupId, accountId, planId);
  if (normalizePlanStatus(row.status) === 'done') return toPlan(row);
  const now = Date.now();
  // 计划直接完成后，未结单需求一起撤回：否则计划从广场消失，需求仍可被接单，发布人反而没入口处理。
  const results = await db.batch([
    db
      .prepare(
        `UPDATE collection_plans
            SET status = 'done', version = version + 1, updated_at = ?
          WHERE id = ? AND group_id = ? AND member_account_id = ? AND status <> 'done'`,
      )
      .bind(now, planId, groupId, accountId),
    db
      .prepare(
        `DELETE FROM collection_group_demands
          WHERE group_id = ? AND demander_account_id = ? AND egg_game_id = ? AND status <> 'done'`,
      )
      .bind(groupId, accountId, row.egg_game_id),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    const latest = await findPlanRow(db, groupId, planId);
    if (!latest) throw new MotherStoreError('PLAN_NOT_FOUND', '这条计划已经不在了');
    return toPlan(latest);
  }
  const saved = await findPlanRow(db, groupId, planId);
  if (!saved) throw new MotherStoreError('PLAN_NOT_FOUND', '这条计划已经不在了');
  return toPlan(saved);
}

/** 删除：物理删除，连带清掉 plan_offers（外键 ON DELETE CASCADE）。 */
export async function deleteCollectionPlan(
  db: D1Database,
  input: { groupId: string; accountId: string; planId: string },
): Promise<void> {
  const { groupId, accountId, planId } = input;
  await requireOwnPlan(db, groupId, accountId, planId);
  const result = await db
    .prepare(`DELETE FROM collection_plans WHERE id = ? AND group_id = ? AND member_account_id = ?`)
    .bind(planId, groupId, accountId)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new MotherStoreError('PLAN_NOT_FOUND', '这条计划已经不在了');
  }
}

/** 「我能提供」：标记或改备注（同一个入口，upsert）。 */
export async function markPlanOffer(
  db: D1Database,
  input: { groupId: string; accountId: string; planId: string; note?: string },
): Promise<PlanOffer> {
  const { groupId, accountId, planId } = input;
  const plan = await findPlanRow(db, groupId, planId);
  if (!plan) throw new MotherStoreError('PLAN_NOT_FOUND', '这条计划已经不在了');
  if (plan.member_account_id === accountId) {
    throw new MotherStoreError('PLAN_OFFER_SELF', '不需要给自己的计划标「我能提供」');
  }
  if (normalizePlanStatus(plan.status) === 'done') {
    throw new MotherStoreError('PLAN_ALREADY_DONE', '这条计划已经完成了');
  }
  const note = (input.note ?? '').slice(0, PLAN_NOTE_MAX);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO plan_offers
         (id, group_id, plan_id, offer_account_id, note, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT (plan_id, offer_account_id)
       DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), groupId, planId, accountId, note, now, now)
    .run();
  const saved = await db
    .prepare(`SELECT ${OFFER_COLUMNS} FROM plan_offers WHERE plan_id = ? AND offer_account_id = ?`)
    .bind(planId, accountId)
    .first<OfferRow>();
  if (!saved) throw new MotherStoreError('PLAN_OFFER_NOT_FOUND', '标记没有保存成功，请重试');
  return toOffer(saved);
}

/** 撤回「我能提供」。 */
export async function withdrawPlanOffer(
  db: D1Database,
  input: { groupId: string; accountId: string; planId: string },
): Promise<void> {
  const { groupId, accountId, planId } = input;
  const result = await db
    .prepare(
      `DELETE FROM plan_offers WHERE group_id = ? AND plan_id = ? AND offer_account_id = ?`,
    )
    .bind(groupId, planId, accountId)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new MotherStoreError('PLAN_OFFER_NOT_FOUND', '还没有标记过「我能提供」');
  }
}

/**
 * 需求结单后的自动完成：这颗蛋关联的需求「全部结单」才把计划置为已完成。
 *
 * 判定只用 `shouldAutoCompletePlan`；中途撤回会让归档为 0，因此不会触发。
 */
export async function autoCompletePlanAfterDemand(
  db: D1Database,
  groupId: string,
  demanderAccountId: string,
  eggGameId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT ${PLAN_COLUMNS} FROM collection_plans
        WHERE group_id = ? AND member_account_id = ? AND egg_game_id = ?`,
    )
    .bind(groupId, demanderAccountId, eggGameId)
    .first<PlanRow>();
  if (!row || normalizePlanStatus(row.status) !== 'active') return false;

  const [demands, completions] = await Promise.all([
    listCollectionDemands(db, groupId),
    db
      .prepare(
        `SELECT demander_account_id, egg_game_id FROM collection_group_demand_completions
          WHERE group_id = ?`,
      )
      .bind(groupId)
      .all<{ demander_account_id: string; egg_game_id: number }>(),
  ]);
  const shouldComplete = shouldAutoCompletePlan({
    plan: toPlan(row),
    demands: demands
      .filter((demand) => demand.status === 'open' || demand.status === 'claimed')
      .map((demand) => ({
        eggGameId: demand.eggGameId,
        demanderAccountId: demand.demanderAccountId,
        status: demand.status as 'open' | 'claimed',
        placedAt: demand.placedAt ?? null,
      })),
    completions: (completions.results ?? []).map((completion) => ({
      eggGameId: completion.egg_game_id,
      demanderAccountId: completion.demander_account_id,
    })),
  });
  if (!shouldComplete) return false;
  await db
    .prepare(
      `UPDATE collection_plans SET status = 'done', version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'active'`,
    )
    .bind(Date.now(), row.id)
    .run();
  return true;
}

/** 认领人标记「已上窝」：只有接单的人可以标记，记录使用的游戏账号（不对外展示）。 */
export async function markDemandPlaced(
  db: D1Database,
  input: DemandActionInput & { accountKey?: string | null },
): Promise<CollectionDemand> {
  const { groupId, accountId } = input;
  const criteria = actionCriteria(input);
  const existing = await findDemand(db, groupId, criteria);
  if (!existing) throw new MotherStoreError('DEMAND_NOT_FOUND', '这条需求已经不在了');
  if (existing.status !== 'claimed' || existing.claimer_account_id !== accountId) {
    throw new MotherStoreError('DEMAND_NOT_YOURS', '只有接单的人可以标记已上窝');
  }
  const now = Date.now();
  const result = await db
    .prepare(
      `UPDATE collection_group_demands
          SET placed_at = ?, placed_by_account_key = ?, version = version + 1, updated_at = ?
        WHERE group_id = ? AND demander_account_id = ? AND egg_game_id = ? AND nature = ?
          AND gender = ? AND body = ? AND voice = ?
          AND status = 'claimed' AND claimer_account_id = ?`,
    )
    .bind(
      now,
      input.accountKey ?? null,
      now,
      groupId,
      input.demanderAccountId,
      input.eggGameId,
      input.nature,
      input.gender,
      input.body,
      input.voice,
      accountId,
    )
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new MotherStoreError('DEMAND_TAKEN', '需求状态已更新，刷新后再看');
  }
  await touchPlanUpdatedAt(db, groupId, input.demanderAccountId, input.eggGameId, now);
  const saved = await findDemand(db, groupId, criteria);
  if (!saved) throw new MotherStoreError('DEMAND_NOT_FOUND', '这条需求已经不在了');
  return toDemand(saved);
}
