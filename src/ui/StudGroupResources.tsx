import { useMemo, useState } from 'react';
import { eggGroupNames } from '../data/catalog';
import {
  buildStudCoverage,
  groupRowsByGroupId,
  isStudMemberComparable,
  selectStudSharingViews,
  type StudSlotRow,
} from '../domain/studSharing';
import { TARGET_MODE_LABELS } from '../domain/petFilters';
import type { CollectionGroupDetail, CollectionTaskRecord } from '../shared/collectionGroups';
import { setGroupList, useGroupList } from './listViewStore';
import { InlineSelect } from './primitives/InlineSelect';
import { InlineMultiSelect } from './primitives/InlineMultiSelect';
import { SearchField } from './primitives/SearchField';
import { SegmentedControl } from './primitives/SegmentedControl';
import { StateNotice } from './primitives/StateNotice';

type ViewId = 'missing' | 'mine' | 'seeking';

const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: 'missing', label: '我缺的' },
  { id: 'mine', label: '我能补的' },
  { id: 'seeking', label: '共同寻找' },
];

export interface StudGroupResourcesProps {
  group: CollectionGroupDetail;
  viewerAccountId: string;
  catalogVersion: string;
  tasks?: CollectionTaskRecord[];
  tasksConfirmed?: boolean;
  tasksPendingMemberIds?: string[];
  isOwner?: boolean;
  onClaimTask?: (targetKey: string) => Promise<void>;
  onReleaseTask?: (targetKey: string) => Promise<void>;
  onTransferTask?: (targetKey: string, toAccountId: string) => Promise<void>;
}

/**
 * 种公组的槽位覆盖视图（2026-10-25 与母本组统一）：我缺的 / 我能补的 / 共同寻找。
 *
 * 「我缺的」= 我没有真实公精灵覆盖的槽位；组内已有人覆盖的排前。
 * 「我能补的」= 我有覆盖、组内还有可比成员缺的槽位。
 * 可迭代单独一行展示，不算已覆盖；未知成员（未发布 / 目标修订或图鉴不一致）不计缺口。
 */
export function StudGroupResources({
  group,
  viewerAccountId,
  catalogVersion,
  tasks = [],
  tasksConfirmed = false,
  tasksPendingMemberIds = [],
  isOwner = false,
  onClaimTask,
  onReleaseTask,
  onTransferTask,
}: StudGroupResourcesProps) {
  const target = group.group.target;
  const list = useGroupList(viewerAccountId, group.group.id);
  const setList = (patch: Partial<typeof list>) => setGroupList(viewerAccountId, group.group.id, patch);
  const { view, query, memberFilter, seekingMembers } = list;
  const effectiveView: ViewId = view === 'help' || view === 'all'
    ? 'mine'
    : view === 'mine' || view === 'seeking'
      ? view
      : 'missing';
  const [busyKey, setBusyKey] = useState('');
  const [taskError, setTaskError] = useState('');

  const studTarget = target?.kind === 'stud' ? target : null;
  const rows = useMemo(
    () =>
      studTarget
        ? buildStudCoverage({
            target: studTarget,
            targetRevision: group.group.targetRevision,
            catalogVersion,
            members: group.members,
          })
        : [],
    [studTarget, group.group.targetRevision, catalogVersion, group.members],
  );
  const comparableIds = useMemo(
    () =>
      studTarget
        ? group.members
            .filter((member) =>
              isStudMemberComparable(member, studTarget, group.group.targetRevision, catalogVersion),
            )
            .map((member) => member.accountId)
        : [],
    [group.members, studTarget, group.group.targetRevision, catalogVersion],
  );
  const views = useMemo(
    () => selectStudSharingViews(rows, viewerAccountId, comparableIds),
    [rows, viewerAccountId, comparableIds],
  );

  const memberById = useMemo(
    () => new Map(group.members.map((member) => [member.accountId, member])),
    [group.members],
  );
  const labelOf = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of group.members) {
      counts.set(member.displayName, (counts.get(member.displayName) ?? 0) + 1);
    }
    return (memberId: string): string => {
      const member = memberById.get(memberId);
      if (!member) return memberId.slice(0, 6);
      return (counts.get(member.displayName) ?? 0) > 1
        ? `${member.displayName}·${member.accountId.slice(0, 4)}`
        : member.displayName;
    };
  }, [group.members, memberById]);

  if (!studTarget || studTarget.slots.length === 0) {
    return (
      <StateNotice
        kind="unset-scope"
        title="本组还没有确认目标"
        description="组长确认蛋组、性格与档位后，这里才会出现槽位。"
        testId="stud-resources-pending"
      />
    );
  }

  /**
   * 共同寻找 = 选中的人都缺的槽位（交集），空选择 = 全组成员。
   * 与母本组同一口径：不能因为一个几乎全收集的人就把共同寻找「补齐」。
   */
  const aliveIds = useMemo(
    () => new Set(group.members.map((member) => member.accountId)),
    [group.members],
  );
  const seekingPicked = seekingMembers.filter((id) => aliveIds.has(id));
  const seekingScope = seekingPicked.length > 0
    ? seekingPicked
    : group.members.map((member) => member.accountId);
  const seekingRows = rows.filter((row) =>
    seekingScope.every(
      (id) =>
        row.missingMemberIds.includes(id) ||
        row.unknownMemberIds.includes(id) ||
        row.breedableHolders.some((holder) => holder.accountId === id),
    ),
  );

  const currentRows =
    effectiveView === 'missing'
      ? views.missingForMe
      : effectiveView === 'mine'
        ? views.mineForOthers
        : seekingRows;
  const filtered = (currentRows ?? []).filter((row) => {
    if (memberFilter) {
      // 我缺的：按「谁有」筛；我能补的：按「缺这个槽位的人」筛
      const related =
        effectiveView === 'mine'
          ? row.missingMemberIds.includes(memberFilter)
          : row.holders.some((holder) => holder.accountId === memberFilter);
      if (!related) return false;
    }
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    const groupLabel = eggGroupNames[row.groupId] ?? `蛋组${row.groupId}`;
    return `${groupLabel}${row.natureName}${row.grade}`.toLowerCase().includes(keyword);
  });
  const grouped = groupRowsByGroupId(filtered);
  const holderText = (row: StudSlotRow): string =>
    row.holders.map((holder) => labelOf(holder.accountId)).join('、');
  const breedableText = (row: StudSlotRow): string =>
    row.breedableHolders.map((holder) => labelOf(holder.accountId)).join('、');

  const taskKeyOf = (row: StudSlotRow): string => `stud:${row.key}`;
  const taskOf = (row: StudSlotRow): CollectionTaskRecord | undefined =>
    tasks.find((task) => task.targetKey === taskKeyOf(row));
  const runTask = async (row: StudSlotRow, action: 'claim' | 'release') => {
    const handler = action === 'claim' ? onClaimTask : onReleaseTask;
    if (!handler || busyKey) return;
    const key = taskKeyOf(row);
    setBusyKey(key);
    setTaskError('');
    try {
      await handler(key);
    } catch (failure) {
      setTaskError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
    } finally {
      setBusyKey('');
    }
  };

  const transferTo = async (row: StudSlotRow, toAccountId: string) => {
    if (!onTransferTask || busyKey || !toAccountId) return;
    const key = taskKeyOf(row);
    setBusyKey(key);
    setTaskError('');
    try {
      await onTransferTask(key, toAccountId);
    } catch (failure) {
      setTaskError(failure instanceof Error ? failure.message : '操作失败，请稍后再试');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <section className="space-y-2 rounded-2xl bg-white p-3 shadow-sm" data-testid="stud-resources">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-500">小组槽位</h2>
        <span className="text-[11px] text-slate-400" data-testid="stud-criteria">
          {TARGET_MODE_LABELS[studTarget.mode]} · {studTarget.slots.length} 个槽位
        </span>
      </div>
      <p className="text-[11px] text-slate-400">按已发布账号汇总；可迭代单列，不算已覆盖；未知成员不计缺口。</p>

      <SegmentedControl
        label="种公资源视图"
        value={effectiveView}
        options={VIEWS.map((item) => ({ value: item.id, label: item.label }))}
        onValueChange={(next) => setList({ view: next as ViewId })}
        optionTestId={(value) => `stud-slot-view-${value}`}
      />

      {taskError ? (
        <p className="text-xs text-rose-600" data-testid="stud-task-error">{taskError}</p>
      ) : null}

      {currentRows === null ? (
        <StateNotice
          kind="incomparable"
          title={effectiveView === 'mine' ? '不能计算我能补的' : '不能计算我的缺口'}
          description="我的资源尚未发布，或目标修订/图鉴与当前版本不一致；发布或更新后再看这一页。"
          testId="stud-view-unknown-self"
        />
      ) : null}

      <SearchField
        label="搜索槽位"
        value={query}
        onValueChange={(value) => setList({ query: value })}
        placeholder="搜蛋组 / 性格 / 档位"
        testId="stud-slot-search"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {effectiveView === 'seeking' ? (
          <InlineMultiSelect
            label="共同寻找范围"
            values={seekingMembers}
            options={group.members.map((member) => ({
              value: member.accountId,
              label: labelOf(member.accountId),
            }))}
            onValuesChange={(values) => setList({ seekingMembers: values })}
            allLabel="全组成员"
            testId="stud-seeking-members"
            menuTestId="stud-seeking-member-options"
            optionTestId={(value) => `stud-seeking-member-${value || 'all'}`}
            align="right"
            className="max-w-[168px]"
          />
        ) : (
          <InlineSelect
            label="筛选成员"
            value={memberFilter}
            options={[
              { value: '', label: '全部成员' },
              ...group.members.map((member) => ({ value: member.accountId, label: labelOf(member.accountId) })),
            ]}
            onValueChange={(value) => setList({ memberFilter: value })}
            testId="stud-member-filter"
            menuTestId="stud-member-options"
            align="right"
            className="max-w-[168px]"
          />
        )}
      </div>

      {currentRows !== null ? (
        <>
          <p className="text-[11px] text-slate-400" data-testid="stud-resource-count">
            当前页 {filtered.length} 项
          </p>
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">
              {effectiveView === 'mine'
                ? '组员暂时没有需要你补的槽位'
                : effectiveView === 'seeking'
                  ? '选中的人没有共同缺的槽位'
                  : '这一页没有条目'}
            </p>
          ) : (
            <div className="space-y-2">
              {grouped.map(({ groupId, rows: groupRows }) => (
                <div key={groupId}>
                  <p className="text-[11px] font-medium text-slate-500">
                    {eggGroupNames[groupId] ?? `蛋组${groupId}`}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {groupRows.map((row) => (
                      <li
                        key={row.key}
                        className="min-w-0 break-words rounded-xl bg-slate-50 px-2.5 py-2"
                        data-testid="stud-slot-row"
                      >
                        <p className="text-sm text-slate-700">
                          {row.natureName} · {row.grade}
                          <span className="ml-1 text-[11px] text-slate-400">
                            {groupId}:{row.natureId}
                          </span>
                        </p>
                        {row.holders.length > 0 ? (
                          <p className="mt-0.5 text-[11px] text-emerald-700" data-testid="stud-slot-holders">
                            有：{holderText(row)}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-[11px] text-slate-400" data-testid="stud-slot-none">
                            已发布成员均无
                            {row.unknownMemberIds.length > 0
                              ? `，另 ${row.unknownMemberIds.length} 人待发布/更新`
                              : ''}
                          </p>
                        )}
                        {row.breedableHolders.length > 0 ? (
                          <p className="mt-0.5 text-[11px] text-amber-700" data-testid="stud-slot-breedable">
                            可迭代：{breedableText(row)}
                          </p>
                        ) : null}
                        {row.holders.length > 0 && row.missingMemberIds.length > 0 ? (
                          <p className="mt-0.5 text-[11px] text-slate-400" data-testid="stud-slot-missing">
                            缺：{row.missingMemberIds.map(labelOf).join('、')}
                            {row.unknownMemberIds.length > 0
                              ? `，另 ${row.unknownMemberIds.length} 人待发布/更新`
                              : ''}
                          </p>
                        ) : null}
                        {effectiveView === 'seeking' ? (
                          <div className="mt-1 border-t border-slate-200 pt-1 text-[11px]" data-testid="stud-task">
                            {!tasksConfirmed ? (
                              <span className="text-amber-700">
                                待确认：{tasksPendingMemberIds.length} 人未发布/更新，暂不能认领
                              </span>
                            ) : taskOf(row)?.ownerAccountId ? (
                              <span className="flex flex-wrap items-center gap-1">
                                <span
                                  className={
                                    taskOf(row)?.ownerAccountId === viewerAccountId
                                      ? 'text-emerald-700'
                                      : 'text-slate-500'
                                  }
                                >
                                  {taskOf(row)?.ownerAccountId === viewerAccountId
                                    ? '我认领了'
                                    : `负责人：${labelOf(taskOf(row)?.ownerAccountId ?? '')}`}
                                </span>
                                {taskOf(row)?.ownerAccountId === viewerAccountId || isOwner ? (
                                  <button
                                    type="button"
                                    disabled={busyKey === taskKeyOf(row)}
                                    onClick={() => void runTask(row, 'release')}
                                    data-testid="stud-task-release"
                                    className="min-h-[24px] rounded border border-slate-200 px-1.5 text-slate-500 disabled:opacity-50"
                                  >
                                    释放
                                  </button>
                                ) : null}
                                {isOwner &&
                                onTransferTask &&
                                taskOf(row)?.ownerAccountId !== viewerAccountId ? (
                                  <InlineSelect
                                    label="转交任务"
                                    value=""
                                    options={[
                                      { value: '', label: '转交…' },
                                      ...group.members
                                        .filter(
                                          (member) =>
                                            member.accountId !== taskOf(row)?.ownerAccountId,
                                        )
                                        .map((member) => ({
                                          value: member.accountId,
                                          label: labelOf(member.accountId),
                                        })),
                                    ]}
                                    onValueChange={(to) => void transferTo(row, to)}
                                    testId="stud-task-transfer"
                                    menuTestId="stud-task-transfer-options"
                                    className="max-w-[110px]"
                                  />
                                ) : null}
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={busyKey === taskKeyOf(row)}
                                onClick={() => void runTask(row, 'claim')}
                                data-testid="stud-task-claim"
                                className="min-h-[24px] rounded border border-emerald-500 px-1.5 font-medium text-emerald-700 disabled:opacity-50"
                              >
                                认领寻找
                              </button>
                            )}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
