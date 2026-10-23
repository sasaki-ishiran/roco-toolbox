import { useState } from 'react';
import { CATALOG_VERSION, species } from '../data/catalog';
import { useSnapshots } from './useSnapshots';
import { useMotherGroups } from './useMotherGroups';
import { MotherGroupMembers } from './MotherGroupMembers';
import { MotherGroupResources } from './MotherGroupResources';
import { MotherGroupSetup } from './MotherGroupSetup';
import { MotherResourceEditor } from './MotherResourceEditor';
import {
  readInviteCode,
  readPendingInviteCode,
  savePendingInviteCode,
} from './motherGroupStore';

export interface MotherSharingProps {
  /** 去「导入数据」页的账号面板登录 / 开启云同步 */
  onGoAccount?: () => void;
}

/**
 * 母本共享首页：登录 → 小组 → 我的资源 → 三视图 + 成员。
 *
 * 没有本地导入数据也能进来：登录后可以浏览组里别人发布的资源；
 * 只有发布自己的资源时才要求本机有对应账号快照。
 */
export function MotherSharing({ onGoAccount }: MotherSharingProps = {}) {
  const { snapshots } = useSnapshots();
  const [pendingCode, setPendingCode] = useState(() => readPendingInviteCode());
  const hook = useMotherGroups({ snapshots, species, catalogVersion: CATALOG_VERSION });

  const ownerName =
    hook.currentGroup?.members.find(
      (member) => member.accountId === hook.currentGroup?.group.ownerAccountId,
    )?.displayName ?? '组主';

  return (
    <section className="space-y-3" data-testid="mother-sharing">
      {!hook.accountId ? (
        <div className="rounded-2xl bg-white p-4 shadow-sm" data-testid="mother-sharing-login">
          <h2 className="text-sm font-medium text-slate-500">母本共享 · 先登录</h2>
          <p className="mt-1 text-xs text-slate-500">
            登录只用来识别「同一个人」：同一身份的手机和电脑算同一位成员，不要求在这台设备上导入数据。
          </p>
          <button
            type="button"
            onClick={onGoAccount}
            data-testid="mother-login"
            className="mt-3 min-h-[40px] w-full rounded-xl bg-emerald-600 text-sm font-medium text-white"
          >
            去登录 / 开启云同步
          </button>
          <div className="mt-3 flex gap-2">
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
              className="min-h-[40px] min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm uppercase tracking-widest text-slate-700"
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">登录后仍需你点「加入小组」，不会自动提交。</p>
        </div>
      ) : (
        <>
          <MotherGroupSetup
            key={hook.accountId}
            groups={hook.groups}
            currentGroupId={hook.currentGroupId}
            onSelect={(groupId) => hook.selectGroup(groupId)}
            onCreate={(name, displayName) => hook.createGroup(name, displayName)}
            onJoin={async (inviteCode, displayName) => {
              const groupId = await hook.joinGroup(inviteCode, displayName);
              savePendingInviteCode('');
              setPendingCode('');
              return groupId;
            }}
            initialInviteCode={pendingCode}
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

          {hook.currentGroupId && !hook.currentGroup ? (
            <p className="text-sm text-slate-400" data-testid="mother-loading">
              {hook.loading ? '正在读取小组资源…' : '小组内容暂时读不到，稍后会自动重试'}
            </p>
          ) : null}

          {hook.currentGroup ? (
            <>
              <div className="rounded-2xl bg-white p-4 shadow-sm" data-testid="mother-group-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-slate-800">
                      {hook.currentGroup.group.name}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {hook.currentGroup.members.length} 人 · 组主 {ownerName} · 按已共享账号汇总
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void hook.refresh()}
                    className="min-h-[32px] shrink-0 rounded-full border border-slate-200 px-3 text-[11px] text-slate-500"
                    data-testid="mother-refresh"
                  >
                    刷新
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-400" data-testid="mother-sync-status">
                  {hook.offline
                    ? '离线，显示上次获取的数据'
                    : hook.nextPollAt
                      ? '已触发限流，稍后自动重试'
                      : '每 15 秒自动更新 · 固定口径：母 · 大块头 · +100dB'}
                </p>
              </div>

              <MotherResourceEditor
                key={`editor:${hook.currentGroup.group.id}:${hook.accountId}`}
                hook={hook}
                snapshots={snapshots}
                species={species}
                onGoAccount={onGoAccount}
              />

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
            <div
              className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800"
              data-testid="mother-groups-unavailable"
            >
              暂时读不到你加入的小组（多半是网络问题）。小组还在，恢复网络后点重试即可。
              <button
                type="button"
                onClick={() => void hook.refresh()}
                data-testid="mother-groups-retry"
                className="mt-2 block min-h-[36px] rounded-xl border border-amber-300 bg-white px-3 text-xs text-amber-800"
              >
                重试
              </button>
            </div>
          ) : hook.groupsLoaded && hook.groups.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500" data-testid="mother-no-groups">
              还没有加入任何小组。新建一个小组，或输入组员给你的 8 位邀请码。
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
