import { useEffect, useMemo, useRef, useState } from 'react';
import { buildEggSearchIndex, type TargetMode } from '../domain/petFilters';
import { groupPublicationStatus } from '../domain/collectionPublication';
import { CATALOG_VERSION, eggGroupNames, species } from '../data/catalog';
import {
  GROUP_TYPE_LABELS,
  type CollectionGroupType,
} from '../shared/collectionGroups';
import { motherResourceCriteriaIdOf } from '../shared/motherGroups';
import { useNatureOverrides } from './natureOverrideStore';
import { CollectionGroupSetup } from './CollectionGroupSetup';
import { useCollectionGroups } from './useCollectionGroups';
import { MotherGroupMembers } from './MotherGroupMembers';
import { MotherGroupResources } from './MotherGroupResources';
import { MotherResourceEditor } from './MotherResourceEditor';
import { MotherView } from './MotherView';
import { SegmentedControl } from './primitives/SegmentedControl';
import { Swap } from './Swap';
import { useCollectionSummary } from './useCollectionSummary';
import { useSnapshots } from './useSnapshots';
import { useDraftLeaveGuard } from './useDraftLeaveGuard';
import {
  readCollectionInviteCode,
  readDemandCompletionSeenAt,
  readPendingInviteCode,
  saveDemandCompletionSeenAt,
  savePendingInviteCode,
} from './collectionGroupStore';
import {
  resolveDemandCompletionNotice,
  type DemandCompletionNotice,
} from './demandCompletionNotice';

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
  const personalNatures = useNatureOverrides();
  const hook = useCollectionGroups({ snapshots, species, catalogVersion: CATALOG_VERSION });
  const { confirmLeave, leaveConfirmation } = useDraftLeaveGuard(hook.draftDirty);
  const [pendingCode, setPendingCode] = useState(() => readPendingInviteCode());
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [completionNotice, setCompletionNotice] = useState<DemandCompletionNotice | null>(null);
  const completionGroupId = hook.currentGroup?.group.id ?? null;

  /**
   * 接单方的结单反馈：进入小组页时提示「你承接的 N 单已完成」。
   * 用本机已读水位避免重复提示；第一次见到某组只记水位，不把历史当成新消息。
   */
  useEffect(() => {
    const accountId = hook.accountId;
    const group = hook.currentGroup;
    if (!accountId || !group) {
      setCompletionNotice(null);
      return;
    }
    const seenAt = readDemandCompletionSeenAt(accountId, group.group.id);
    const decision = resolveDemandCompletionNotice(
      hook.demands,
      accountId,
      seenAt,
      (id) => group.members.find((member) => member.accountId === id)?.displayName ?? null,
    );
    // 第一次见到这个组也要留下水位，否则该组的第一条完成单会被当成历史吞掉。
    if (decision.markSeenAt != null) {
      saveDemandCompletionSeenAt(accountId, group.group.id, decision.markSeenAt);
    }
    setCompletionNotice(decision.notice);
  }, [hook.accountId, hook.currentGroup, hook.demands]);

  const dismissCompletionNotice = () => {
    if (completionNotice && hook.accountId && completionGroupId) {
      saveDemandCompletionSeenAt(hook.accountId, completionGroupId, completionNotice.watermark);
    }
    setCompletionNotice(null);
  };

  const searchIndex = useMemo(() => buildEggSearchIndex(species), []);
  /**
   * 小组页一律用**组目标**的模式：已发布的产线就是这个模式算的，
   * 用个人模式会让同组内的产线口径混用（2026-10-29 代码审查 B2-H01/M01）。
   */
  const groupMotherMode: TargetMode =
    hook.target?.kind === 'mother' ? hook.target.mode : 'perfect';
  const motherResourceCriteriaId = motherResourceCriteriaIdOf(groupMotherMode);
  const editing = hook.currentGroupId != null && editingGroupId === hook.currentGroupId;
  const inGroup = hook.pageMode === 'group' && hook.currentGroup != null;
  /** 组模式但详情还没回来：显示加载态，不能先渲染个人求蛋（切组时会闪一屏无关内容）。 */
  const groupLoading = hook.pageMode === 'group' && hook.currentGroup == null && hook.currentGroupId != null;

  useEffect(() => {
    onDraftDirtyChange?.(hook.draftDirty);
    return () => onDraftDirtyChange?.(false);
  }, [hook.draftDirty, onDraftDirtyChange]);

  // 直达：优先进入同类型的组；没有兼容组时才落到个人求蛋。
  // 同一次 focus 只消费一次：依赖 currentGroup 会让详情回来后重跑，把用户手动打开的
  // 收集小组又踢回个人模式（2026-10-29 审查 B6-H01）。
  const appliedFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const type = focus?.groupType;
    if (!type) {
      appliedFocusRef.current = null;
      return;
    }
    const key = `${type}:${focus?.eggGameId ?? ''}`;
    if (appliedFocusRef.current === key) return;
    // 组列表（缓存或接口）还没读到：等它回来再决定，别把 focus 消费成「没有兼容组」。
    // 未登录时不会有任何小组，列表永远不会就绪，直接落到个人求蛋。
    if (hook.accountId != null && !hook.groupsLoaded) return;
    if (hook.currentGroup?.group.groupType === type) {
      appliedFocusRef.current = key;
      return;
    }
    if (hook.pageMode === 'group' && hook.currentGroupId && hook.currentGroup == null) return;
    const compatible = hook.groups.find((group) => group.groupType === type);
    appliedFocusRef.current = key;
    if (compatible) {
      hook.selectGroup(compatible.id, type);
      return;
    }
    hook.selectPersonal();
    hook.setPersonalType(type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.groupType, focus?.eggGameId, hook.groupsLoaded, hook.currentGroup?.group.id]);

  const selectGroup = async (groupId: string) => {
    if (groupId === hook.currentGroupId && hook.pageMode === 'group') return;
    if (await confirmLeave()) hook.selectGroup(groupId);
  };

  const ownerName =
    hook.currentGroup?.members.find(
      (member) => member.accountId === hook.currentGroup?.group.ownerAccountId,
    )?.displayName ?? '组长';

  /** 新建 / 加入小组：个人模式默认展开，已入组时放在成员区下面并默认收起。 */
  const setupNode = (defaultOpen: boolean) => (
    <CollectionGroupSetup
      key={`setup:${hook.pageMode}:${hook.currentGroupId ?? ''}:${hook.accountId}`}
      defaultOpen={defaultOpen}
      onCreate={async (name, displayName, groupType) => {
        if (!(await confirmLeave())) return false;
        // 小组不再设母本口径；共享全部母本/产线，缺口由各自的本地筛选决定。
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
  );

  return (
    <section className="mx-auto max-w-md space-y-2 p-4" data-testid="collection-groups">
      <GroupSwitcher
        groups={hook.groups}
        currentGroupId={hook.pageMode === 'group' ? hook.currentGroupId : null}
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

      {groupLoading ? (
        <div
          className="rounded-2xl bg-white p-4 shadow-sm text-xs text-slate-500"
          data-testid="group-loading"
        >
          正在读取小组资源…
        </div>
      ) : inGroup && hook.currentGroup ? (
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
                  {hook.currentGroup.members.length} 人 · 组长 {ownerName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void hook.refresh()}
                disabled={hook.refreshing}
                className="min-h-[30px] shrink-0 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-500 disabled:opacity-50"
                data-testid="group-refresh"
              >
                {hook.refreshing ? '刷新中…' : '刷新'}
              </button>
            </div>

            <div className="mt-1.5 border-t border-slate-100 pt-1.5">
              <PublicationCard
                hook={hook}
                editing={editing}
                onToggle={() => setEditingGroupId(editing ? null : hook.currentGroupId)}
                onGoAccount={onGoAccount}
                snapshots={snapshots}
              />
            </div>

            {hook.offline || hook.nextPollAt ? (
              <p className="mt-1 text-[10px] text-amber-700" data-testid="group-sync-status">
                {hook.offline ? '离线，显示上次获取的数据' : '已触发限流，稍后自动重试'}
              </p>
            ) : null}
          </div>

          {/* 需求接口失败时不能静默当成「没有需求」：给出错误与重试（2026-10-29 审查 B6-M02）。 */}
          {hook.demandsError ? (
            <p
              className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600"
              data-testid="group-demands-error"
            >
              需求列表暂时读不到：{hook.demandsError}
              <button
                type="button"
                onClick={() => void hook.refreshDemands()}
                data-testid="group-demands-retry"
                className="ml-2 underline"
              >
                重试
              </button>
            </p>
          ) : null}

          {completionNotice ? (
            <div
              className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800"
              data-testid="demand-completion-notice"
            >
              <p className="text-sm font-medium">
                {completionNotice.demanderNames.length > 0
                  ? `${completionNotice.demanderNames.slice(0, 2).join('、')}${
                      completionNotice.demanderNames.length > 2 ? '等' : ''
                    }已确认你承接的 ${completionNotice.count} 单需求`
                  : `你承接的 ${completionNotice.count} 单需求已完成`}
              </p>
              <p className="mt-0.5 text-xs opacity-90">感谢你对小组的贡献</p>
              <button
                type="button"
                onClick={dismissCompletionNotice}
                className="mt-1.5 min-h-[28px] rounded-lg bg-white/70 px-2.5 text-xs text-emerald-800"
                data-testid="demand-completion-dismiss"
              >
                知道了
              </button>
            </div>
          ) : null}

          {editing ? (
            <MotherResourceEditor
              key={`mother-editor:${hook.currentGroup.group.id}:${hook.accountId}`}
              hook={hook as never}
              snapshots={snapshots}
              species={species}
              onGoAccount={onGoAccount}
            />
          ) : null}

          <MotherGroupMembers
            key={`members:${hook.currentGroup.group.id}:${hook.accountId}`}
            group={hook.currentGroup}
            accountId={hook.accountId ?? ''}
            catalogVersion={CATALOG_VERSION}
            groupType={hook.currentGroup.group.groupType}
            targetCriteriaId={motherResourceCriteriaId}
            inviteCode={
              hook.accountId ? readCollectionInviteCode(hook.accountId, hook.currentGroup.group.id) : null
            }
            demands={hook.demands}
            onRename={hook.updateProfile}
            onResetInvite={hook.resetInvite}
            onRemove={hook.removeMember}
            onLeave={async () => {
              await hook.leave();
            }}
            onDissolve={async () => {
              await hook.dissolve();
            }}
          />

          {hook.accountId ? setupNode(false) : null}

          <MotherGroupResources
            key={`mother-resources:${hook.currentGroup.group.id}:${hook.accountId}`}
            group={hook.currentGroup}
            viewerAccountId={hook.accountId ?? ''}
            species={species}
            catalogVersion={CATALOG_VERSION}
            snapshots={snapshots}
            criteriaId={motherResourceCriteriaId}
            target={null}
            recommendations={summary.recommendations}
            targetMode={groupMotherMode}
            natureOverrides={personalNatures}
            studGroupCount={summary.stud.groupCount}
            tasks={hook.tasks}
            tasksConfirmed={hook.tasksConfirmed}
            tasksPendingMemberIds={hook.tasksPendingMemberIds}
            tasksLoading={hook.tasksLoading}
            tasksError={hook.tasksError}
            isOwner={hook.currentGroup.group.ownerAccountId === hook.accountId}
            onClaimTask={hook.claimTask}
            onReleaseTask={hook.releaseTask}
            onTransferTask={hook.transferTask}
            demands={hook.demands}
            onPublishDemand={hook.addDemand}
            onWithdrawDemand={hook.withdrawDemand}
            onClaimDemand={hook.claimDemand}
            onReleaseDemand={hook.releaseDemand}
            onCompleteDemand={hook.completeDemand}
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
        hook.pageMode === 'personal' ? setupNode(true) : null
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
      <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={onSelectPersonal}
          aria-pressed={pageMode === 'personal'}
          data-testid="group-personal"
          className={`min-h-[28px] shrink-0 rounded-md border px-2 text-xs ${
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
            className={`min-h-[28px] shrink-0 rounded-md border px-2 text-xs ${
              group.id === currentGroupId
                ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                : 'border-slate-200 bg-white text-slate-500'
            }`}
          >
            {group.name}
            <span className="ml-1 text-[10px] font-normal text-slate-400">{group.memberCount}</span>
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
  // 「需更新」= 已发布的摘要与当前口径 / 图鉴可比，且和本机重建内容完全一致（2026-10-25 补回）
  const status = groupPublicationStatus({
    type: hook.groupType === 'stud' ? 'stud' : 'mother',
    mother,
    stud,
    target: hook.target,
    targetRevision: hook.currentGroup?.group.targetRevision ?? 0,
    catalogVersion: CATALOG_VERSION,
    unchanged: hook.publishPreview.diff == null || hook.publishPreview.diff.unchanged,
  });
  const summary = hook.groupType === 'stud'
    ? stud
      ? `${stud.accounts.length} 个账号 · ${new Set(stud.accounts.flatMap((account) => account.covered.map((slot) => `${slot.groupId}:${slot.natureId}:${slot.grade}`))).size} 个覆盖格`
      : '尚未向本小组发布资源，选号并预览后再手动发布。'
    : mother
      ? `${new Set(mother.accounts.flatMap((account) => account.eggGameIds)).size} 种母本 · ${mother.accounts.length} 个账号。`
      : '尚未向本小组发布资源，选号并预览后再手动发布。';

  const badgeClass =
    status === '需更新'
      ? 'bg-amber-50 text-amber-700'
      : status === '已发布'
        ? 'bg-emerald-50 text-emerald-700'
        : 'bg-slate-100 text-slate-500';

  return (
    <div data-testid="group-publication-status">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500">我的资源</span>
            <span
              className={`rounded px-1 text-[10px] leading-[1.4] ${badgeClass}`}
              data-testid="group-publication-badge"
            >
              {status}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{summary}</p>
          {status === '需更新' ? (
            <p className="mt-0.5 text-[10px] text-amber-700" data-testid="group-publish-needed">
              本机数据有更新，发布后组员才能看到最新资源。
            </p>
          ) : null}
          {!hasLocalData ? (
            <button
              type="button"
              onClick={onGoAccount}
              className="mt-1 min-h-[24px] text-[11px] font-medium text-emerald-700"
              data-testid="group-go-import"
            >
              去导入数据
            </button>
          ) : null}
          {hook.draftDirty && !editing ? (
            <p className="mt-1 text-[10px] text-amber-700" data-testid="group-draft-collapsed">
              有未发布的修改，点右侧按钮继续编辑。
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="min-h-[28px] shrink-0 rounded-lg border border-emerald-500 px-2 text-[11px] font-medium text-emerald-700"
          data-testid="group-edit-resources"
          aria-expanded={editing}
          onClick={onToggle}
        >
          {editing ? '收起选号' : status === '需更新' ? '去发布更新' : status === '已发布' ? '管理选号' : '选号并发布'}
        </button>
      </div>
    </div>
  );
}
