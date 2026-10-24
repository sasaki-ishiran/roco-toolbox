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
  MOTHER_CRITERIA_ID,
  MOTHER_GROUP_MAX_MEMBERS,
  MOTHER_RESOURCE_SCHEMA_VERSION,
  canonicalEggGameIds,
  type MotherCriteriaId,
  type MotherResourceDraft,
  type PublishedMotherResource,
  type SharedMotherAccount,
} from '../../src/shared/motherGroups';
import {
  COLLECTION_GROUP_SCHEMA_VERSION,
  emptyStudTarget,
  isTargetReady,
  motherCriteriaIdOf,
  studSlotSetIdOf,
  slotKeyOf,
  type CollectionGroupConfig,
  type CollectionGroupDetail,
  type CollectionGroupInfo,
  type CollectionGroupMember,
  type CollectionGroupSummary,
  type CollectionGroupType,
  type CollectionTargetGrade,
  type CollectionTargetMode,
  type GroupTargetConfig,
  type MotherTargetConfig,
  type PublishedStudResource,
  type SharedStudAccount,
  type StudResourceDraft,
  type StudSlotCoverage,
  type StudTargetConfig,
  type StudTargetSlot,
} from '../../src/shared/collectionGroups';
import { MotherStoreError, publishMemberResource } from './motherGroupsStore';

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

/** 读取单个组的配置；没有行时按旧组默认值返回（不写库）。 */
export async function readGroupConfig(
  db: D1Database,
  groupId: string,
): Promise<CollectionGroupConfig> {
  const row = await db
    .prepare(
      `SELECT group_id, group_type, target_revision, resource_epoch, target_json, updated_at
         FROM collection_group_configs WHERE group_id = ?`,
    )
    .bind(groupId)
    .first<ConfigRow>();
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

function parseStoredTarget(rawType: string, raw: string): GroupTargetConfig | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record.kind === 'mother' && asGroupType(rawType) === 'mother') {
      return {
        kind: 'mother',
        criteriaId: String(record.criteriaId ?? ''),
        mode: record.mode === 'medal' ? 'medal' : 'perfect',
        bodies: Array.isArray(record.bodies) ? record.bodies.map(String) : [],
        voices: Array.isArray(record.voices) ? record.voices.map(String) : [],
        catalogVersion: String(record.catalogVersion ?? ''),
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
  const row = await db
    .prepare('SELECT id, name, owner_account_id, created_at FROM mother_groups WHERE id = ?')
    .bind(groupId)
    .first<GroupRow>();
  if (!row) return null;
  const config = await readGroupConfig(db, groupId);
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
                source_exported_at, egg_game_ids
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
    list.push({
      accountKey: row.game_account_key,
      accountName: row.account_name,
      sourceExportedAt: row.source_exported_at,
      eggGameIds: parseStoredIds(row.egg_game_ids),
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
      const first = studResult.results.find(
        (item) => (item as StudAccountRow).member_account_id === row.account_id,
      ) as StudAccountRow | undefined;
      studResource.targetRevision = first?.target_revision ?? 0;
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

function parseStoredIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? canonicalEggGameIds(parsed) : [];
  } catch {
    return [];
  }
}

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

export async function publishStudResource(
  db: D1Database,
  input: PublishStudInput,
): Promise<{ resourceRevision: number; publishedAt: number | null }> {
  const { groupId, accountId, baseRevision, resource } = input;

  const config = await readGroupConfig(db, groupId);
  if (config.groupType !== 'stud') {
    throw new MotherStoreError('GROUP_NOT_FOUND', '这个小组不是种公组');
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
          WHERE group_id = ? AND account_id = ? AND resource_revision = ?`,
      )
      .bind(
        writeToken,
        published ? now : null,
        published ? resource.catalogVersion : null,
        published ? resource.targetId : null,
        groupId,
        accountId,
        baseRevision,
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
  // 让旧修订下的寻找任务只作历史；新修订重新生成
  await db
    .prepare(
      `UPDATE collection_group_tasks
          SET status = 'closed', closed_at = ?, updated_at = ?, version = version + 1
        WHERE group_id = ? AND status <> 'closed'`,
    )
    .bind(now, now, groupId)
    .run();
  return { targetRevision: baseTargetRevision + 1 };
}

/** 普通成员退出：释放自己认领的任务，再删成员（种公摘要随外键级联删除）。 */
export async function leaveCollectionGroup(
  db: D1Database,
  groupId: string,
  accountId: string,
): Promise<void> {
  const now = Date.now();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE collection_group_tasks
            SET owner_account_id = NULL, status = 'open',
                updated_at = ?, version = version + 1
          WHERE group_id = ? AND owner_account_id = ? AND status = 'claimed'`,
      )
      .bind(now, groupId, accountId),
    db
      .prepare('DELETE FROM mother_group_members WHERE group_id = ? AND account_id = ?')
      .bind(groupId, accountId),
  ]);
  if ((result[1]?.meta.changes ?? 0) === 0) {
    throw new MotherStoreError('NOT_MEMBER', '不是该组成员');
  }
}

/** 供 handler 判断旧接口能否操作该组：非母本组一律当作不存在。 */
export async function isMotherGroup(db: D1Database, groupId: string): Promise<boolean> {
  const config = await readGroupConfig(db, groupId);
  return config.groupType === 'mother';
}

/** 发布母本摘要到任意类型的组：类型必须匹配，其余复用一期原子写入。 */
export async function publishMotherResourceToGroup(
  db: D1Database,
  input: { groupId: string; accountId: string; baseRevision: number; resource: MotherResourceDraft },
): Promise<{ resourceRevision: number; publishedAt: number | null }> {
  const config = await readGroupConfig(db, input.groupId);
  if (config.groupType !== 'mother') {
    throw new MotherStoreError('GROUP_NOT_FOUND', '这个小组不是母本组');
  }
  const expectedCriteria =
    config.target?.kind === 'mother' ? config.target.criteriaId : MOTHER_CRITERIA_ID;
  if (input.resource.criteriaId !== expectedCriteria) {
    throw new MotherStoreError('TARGET_CHANGED', '本组口径已更新，请重新预览再发布');
  }
  if (
    config.target?.kind === 'mother' &&
    config.target.catalogVersion &&
    input.resource.catalogVersion !== config.target.catalogVersion
  ) {
    throw new MotherStoreError('TARGET_CHANGED', '图鉴已更新，请先更新本组目标');
  }
  return publishMemberResource(db, input);
}

/** 母本目标标准化：默认口径沿用一期 criteriaId。 */
export function normalizeMotherTarget(target: MotherTargetConfig): MotherTargetConfig {
  return {
    ...target,
    criteriaId: motherCriteriaIdOf({
      mode: target.mode,
      bodies: target.bodies,
      voices: target.voices,
    }),
  };
}

/** 空种公目标的标准形式（创建种公组但尚未确认目标时使用）。 */
export const emptyStudTargetFor = (catalogVersion: string): StudTargetConfig =>
  emptyStudTarget(catalogVersion);

/** 组目标的展示摘要（界面与加入确认共用）。 */
export function describeTarget(target: GroupTargetConfig | null): string {
  if (!target) return '目标待确认';
  if (target.kind === 'mother') {
    const bodies = target.bodies.join('/') || '体型不限';
    const voices = target.voices.join('/') || '声音不限';
    return `母 · ${bodies} · ${voices}`;
  }
  if (target.slots.length === 0) return '目标待确认';
  const natures = [...new Set(target.slots.map((slot) => slot.natureName))];
  return `${target.mode === 'perfect' ? '追满分' : '追双牌'} · ${target.slots.length} 个槽位 · ${natures.slice(0, 3).join('/')}${natures.length > 3 ? '…' : ''}`;
}

/** 目标槽位按「蛋组 → 性格」分组，便于界面紧凑展示。 */
export function groupSlotsByGroup(
  target: StudTargetConfig,
): Array<{ groupId: number; slots: StudTargetSlot[] }> {
  const map = new Map<number, StudTargetSlot[]>();
  for (const slot of target.slots) {
    const list = map.get(slot.groupId) ?? [];
    list.push(slot);
    map.set(slot.groupId, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([groupId, slots]) => ({ groupId, slots }));
}
