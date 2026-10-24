import { useEffect, useState } from 'react';
import { CATALOG_VERSION, species } from '../data/catalog';
import { isMotherResourceComparable } from '../domain/motherSharing';
import { useSnapshots } from './useSnapshots';
import { useMotherGroups } from './useMotherGroups';
import { MotherGroupMembers } from './MotherGroupMembers';
import { MotherGroupResources } from './MotherGroupResources';
import { MotherGroupSetup, MotherGroupSwitcher } from './MotherGroupSetup';
import { MotherResourceEditor } from './MotherResourceEditor';
import { useDraftLeaveGuard } from './useDraftLeaveGuard';
import {
  readInviteCode,
  readPendingInviteCode,
  savePendingInviteCode,
} from './motherGroupStore';

export interface MotherSharingProps {
  /** 去「导入数据」页的账号面板登录 / 开启云同步 */
  onGoAccount?: () => void;
  onDraftDirtyChange?: (dirty: boolean) => void;
}

/**
 * 母本共享首页：登录 → 小组 → 我的资源 → 三视图 + 成员。
 *
 * 没有本地导入数据也能进来：登录后可以浏览组里别人发布的资源；
 * 只有发布自己的资源时才要求本机有对应账号快照。
 */
export function MotherSharing({ onGoAccount, onDraftDirtyChange }: MotherSharingProps = {}) {
  const { snapshots } = useSnapshots();
  const [pendingCode, setPendingCode] = useState(() => readPendingInviteCode());
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const hook = useMotherGroups({ snapshots, species, catalogVersion: CATALOG_VERSION });
  const { confirmLeave, leaveConfirmation } = useDraftLeaveGuard(hook.draftDirty);
  const published = hook.myMember?.resource;
  const needsUpdate = published != null && (
    !isMotherResourceComparable(published, CATALOG_VERSION) ||
    (hook.publishPreview.diff != null && !hook.publishPreview.diff.unchanged)
  );
  const publicationStatus = !published ? '未发布' : needsUpdate ? '需更新' : '已发布';
  const editing = hook.currentGroupId != null && editingGroupId === hook.currentGroupId;

  useEffect(() => {
    onDraftDirtyChange?.(hook.draftDirty);
    return () => onDraftDirtyChange?.(false);
  }, [hook.draftDirty, onDraftDirtyChange]);

  const selectGroup = async (groupId: string) => {
    if (groupId === hook.currentGroupId) return;
    if (await confirmLeave()) hook.selectGroup(groupId);
  };

  const ownerName =
    hook.currentGroup?.members.find(
      (member) => member.accountId === hook.currentGroup?.group.ownerAccountId,
    )?.displayName ?? '组长';

  return (
    <section className="space-y-2" data-testid="mother-sharing">
      {!hook.accountId ? (
        <div className="rounded-2xl bg-white p-3 shadow-sm" data-testid="mother-sharing-login">
          <h2 className="text-sm font-medium text-slate-500">母本共享 · 先登录</h2>
          <p className="mt-1 text-xs text-slate-500">
            登录只用来识别「同一个人」：同一身份的手机和电脑算同一位成员，不要求在这台设备上导入数据。
          </p>
          <button
            type="button"
            onClick={onGoAccount}
            data-testid="mother-login"
            className="mt-2 min-h-[36px] w-full rounded-lg bg-emerald-600 text-sm font-medium text-white"
          >
            去登录 / 开启云同步
          </button>
          <div className="mt-2 flex gap-2">
            <input
              value={pendingCode}
              onChange={(event) => {
                const next = event.target.value.toUpperCase();
                setPendingCode(next);
                savePendingInviteCode(next);
              }}
              placeholder="已有邀请码？先记在这里"
              maxLength={8}
              data-testid="mother-pending-invite"
              className="min-h-[32px] min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 text-sm uppercase tracking-widest text-slate-700"
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">登录后仍需你点「加入小组」，不会自动提交。</p>
        </div>
      ) : (
        <>
          <MotherGroupSwitcher
            groups={hook.groups}
            currentGroupId={hook.currentGroupId}
            onSelect={(groupId) => void selectGroup(groupId)}
          />

          {hook.error ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600" data-testid="mother-error">
              {hook.error}
              <button
                type="button"
                onClick={() => void hook.refresh()}
                data-testid="mother-error-retry"
                className="ml-2 underline"
              >
                重试
              </button>
              <button type="button" onClick={hook.clearError} className="ml-2 underline">
                知道了
              </button>
            </p>
          ) : null}

          {hook.currentGroupId && !hook.currentGroup && hook.loading ? (
            <p className="px-1 text-xs text-slate-400" data-testid="mother-loading">
              正在读取小组资源…
            </p>
          ) : null}

          {hook.currentGroup ? (
            <>
              <div className="rounded-2xl bg-white p-3 shadow-sm" data-testid="mother-group-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-slate-800">
                      {hook.currentGroup.group.name}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {hook.currentGroup.members.length} 人 · 组长 {ownerName} · 按已共享账号汇总
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void hook.refresh()}
                    className="min-h-[30px] shrink-0 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-500"
                    data-testid="mother-refresh"
                  >
                    刷新
                  </button>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400" data-testid="mother-sync-status">
                  {hook.offline
                    ? '离线，显示上次获取的数据'
                    : hook.nextPollAt
                      ? '已触发限流，稍后自动重试'
                      : hook.loading
                        ? '正在更新小组数据…'
                        : '每 15 秒自动更新'}
                </p>
              </div>

              <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="mother-publication-status">
                <h2 className="text-sm font-medium text-slate-700">我的共享资源 · {publicationStatus}</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {published
                    ? `已发布 ${new Set(published.accounts.flatMap((account) => account.eggGameIds)).size} 种母本 · ${published.accounts.length} 个账号。${needsUpdate ? '发布更新后，组员才能看到最新资源。' : '导入和私有同步不会自动更新小组资源。'}`
                    : '尚未向本小组发布资源，选号并预览后再手动发布。'}
                </p>
                <button
                  type="button"
                  className="mt-1 min-h-[28px] text-xs font-medium text-emerald-700"
                  data-testid="mother-edit-resources"
                  aria-expanded={editing}
                  onClick={() => setEditingGroupId(editing ? null : hook.currentGroupId)}
                >
                  {editing
                    ? '收起选号'
                    : !published
                      ? '选号并发布'
                      : needsUpdate
                        ? '查看并更新资源'
                        : '管理选号'}
                </button>
                {hook.draftDirty && !editing ? (
                  <p className="mt-1 text-[11px] text-amber-700" data-testid="mother-draft-collapsed">
                    选号有未发布的修改，点上面的按钮继续编辑。
                  </p>
                ) : null}
              </section>

              {editing ? <MotherResourceEditor
                key={`editor:${hook.currentGroup.group.id}:${hook.accountId}`}
                hook={hook}
                snapshots={snapshots}
                species={species}
                onGoAccount={onGoAccount}
              /> : null}

              <MotherGroupResources
                key={`resources:${hook.currentGroup.group.id}:${hook.accountId}`}
                group={hook.currentGroup}
                viewerAccountId={hook.accountId}
                species={species}
                catalogVersion={CATALOG_VERSION}
              />

              <MotherGroupMembers
                key={`${hook.currentGroup.group.id}:${hook.accountId}`}
                group={hook.currentGroup}
                accountId={hook.accountId}
                catalogVersion={CATALOG_VERSION}
                inviteCode={
                  hook.accountId
                    ? readInviteCode(hook.accountId, hook.currentGroup.group.id)
                    : null
                }
                onRename={hook.updateProfile}
                onResetInvite={hook.resetInvite}
                onLeave={async () => {
                  await hook.leave();
                }}
                onDissolve={async () => {
                  await hook.dissolve();
                }}
              />
            </>
          ) : !hook.currentGroupId && !hook.groupsLoaded ? (
            hook.loading ? (
              <p
                className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500"
                data-testid="mother-groups-loading"
              >
                正在读取你加入的小组…
              </p>
            ) : (
              <div
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                data-testid="mother-groups-unavailable"
              >
                暂时读不到你加入的小组（多半是网络问题）。小组还在，恢复网络后点重试即可。
                <button
                  type="button"
                  onClick={() => void hook.refresh()}
                  data-testid="mother-groups-retry"
                  className="mt-1.5 block min-h-[30px] rounded-lg border border-amber-300 bg-white px-2.5 text-xs text-amber-800"
                >
                  重试
                </button>
              </div>
            )
          ) : hook.groupsLoaded && hook.groups.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500" data-testid="mother-no-groups">
              还没有加入任何小组。新建一个小组，或输入组员给你的 8 位邀请码。
            </p>
          ) : null}

          <MotherGroupSetup
            key={hook.accountId}
            onCreate={async (name, displayName) => {
              if (!await confirmLeave()) return false;
              return hook.createGroup(name, displayName);
            }}
            onJoin={async (inviteCode, displayName) => {
              if (!await confirmLeave()) return false;
              const groupId = await hook.joinGroup(inviteCode, displayName);
              savePendingInviteCode('');
              setPendingCode('');
              return groupId;
            }}
            initialInviteCode={pendingCode}
          />
        </>
      )}
      {leaveConfirmation}
    </section>
  );
}
