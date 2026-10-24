/**
 * 多人母本共享：D1 查询与原子写入（不处理 HTTP）。
 *
 * 关键约束（设计第 5 节）：
 * - 一次发布是「该成员完整所选账号集合」的替换（含删除），不是只增不减；
 * - 用 `baseRevision` 做乐观锁，CAS 失败时后续删除/插入全部无操作；
 * - 删除与插入都以本次写入的 `write_token` 为条件，客户端永远不能传这个值；
 * - 同一游戏 UID 在一个组内只归一位成员，冲突时整批回滚、旧摘要完整保留。
 */
import {
  MOTHER_GROUP_MAX_MEMBERS,
  MOTHER_RESOURCE_SCHEMA_VERSION,
  canonicalEggGameIds,
  type MotherApiSuccess,
  type MotherCriteriaId,
  type MotherGroupDetail,
  type MotherGroupInfo,
  type MotherGroupMember,
  type MotherGroupSummary,
  type MotherResourceDraft,
  type SharedMotherAccount,
} from '../../src/shared/motherGroups';

export type MotherStoreErrorCode =
  | 'GROUP_NOT_FOUND'
  | 'NOT_MEMBER'
  | 'NOT_OWNER'
  | 'GROUP_FULL'
  | 'REVISION_CONFLICT'
  | 'STALE_SOURCE'
  | 'SOURCE_MISMATCH'
  | 'GAME_ACCOUNT_ALREADY_SHARED'
  | 'OWNER_MUST_DISSOLVE'
  /** 组长改过目标，旧客户端不能继续按旧口径发布。 */
  | 'TARGET_CHANGED'
  /** 种公组还没确认目标，或目标槽位为空。 */
  | 'TARGET_NOT_READY'
  /** 共同寻找：目标已被他人认领。 */
  | 'TASK_TAKEN'
  /** 共同寻找：目标已经由已发布资源覆盖。 */
  | 'TASK_ALREADY_COVERED'
  /** 共同寻找：还有成员未发布 / 目标或图鉴不一致，不能确认缺口。 */
  | 'TASKS_NOT_CONFIRMED'
  /** 共同寻找：任务不存在或已关闭。 */
  | 'TASK_NOT_FOUND'
  /** 共同寻找：只有负责人或组长可以释放 / 转交。 */
  | 'TASK_NOT_YOURS';

export class MotherStoreError extends Error {
  readonly code: MotherStoreErrorCode;

  constructor(code: MotherStoreErrorCode, message: string) {
    super(message);
    this.name = 'MotherStoreError';
    this.code = code;
  }
}

interface GroupRow {
  id: string;
  name: string;
  owner_account_id: string;
  created_at: number;
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

interface AccountRow {
  member_account_id: string;
  game_account_key: string;
  account_name: string;
  source_exported_at: string;
  egg_game_ids: string;
}

const toGroupInfo = (row: GroupRow): MotherGroupInfo => ({
  id: row.id,
  name: row.name,
  ownerAccountId: row.owner_account_id,
  createdAt: row.created_at,
});

/** 我加入的组（跨设备发现成员资格，不依赖本地存储）。 */
export async function listGroupsForAccount(
  db: D1Database,
  accountId: string,
): Promise<MotherGroupSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.name, g.owner_account_id, g.created_at,
              (SELECT COUNT(*) FROM mother_group_members m WHERE m.group_id = g.id) AS member_count
         FROM mother_groups g
         LEFT JOIN collection_group_configs c ON c.group_id = g.id
         JOIN mother_group_members me ON me.group_id = g.id AND me.account_id = ?
        WHERE COALESCE(c.group_type, 'mother') = 'mother'
        ORDER BY g.created_at ASC, g.id ASC`,
    )
    .bind(accountId)
    .all<GroupRow & { member_count: number }>();
  return results.map((row) => ({
    id: row.id,
    name: row.name,
    ownerAccountId: row.owner_account_id,
    memberCount: row.member_count,
  }));
}

export async function findGroup(db: D1Database, groupId: string): Promise<MotherGroupInfo | null> {
  const row = await db
    .prepare('SELECT id, name, owner_account_id, created_at FROM mother_groups WHERE id = ?')
    .bind(groupId)
    .first<GroupRow>();
  return row ? toGroupInfo(row) : null;
}

export async function isMember(
  db: D1Database,
  groupId: string,
  accountId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM mother_group_members WHERE group_id = ? AND account_id = ?')
    .bind(groupId, accountId)
    .first<{ found: number }>();
  return row != null;
}

export async function createGroup(
  db: D1Database,
  input: {
    id: string;
    ownerAccountId: string;
    name: string;
    inviteHash: string;
    displayName: string;
    now: number;
  },
): Promise<MotherGroupInfo> {
  const { id, ownerAccountId, name, inviteHash, displayName, now } = input;
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
  ]);
  return { id, name, ownerAccountId, createdAt: now };
}

/**
 * 加入组：容量检查写进 INSERT 的 WHERE 条件里，并发抢最后一个名额不会超过 20。
 * 已是成员时 `ON CONFLICT DO NOTHING` → RETURNING 无行，回退查询确认幂等成功。
 */
export async function joinGroup(
  db: D1Database,
  input: { accountId: string; displayName: string; inviteHash: string; now: number },
): Promise<string> {
  const { accountId, displayName, inviteHash, now } = input;
  const inserted = await db
    .prepare(
      `INSERT INTO mother_group_members (group_id, account_id, display_name, joined_at)
       SELECT g.id, ?, ?, ?
         FROM mother_groups g
         LEFT JOIN collection_group_configs c ON c.group_id = g.id
        WHERE g.invite_hash = ?
          AND COALESCE(c.group_type, 'mother') = 'mother'
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
  if (inserted) return inserted.group_id;

  // RETURNING 为空：可能已是成员（幂等）、名额满，或邀请码已失效
  const member = await db
    .prepare(
      `SELECT m.group_id
         FROM mother_group_members m
         JOIN mother_groups g ON g.id = m.group_id
         LEFT JOIN collection_group_configs c ON c.group_id = g.id
        WHERE g.invite_hash = ? AND m.account_id = ?
          AND COALESCE(c.group_type, 'mother') = 'mother'`,
    )
    .bind(inviteHash, accountId)
    .first<{ group_id: string }>();
  if (member) return member.group_id;

  const group = await db
    .prepare(
      `SELECT g.id
         FROM mother_groups g
         LEFT JOIN collection_group_configs c ON c.group_id = g.id
        WHERE g.invite_hash = ? AND COALESCE(c.group_type, 'mother') = 'mother'`,
    )
    .bind(inviteHash)
    .first<{ id: string }>();
  if (!group) throw new MotherStoreError('GROUP_NOT_FOUND', '邀请码不对或小组已解散');
  throw new MotherStoreError('GROUP_FULL', `小组已满 ${MOTHER_GROUP_MAX_MEMBERS} 人`);
}

export async function updateDisplayName(
  db: D1Database,
  groupId: string,
  accountId: string,
  displayName: string,
): Promise<void> {
  const result = await db
    .prepare(
      'UPDATE mother_group_members SET display_name = ? WHERE group_id = ? AND account_id = ?',
    )
    .bind(displayName, groupId, accountId)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new MotherStoreError('NOT_MEMBER', '不是该组成员');
  }
}

export async function resetInvite(
  db: D1Database,
  groupId: string,
  ownerAccountId: string,
  inviteHash: string,
): Promise<void> {
  const result = await db
    .prepare('UPDATE mother_groups SET invite_hash = ? WHERE id = ? AND owner_account_id = ?')
    .bind(inviteHash, groupId, ownerAccountId)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new MotherStoreError('NOT_OWNER', '只有组长可以重置邀请码');
  }
}

export async function leaveGroup(
  db: D1Database,
  groupId: string,
  accountId: string,
): Promise<void> {
  const result = await db
    .prepare('DELETE FROM mother_group_members WHERE group_id = ? AND account_id = ?')
    .bind(groupId, accountId)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new MotherStoreError('NOT_MEMBER', '不是该组成员');
  }
}

export async function dissolveGroup(
  db: D1Database,
  groupId: string,
  ownerAccountId: string,
): Promise<void> {
  const result = await db
    .prepare('DELETE FROM mother_groups WHERE id = ? AND owner_account_id = ?')
    .bind(groupId, ownerAccountId)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new MotherStoreError('NOT_OWNER', '只有组长可以解散小组');
  }
}

/**
 * 组详情：一个 `batch()` 读取组、成员与账号摘要，避免读到「成员版本已是新的、
 * 账号列表还是旧的」这种半更新状态。
 */
export async function readMotherGroup(
  db: D1Database,
  groupId: string,
): Promise<MotherGroupDetail | null> {
  const [groupResult, memberResult, accountResult] = await db.batch([
    db
      .prepare('SELECT id, name, owner_account_id, created_at FROM mother_groups WHERE id = ?')
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
  ]);

  const groupRow = groupResult.results[0] as GroupRow | undefined;
  if (!groupRow) return null;

  const accountsByMember = new Map<string, SharedMotherAccount[]>();
  for (const row of accountResult.results as AccountRow[]) {
    const ids = parseStoredIds(row.egg_game_ids);
    const list = accountsByMember.get(row.member_account_id) ?? [];
    list.push({
      accountKey: row.game_account_key,
      accountName: row.account_name,
      sourceExportedAt: row.source_exported_at,
      eggGameIds: ids,
    });
    accountsByMember.set(row.member_account_id, list);
  }

  const members: MotherGroupMember[] = (memberResult.results as MemberRow[]).map((row) => {
    const published =
      row.published_at != null && row.catalog_version != null && row.criteria_id != null;
    return {
      accountId: row.account_id,
      displayName: row.display_name,
      joinedAt: row.joined_at,
      resourceRevision: row.resource_revision,
      resource: published
        ? {
            schemaVersion: MOTHER_RESOURCE_SCHEMA_VERSION,
            criteriaId: row.criteria_id as MotherCriteriaId,
            catalogVersion: row.catalog_version as string,
            accounts: accountsByMember.get(row.account_id) ?? [],
            revision: row.resource_revision,
            publishedAt: row.published_at as number,
          }
        : null,
    };
  });

  return { group: toGroupInfo(groupRow), members };
}

function parseStoredIds(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? canonicalEggGameIds(parsed) : [];
  } catch {
    return [];
  }
}

export interface PublishInput {
  groupId: string;
  accountId: string;
  baseRevision: number;
  resource: MotherResourceDraft;
}

export type PublishResult = MotherApiSuccess<{
  resourceRevision: number;
  publishedAt: number | null;
}>;

/**
 * 原子替换当前成员的摘要。
 *
 * 顺序：先读当前摘要做旧源/同源校验（不通过直接拒绝），再一次性 `batch()`：
 * 1) CAS 更新成员版本并写入本次 `write_token`；
 * 2) 以该 token 为条件删除旧账号；
 * 3) 以该 token 为条件插入新账号。
 * CAS 没命中时后续语句全部无操作；任何插入冲突都会让整批回滚。
 */
export async function publishMemberResource(
  db: D1Database,
  input: PublishInput,
): Promise<PublishResult> {
  const { groupId, accountId, baseRevision, resource } = input;

  const member = await db
    .prepare(
      `SELECT resource_revision, published_at, catalog_version, criteria_id
         FROM mother_group_members
        WHERE group_id = ? AND account_id = ?`,
    )
    .bind(groupId, accountId)
    .first<{
      resource_revision: number;
      published_at: number | null;
      catalog_version: string | null;
      criteria_id: string | null;
    }>();
  if (!member) throw new MotherStoreError('NOT_MEMBER', '不是该组成员');

  if (member.published_at != null) {
    await assertSourceNotStale(db, groupId, accountId, member, resource);
  }

  const now = Date.now();
  const writeToken = crypto.randomUUID();
  const published = resource.accounts.length > 0;

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
        published ? resource.criteriaId : null,
        groupId,
        accountId,
        baseRevision,
      ),
    db
      .prepare(
        `DELETE FROM mother_group_accounts
          WHERE group_id = ? AND member_account_id = ?
            AND EXISTS (SELECT 1 FROM mother_group_members
                         WHERE group_id = ? AND account_id = ? AND write_token = ?)`,
      )
      .bind(groupId, accountId, groupId, accountId, writeToken),
    // 组级资源版本：认领任务与「他人补齐」判断都依赖它（旧组没有配置行时无操作）
    db
      .prepare(
        `UPDATE collection_group_configs
            SET resource_epoch = resource_epoch + 1, updated_at = ?
          WHERE group_id = ?
            AND EXISTS (SELECT 1 FROM mother_group_members
                         WHERE group_id = ? AND account_id = ? AND write_token = ?)`,
      )
      .bind(now, groupId, groupId, accountId, writeToken),
    ...resource.accounts.map((account) =>
      db
        .prepare(
          `INSERT INTO mother_group_accounts
             (group_id, game_account_key, member_account_id, account_name, source_exported_at, egg_game_ids)
           SELECT ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM mother_group_members
                           WHERE group_id = ? AND account_id = ? AND write_token = ?)`,
        )
        .bind(
          groupId,
          account.accountKey,
          accountId,
          account.accountName,
          account.sourceExportedAt,
          JSON.stringify(account.eggGameIds),
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
    if (message.includes('UNIQUE constraint failed: mother_group_accounts')) {
      const holder = await findGameAccountHolder(db, groupId, accountId, resource.accounts);
      throw new MotherStoreError(
        'GAME_ACCOUNT_ALREADY_SHARED',
        holder
          ? `游戏账号已由 ${holder.displayName} 共享，不能重复占用`
          : '游戏账号已被其他组员共享',
      );
    }
    throw error;
  }

  return { ok: true, resourceRevision: baseRevision + 1, publishedAt: published ? now : null };
}

/** 旧源与非同源覆盖的拒绝规则（设计第 5.4 节）。 */
async function assertSourceNotStale(
  db: D1Database,
  groupId: string,
  accountId: string,
  member: { catalog_version: string | null; criteria_id: string | null },
  resource: MotherResourceDraft,
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT game_account_key, source_exported_at, egg_game_ids
         FROM mother_group_accounts
        WHERE group_id = ? AND member_account_id = ?`,
    )
    .bind(groupId, accountId)
    .all<{ game_account_key: string; source_exported_at: string; egg_game_ids: string }>();
  const previous = new Map(results.map((row) => [row.game_account_key, row]));

  for (const account of resource.accounts) {
    const before = previous.get(account.accountKey);
    if (!before) continue;
    const beforeTime = Date.parse(before.source_exported_at);
    const nextTime = Date.parse(account.sourceExportedAt);
    if (nextTime < beforeTime) {
      throw new MotherStoreError(
        'STALE_SOURCE',
        `账号 ${account.accountKey} 的数据比已共享的旧，请先导入更新`,
      );
    }
    if (
      nextTime === beforeTime &&
      member.catalog_version === resource.catalogVersion &&
      member.criteria_id === resource.criteriaId
    ) {
      const beforeIds = parseStoredIds(before.egg_game_ids);
      if (!sameIds(beforeIds, account.eggGameIds)) {
        throw new MotherStoreError(
          'SOURCE_MISMATCH',
          `账号 ${account.accountKey} 在同一份数据上算出了不同覆盖，请重新导入`,
        );
      }
    }
  }
}

const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

async function findGameAccountHolder(
  db: D1Database,
  groupId: string,
  accountId: string,
  accounts: readonly SharedMotherAccount[],
): Promise<{ displayName: string } | null> {
  for (const account of accounts) {
    const row = await db
      .prepare(
        `SELECT m.display_name
           FROM mother_group_accounts a
           JOIN mother_group_members m
             ON m.group_id = a.group_id AND m.account_id = a.member_account_id
          WHERE a.group_id = ? AND a.game_account_key = ? AND a.member_account_id <> ?`,
      )
      .bind(groupId, account.accountKey, accountId)
      .first<{ display_name: string }>();
    if (row) return { displayName: row.display_name };
  }
  return null;
}
