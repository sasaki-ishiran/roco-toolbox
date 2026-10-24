import { useEffect, useMemo, useState } from 'react';
import { buildEggSearchIndex } from '../domain/petFilters';
import { CATALOG_VERSION, eggGroupNames, species } from '../data/catalog';
import { GROUP_TYPE_LABELS, type CollectionGroupType } from '../shared/collectionGroups';
import { CollectionGroupSetup } from './CollectionGroupSetup';
import { useCollectionGroups } from './useCollectionGroups';
import { GroupTargetEditor } from './GroupTargetEditor';
import { MotherGroupMembers } from './MotherGroupMembers';
import { MotherGroupResources } from './MotherGroupResources';
import { MotherResourceEditor } from './MotherResourceEditor';
import { MotherView } from './MotherView';
import { SegmentedControl } from './primitives/SegmentedControl';
import { StudGroupResources } from './StudGroupResources';
import { StudResourceEditor } from './StudResourceEditor';
import { Swap } from './Swap';
import { useCollectionSummary } from './useCollectionSummary';
import { useSnapshots } from './useSnapshots';
import { useDraftLeaveGuard } from './useDraftLeaveGuard';
import {
  readCollectionInviteCode,
  readPendingInviteCode,
  savePendingInviteCode,
} from './collectionGroupStore';

export interface CollectionGroupsProps {
  onGoAccount?: () => void;
  onDraftDirtyChange?: (dirty: boolean) => void;
  /** 从看板 / 收集页直达：类型与目标（目前只用于切到个人求蛋）。 */
  focus?: { groupType?: CollectionGroupType; eggGameId?: number } | null;
}

/**
 * 小组页（二期）：个人求蛋 + 母本组 + 种公组。
 *
 * 个人模式不需要登录，也不会自动上传本机需求；小组模式才要求成员资格。
 * 两种组共用组列表、成员管理与发布交互，但目标、摘要和缺口各自计算，绝不混用。
 */
export function CollectionGroups({ onGoAccount, onDraftDirtyChange, focus }: CollectionGroupsProps) {
  const { snapshots } = useSnapshots();
  const summary = useCollectionSummary();
  const hook = useCollectionGroups({ snapshots, species, catalogVersion: CATALOG_VERSION });
  const { confirmLeave, leaveConfirmation } = useDraftLeaveGuard(hook.draftDirty);
  const [pendingCode, setPendingCode] = useState(() => readPendingInviteCode());
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  const searchIndex = useMemo(() => buildEggSearchIndex(species), []);
  const editing = hook.currentGroupId != null && editingGroupId === hook.currentGroupId;
  const inGroup = hook.pageMode === 'group' && hook.currentGroup != null;

  useEffect(() => {
    onDraftDirtyChange?.(hook.draftDirty);
    return () => onDraftDirtyChange?.(false);
  }, [hook.draftDirty, onDraftDirtyChange]);

  // 直达：目标类型与当前组不符时切到个人模式，由用户决定加入哪个组
  useEffect(() => {
    if (!focus?.groupType) return;
    if (hook.currentGroup?.group.groupType === focus.groupType) return;
    hook.selectPersonal();
    hook.setPersonalType(focus.groupType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.groupType, focus?.eggGameId]);

  const selectGroup = async (groupId: string) => {
    if (groupId === hook.currentGroupId && hook.pageMode === 'group') return;
    if (await confirmLeave()) hook.selectGroup(groupId);
  };

  const ownerName =
    hook.currentGroup?.members.find(
      (member) => member.accountId === hook.currentGroup?.group.ownerAccountId,
    )?.displayName ?? '组长';

  return (
    <section className="mx-auto max-w-md space-y-2 p-4" data-testid="collection-groups">
      <GroupSwitcher
        groups={hook.groups}
        currentGroupId={inGroup ? hook.currentGroupId : null}
        pageMode={hook.pageMode}
        onSelect={(groupId) => void selectGroup(groupId)}
        onSelectPersonal={() => void (confirmLeave().then((ok) => ok && hook.selectPersonal()))}
      />

      {hook.error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600" data-testid="group-error">
          {hook.error}
          <button
            type="button"
            onClick={() => void hook.refresh()}
            data-testid="group-error-retry"
            className="ml-2 underline"
          >
            重试
          </button>
          <button type="button" onClick={hook.clearError} className="ml-2 underline">
            知道了
          </button>
        </p>
      ) : null}

      {inGroup && hook.currentGroup ? (
        <>
          <div className="rounded-2xl bg-white p-3 shadow-sm" data-testid="group-card">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                      hook.groupType === 'stud'
                        ? 'bg-sky-50 text-sky-700'
                        : 'bg-emerald-50 text-emerald-700'
                    }`}
                    data-testid="group-type-label"
                  >
                    {hook.groupType ? GROUP_TYPE_LABELS[hook.groupType] : ''}
                  </span>
                  <h2 className="truncate text-base font-semibold text-slate-800">
                    {hook.currentGroup.group.name}
                  </h2>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {hook.currentGroup.members.length} 人 · 组长 {ownerName} · 按已共享账号汇总
                </p>
              </div>
              <button
                type="button"
                onClick={() => void hook.refresh()}
                className="min-h-[30px] shrink-0 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-500"
                data-testid="group-refresh"
              >
                刷新
              </button>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400" data-testid="group-sync-status">
              {hook.offline
                ? '离线，显示上次获取的数据'
                : hook.nextPollAt
                  ? '已触发限流，稍后自动重试'
                  : hook.loading
                    ? '正在更新小组数据…'
                    : '每 15 秒自动更新'}
            </p>
          </div>

          <GroupTargetEditor hook={hook} />

          <PublicationCard
            hook={hook}
            editing={editing}
            onToggle={() => setEditingGroupId(editing ? null : hook.currentGroupId)}
            onGoAccount={onGoAccount}
            snapshots={snapshots}
          />

          {editing ? (
            hook.groupType === 'stud' ? (
              <StudResourceEditor
                key={`stud-editor:${hook.currentGroup.group.id}:${hook.accountId}`}
                hook={hook}
                snapshots={snapshots}
                species={species}
                onGoAccount={onGoAccount}
              />
            ) : (
              <MotherResourceEditor
                key={`mother-editor:${hook.currentGroup.group.id}:${hook.accountId}`}
                hook={hook as never}
                snapshots={snapshots}
                species={species}
                onGoAccount={onGoAccount}
                criteria={
                  hook.target?.kind === 'mother'
                    ? {
                        bodies: hook.target.bodies as never,
                        voices: hook.target.voices as never,
                      }
                    : undefined
                }
                criteriaLabel={
                  hook.target?.kind === 'mother'
                    ? `母 · ${hook.target.bodies.join('/')} · ${hook.target.voices.join('/')}`
                    : undefined
                }
              />
            )
          ) : null}

          {hook.groupType === 'stud' ? (
            <StudGroupResources
              key={`stud-resources:${hook.currentGroup.group.id}:${hook.accountId}`}
              group={hook.currentGroup}
              viewerAccountId={hook.accountId ?? ''}
              catalogVersion={CATALOG_VERSION}
              tasks={hook.tasks}
              tasksConfirmed={hook.tasksConfirmed}
              tasksPendingMemberIds={hook.tasksPendingMemberIds}
              isOwner={hook.currentGroup.group.ownerAccountId === hook.accountId}
              onClaimTask={hook.claimTask}
              onReleaseTask={hook.releaseTask}
              onTransferTask={hook.transferTask}
            />
          ) : (
            <MotherGroupResources
              key={`mother-resources:${hook.currentGroup.group.id}:${hook.accountId}`}
              group={hook.currentGroup}
              viewerAccountId={hook.accountId ?? ''}
              species={species}
              catalogVersion={CATALOG_VERSION}
              criteriaId={
                hook.target?.kind === 'mother' ? hook.target.criteriaId : undefined
              }
              tasks={hook.tasks}
              tasksConfirmed={hook.tasksConfirmed}
              tasksPendingMemberIds={hook.tasksPendingMemberIds}
              isOwner={hook.currentGroup.group.ownerAccountId === hook.accountId}
              onClaimTask={hook.claimTask}
              onReleaseTask={hook.releaseTask}
              onTransferTask={hook.transferTask}
            />
          )}

          <MotherGroupMembers
            key={`members:${hook.currentGroup.group.id}:${hook.accountId}`}
            group={hook.currentGroup}
            accountId={hook.accountId ?? ''}
            catalogVersion={CATALOG_VERSION}
            inviteCode={
              hook.accountId ? readCollectionInviteCode(hook.accountId, hook.currentGroup.group.id) : null
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
      ) : (
        <PersonalEggs
          type={hook.personalType}
          onTypeChange={hook.setPersonalType}
          summary={summary}
          searchIndex={searchIndex}
          onGoImport={onGoAccount}
          eggGameId={focus?.eggGameId}
        />
      )}

      {hook.currentGroupId && !hook.currentGroup && hook.loading ? (
        <p className="px-1 text-xs text-slate-400" data-testid="group-loading">正在读取小组资源…</p>
      ) : null}

      {hook.accountId && hook.pageMode === 'group' && !hook.currentGroupId && !hook.groupsLoaded ? (
        hook.loading ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500" data-testid="group-groups-loading">
            正在读取你加入的小组…
          </p>
        ) : (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            data-testid="group-groups-unavailable"
          >
            暂时读不到你加入的小组（多半是网络问题）。小组还在，恢复网络后点重试即可。
            <button
              type="button"
              onClick={() => void hook.refresh()}
              data-testid="group-groups-retry"
              className="mt-1.5 block min-h-[30px] rounded-lg border border-amber-300 bg-white px-2.5 text-xs text-amber-800"
            >
              重试
            </button>
          </div>
        )
      ) : null}

      {hook.accountId ? (
        <CollectionGroupSetup
          key={hook.accountId}
          onCreate={async (name, displayName, groupType) => {
            if (!(await confirmLeave())) return false;
            return hook.createGroup(name, displayName, groupType);
          }}
          onJoin={async (inviteCode, displayName) => {
            if (!(await confirmLeave())) return false;
            const joined = await hook.joinGroup(inviteCode, displayName);
            savePendingInviteCode('');
            setPendingCode('');
            return joined;
          }}
          preflightInvite={hook.preflightInvite}
          initialInviteCode={pendingCode}
        />
      ) : (
        <div className="rounded-2xl bg-white p-3 shadow-sm" data-testid="group-login-hint">
          <p className="text-xs text-slate-500">
            个人求蛋不需要登录；加入小组、共享资源和成员管理才需要识别「同一个人」。
          </p>
          <button
            type="button"
            onClick={onGoAccount}
            data-testid="group-login"
            className="mt-2 min-h-[36px] w-full rounded-lg bg-emerald-600 text-sm font-medium text-white"
          >
            去登录 / 开启云同步
          </button>
          <input
            value={pendingCode}
            onChange={(event) => {
              const next = event.target.value.toUpperCase();
              setPendingCode(next);
              savePendingInviteCode(next);
            }}
            placeholder="已有邀请码？先记在这里"
            maxLength={8}
            data-testid="group-pending-invite"
            className="mt-2 min-h-[32px] w-full rounded-lg border border-slate-200 px-2.5 text-sm uppercase tracking-widest text-slate-700"
          />
        </div>
      )}
      {leaveConfirmation}
    </section>
  );
}

function GroupSwitcher({
  groups,
  currentGroupId,
  pageMode,
  onSelect,
  onSelectPersonal,
}: {
  groups: ReturnType<typeof useCollectionGroups>['groups'];
  currentGroupId: string | null;
  pageMode: 'personal' | 'group';
  onSelect: (groupId: string) => void;
  onSelectPersonal: () => void;
}) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm" data-testid="group-list">
      <h2 className="text-xs font-medium text-slate-500">收集范围</h2>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onSelectPersonal}
          aria-pressed={pageMode === 'personal'}
          data-testid="group-personal"
          className={`min-h-[28px] rounded-md border px-2 text-xs ${
            pageMode === 'personal'
              ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
              : 'border-slate-200 bg-white text-slate-500'
          }`}
        >
          个人求蛋
        </button>
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => onSelect(group.id)}
            aria-pressed={group.id === currentGroupId}
            data-testid={`group-chip-${group.id}`}
            className={`min-h-[28px] rounded-md border px-2 text-xs ${
              group.id === currentGroupId
                ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                : 'border-slate-200 bg-white text-slate-500'
            }`}
          >
            {GROUP_TYPE_LABELS[group.groupType]} · {group.name} · {group.memberCount} 人
          </button>
        ))}
      </div>
    </div>
  );
}

function PersonalEggs({
  type,
  onTypeChange,
  summary,
  searchIndex,
  onGoImport,
  eggGameId,
}: {
  type: CollectionGroupType;
  onTypeChange: (type: CollectionGroupType) => void;
  summary: ReturnType<typeof useCollectionSummary>;
  searchIndex: Map<string, string>;
  onGoImport?: () => void;
  eggGameId?: number;
}) {
  return (
    <div className="space-y-2" data-testid="personal-eggs">
      <div className="rounded-2xl bg-white p-3 shadow-sm">
        <SegmentedControl
          label="个人求蛋类型"
          value={type}
          options={[
            { value: 'mother', label: '求母本' },
            { value: 'stud', label: '求种公' },
          ]}
          onValueChange={(next) => onTypeChange(next as CollectionGroupType)}
          optionTestId={(value) => `personal-type-${value}`}
        />
        <p className="mt-1 text-[11px] text-slate-400">
          只使用本机数据与个人目标；不要求登录，也不会自动上传给任何小组。
        </p>
        {eggGameId ? (
          <p className="mt-1 text-[11px] text-amber-700" data-testid="personal-focus">
            已定位到蛋血脉 {eggGameId}
          </p>
        ) : null}
      </div>

      {type === 'mother' ? (
        <MotherView
          owned={summary.owned}
          searchIndex={searchIndex}
          eggGroupNames={eggGroupNames}
          motherGroups={summary.motherGroups}
          mode={summary.mode}
          status="missing"
        />
      ) : (
        <Swap embedded onGoImport={onGoImport} />
      )}
    </div>
  );
}

function PublicationCard({
  hook,
  editing,
  onToggle,
  onGoAccount,
  snapshots,
}: {
  hook: ReturnType<typeof useCollectionGroups>;
  editing: boolean;
  onToggle: () => void;
  onGoAccount?: () => void;
  snapshots: ReturnType<typeof useSnapshots>['snapshots'];
}) {
  const mother = hook.myMember?.resource ?? null;
  const stud = hook.myMember?.studResource ?? null;
  const hasLocalData = snapshots.length > 0;
  const status = hook.groupType === 'stud'
    ? stud
      ? '已发布'
      : '未发布'
    : mother
      ? '已发布'
      : '未发布';
  const summary = hook.groupType === 'stud'
    ? stud
      ? `${stud.accounts.length} 个账号 · ${new Set(stud.accounts.flatMap((account) => account.covered.map((slot) => `${slot.groupId}:${slot.natureId}:${slot.grade}`))).size} 个覆盖格`
      : '尚未向本小组发布资源，选号并预览后再手动发布。'
    : mother
      ? `已发布 ${new Set(mother.accounts.flatMap((account) => account.eggGameIds)).size} 种母本 · ${mother.accounts.length} 个账号。`
      : '尚未向本小组发布资源，选号并预览后再手动发布。';

  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="group-publication-status">
      <h2 className="text-sm font-medium text-slate-700">我的共享资源 · {status}</h2>
      <p className="mt-1 text-xs text-slate-500">{summary}</p>
      {!hasLocalData ? (
        <button
          type="button"
          onClick={onGoAccount}
          className="mt-1 min-h-[28px] text-xs font-medium text-emerald-700"
          data-testid="group-go-import"
        >
          去导入数据
        </button>
      ) : null}
      <button
        type="button"
        className="mt-1 min-h-[28px] text-xs font-medium text-emerald-700"
        data-testid="group-edit-resources"
        aria-expanded={editing}
        onClick={onToggle}
      >
        {editing ? '收起选号' : status === '已发布' ? '管理选号' : '选号并发布'}
      </button>
      {hook.draftDirty && !editing ? (
        <p className="mt-1 text-[11px] text-amber-700" data-testid="group-draft-collapsed">
          选号有未发布的修改，点上面的按钮继续编辑。
        </p>
      ) : null}
    </section>
  );
}
