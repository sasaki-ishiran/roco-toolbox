import { useMemo, useState } from 'react';
import { isMotherResourceComparable } from '../domain/motherSharing';
import { slotKeyOf, type CollectionGroupType, type PublishedStudResource } from '../shared/collectionGroups';
import type { MotherGroupDetail, MotherGroupMember } from '../shared/motherGroups';

const timeText = (ms: number): string => (ms ? new Date(ms).toLocaleDateString() : '—');

export interface MotherGroupMembersProps {
  group: MotherGroupDetail;
  accountId: string;
  catalogVersion: string;
  /** 组类型：种公组的摘要只在 studResource 里，不能按母本摘要判断发布状态。 */
  groupType?: CollectionGroupType;
  /** 本组母本口径；不传时按一期固定口径。 */
  targetCriteriaId?: string;
  inviteCode: string | null;
  onRename: (displayName: string) => Promise<void>;
  onResetInvite: () => Promise<string>;
  onLeave: () => Promise<void>;
  onDissolve: () => Promise<void>;
}

/**
 * 成员面板：谁发布了多少母本、来源账号是什么；组内昵称可改。
 * 组长可以重置邀请码 / 解散；普通成员可以退出（组长退出请用解散）。
 */
export function MotherGroupMembers({
  group,
  accountId,
  catalogVersion,
  groupType = 'mother',
  targetCriteriaId,
  inviteCode,
  onRename,
  onResetInvite,
  onLeave,
  onDissolve,
}: MotherGroupMembersProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [nickname, setNickname] = useState(
    () => group.members.find((member) => member.accountId === accountId)?.displayName ?? '',
  );
  const [newCode, setNewCode] = useState<string | null>(null);

  const isOwner = group.group.ownerAccountId === accountId;
  const shownCode = newCode ?? inviteCode;

  const labels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of group.members) {
      counts.set(member.displayName, (counts.get(member.displayName) ?? 0) + 1);
    }
    return (member: MotherGroupMember): string =>
      (counts.get(member.displayName) ?? 0) > 1
        ? `${member.displayName}·${member.accountId.slice(0, 4)}`
        : member.displayName;
  }, [group.members]);

  const studResourceOf = (member: MotherGroupMember): PublishedStudResource | null =>
    (member as MotherGroupMember & { studResource?: PublishedStudResource | null }).studResource ?? null;

  const studAccountsOf = (member: MotherGroupMember) =>
    studResourceOf(member)?.accounts ?? [];

  const publishedAtOf = (member: MotherGroupMember): number | null => {
    const stud = studResourceOf(member);
    if (groupType === 'stud') return stud?.publishedAt ?? null;
    return member.resource?.publishedAt ?? null;
  };

  const statusOf = (member: MotherGroupMember): string => {
    if (groupType === 'stud') {
      const stud = studResourceOf(member);
      if (!stud) return member.resourceRevision > 0 ? '已停止共享' : '尚未发布';
      const count = new Set(
        stud.accounts.flatMap((account) =>
          [...account.covered, ...account.breedable].map((slot) => slotKeyOf(slot)),
        ),
      ).size;
      return count > 0 ? `已发布 ${count} 格` : '已发布 · 目前无达标种公';
    }
    if (!member.resource) return member.resourceRevision > 0 ? '已停止共享' : '尚未发布';
    if (!isMotherResourceComparable(member.resource, catalogVersion, targetCriteriaId)) return '需更新';
    const count = new Set(member.resource.accounts.flatMap((account) => account.eggGameIds)).size;
    return count > 0 ? `已发布 ${count} 种` : '已发布 · 目前无达标母本';
  };

  const run = async (tag: string, action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(tag);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="mother-members">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-500">成员</h2>
        <span className="text-[11px] text-slate-400">{group.members.length} 人</span>
      </div>

      <ul className="mt-2 space-y-1">
        {group.members.map((member) => (
          <li key={member.accountId} className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setExpanded(expanded === member.accountId ? null : member.accountId)}
                className="min-w-0 flex-1 text-left"
                data-testid="mother-member-row"
              >
                <span className="text-sm text-slate-700">
                  {labels(member)}
                  {member.accountId === group.group.ownerAccountId ? (
                    <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">组长</span>
                  ) : null}
                  {member.accountId === accountId ? (
                    <span className="ml-1 text-[10px] text-slate-400">我</span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {statusOf(member)}
                  {publishedAtOf(member) ? ` · 更新于 ${timeText(publishedAtOf(member) as number)}` : ''}
                </span>
              </button>
              <span className="shrink-0 text-[11px] text-slate-300">{expanded === member.accountId ? '收起' : '展开'}</span>
            </div>
            {expanded === member.accountId ? (
              <ul className="mt-2 space-y-1 border-t border-slate-200 pt-2" data-testid="mother-member-accounts">
                {groupType === 'stud' ? (
                  studAccountsOf(member).length > 0 ? (
                    studAccountsOf(member).map((account) => (
                      <li key={account.accountKey} className="text-[11px] text-slate-500">
                        {account.accountName} · UID {account.accountKey.slice(4)} · 覆盖{' '}
                        {account.covered.length} 格 · 可迭代 {account.breedable.length} 格 · 导出{' '}
                        {timeText(Date.parse(account.sourceExportedAt))}
                      </li>
                    ))
                  ) : (
                    <li className="text-[11px] text-slate-400">没有共享中的游戏账号</li>
                  )
                ) : member.resource && member.resource.accounts.length > 0 ? (
                  member.resource.accounts.map((account) => (
                    <li key={account.accountKey} className="text-[11px] text-slate-500">
                      {account.accountName} · UID {account.accountKey.slice(4)} · 达标{' '}
                      {account.eggGameIds.length} 种 · 导出 {timeText(Date.parse(account.sourceExportedAt))}
                    </li>
                  ))
                ) : (
                  <li className="text-[11px] text-slate-400">没有共享中的游戏账号</li>
                )}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          maxLength={6}
          placeholder="我在组里的昵称（最多 6 个字）"
          data-testid="mother-nickname-input"
          className="min-h-[32px] min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-600"
        />
        <button
          type="button"
          disabled={busy !== '' || nickname.trim().length === 0}
          onClick={() => void run('rename', () => onRename(nickname.trim()), '昵称已更新')}
          data-testid="mother-rename"
          className="min-h-[30px] shrink-0 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-600 disabled:opacity-50"
        >
          改昵称
        </button>
      </div>

      {isOwner ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-[11px] text-slate-400">
            邀请码明文只显示一次；换设备后需要重置才能再次看到。
          </p>
          {shownCode ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-sm tracking-[0.25em] text-slate-700" data-testid="mother-invite-code">
                {shownCode}
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(shownCode);
                  setMessage('已复制邀请码');
                }}
                className="min-h-[28px] rounded-md border border-slate-200 px-2 text-xs text-slate-500"
              >
                复制
              </button>
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500" data-testid="mother-invite-missing">
              本机没有邀请码明文。
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== ''}
              onClick={() =>
                void run(
                  'reset',
                  async () => {
                    const code = await onResetInvite();
                    setNewCode(code);
                  },
                  '已重置邀请码，旧码立即失效',
                )
              }
              data-testid="mother-reset-invite"
              className="min-h-[30px] rounded-lg border border-slate-200 px-2.5 text-xs text-slate-600 disabled:opacity-50"
            >
              {busy === 'reset' ? '重置中…' : '重置邀请码'}
            </button>
            <button
              type="button"
              disabled={busy !== ''}
              onClick={() => {
                if (!window.confirm('解散会删除整个小组和所有共享资源，确定吗？')) return;
                void run('dissolve', onDissolve, '小组已解散');
              }}
              data-testid="mother-dissolve"
              className="min-h-[30px] rounded-lg border border-rose-200 px-2.5 text-xs text-rose-600 disabled:opacity-50"
            >
              {busy === 'dissolve' ? '解散中…' : '解散小组'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy !== ''}
          onClick={() => {
            if (!window.confirm('退出会删除你在本组共享的资源（保留本机数据），确定吗？')) return;
            void run('leave', onLeave, '已退出小组');
          }}
          data-testid="mother-leave"
          className="mt-2 min-h-[30px] rounded-lg border border-rose-200 px-2.5 text-xs text-rose-600 disabled:opacity-50"
        >
          {busy === 'leave' ? '退出中…' : '退出小组'}
        </button>
      )}

      {message ? <p className="mt-2 text-xs text-emerald-700" data-testid="mother-members-message">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-rose-600" data-testid="mother-members-error">{error}</p> : null}
    </section>
  );
}
