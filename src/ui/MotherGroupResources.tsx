import { useEffect, useMemo, useState } from 'react';
import { buildEggSearchIndex } from '../domain/petFilters';
import { buildMotherCoverage, isMotherResourceComparable, selectMotherSharingViews } from '../domain/motherSharing';
import type { SpeciesEntry } from '../domain/types';
import type {
  MotherCoverageRow,
  MotherGroupDetail,
  MotherGroupMember,
} from '../shared/motherGroups';
import type { CollectionTaskRecord } from '../shared/collectionGroups';
import { ensureGroupSession, setGroupList, useGroupList, type GroupListState } from './listViewStore';
import { InlineSelect } from './primitives/InlineSelect';
import { SearchField } from './primitives/SearchField';
import { SegmentedControl } from './primitives/SegmentedControl';
import { StateNotice } from './primitives/StateNotice';

type ViewId = 'missing' | 'mine' | 'seeking';

/**
 * 三视图（2026-10-25 用户改口径）：主用途是「看自己缺的 / 给别人孵 / 大家缺的一起认领」，
 * 组整体完成度不重要，所以把原来的「小组资源」换成「我能补的」。
 */
const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: 'missing', label: '我缺的' },
  { id: 'mine', label: '我能补的' },
  { id: 'seeking', label: '共同寻找' },
];

export interface MotherGroupResourcesProps {
  group: MotherGroupDetail;
  viewerAccountId: string;
  species: SpeciesEntry[];
  catalogVersion: string;
  /** 本组口径；旧组 / 不传时按一期固定口径。 */
  criteriaId?: string;
  /** 共同寻找的任务与确认状态；不传时只看资源。 */
  tasks?: CollectionTaskRecord[];
  tasksConfirmed?: boolean;
  tasksPendingMemberIds?: string[];
  isOwner?: boolean;
  onClaimTask?: (targetKey: string) => Promise<void>;
  onReleaseTask?: (targetKey: string) => Promise<void>;
  onTransferTask?: (targetKey: string, toAccountId: string) => Promise<void>;
}

/**
 * 小组资源三视图。
 *
 * 「我缺的」= 我没发布过的目标；组内已有人拥有的排前面。
 * 未发布 / 已停止共享 / 图鉴或口径不兼容的成员是**未知**，不能算成「缺」——
 * 有未知成员时「小组都没有」必须改写成「已发布成员均无，另 N 人待发布/更新」。
 */
export function MotherGroupResources({
  group,
  viewerAccountId,
  species,
  catalogVersion,
  criteriaId,
  tasks = [],
  tasksConfirmed = false,
  tasksPendingMemberIds = [],
  isOwner = false,
  onClaimTask,
  onReleaseTask,
  onTransferTask,
}: MotherGroupResourcesProps) {
  // 临时查看状态按「身份 + 小组」隔离：换身份立即清空，切组不串条件（2026-10-24）
  const list = useGroupList(viewerAccountId, group.group.id);
  const setList = (patch: Partial<GroupListState>) =>
    setGroupList(viewerAccountId, group.group.id, patch);
  const { view, query, memberFilter, onlyOwned } = list;
  // 旧值兼容：`help`（旧的「我能补谁」）与 `all`（旧「小组资源」）都落到「我能补的」
  const effectiveView: ViewId = view === 'help' || view === 'all'
    ? 'mine'
    : view === 'mine' || view === 'seeking'
      ? view
      : 'missing';
  const [busyKey, setBusyKey] = useState('');
  const [taskError, setTaskError] = useState('');

  useEffect(() => {
    ensureGroupSession(viewerAccountId);
  }, [viewerAccountId]);

  useEffect(() => {
    if (memberFilter && !group.members.some((member) => member.accountId === memberFilter)) {
      setList({ memberFilter: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.members, memberFilter]);

  const rows = useMemo(
    () => buildMotherCoverage({ species, catalogVersion, members: group.members, criteriaId }),
    [species, catalogVersion, group.members, criteriaId],
  );
  const comparableIds = useMemo(
    () =>
      group.members
        .filter((member) => isMotherResourceComparable(member.resource, catalogVersion, criteriaId))
        .map((member) => member.accountId),
    [group.members, catalogVersion, criteriaId],
  );
  const views = useMemo(
    () => selectMotherSharingViews(rows, viewerAccountId, comparableIds),
    [rows, viewerAccountId, comparableIds],
  );
  const searchIndex = useMemo(() => buildEggSearchIndex(species), [species]);

  const memberById = useMemo(
    () => new Map(group.members.map((member) => [member.accountId, member])),
    [group.members],
  );
  const labelOf = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of group.members) {
      counts.set(member.displayName, (counts.get(member.displayName) ?? 0) + 1);
    }
    return (member: MotherGroupMember): string =>
      (counts.get(member.displayName) ?? 0) > 1
        ? `${member.displayName}·${member.accountId.slice(0, 4)}`
        : member.displayName;
  }, [group.members]);

  const currentRows =
    effectiveView === 'missing'
      ? views.missingForMe
      : effectiveView === 'mine'
        ? views.mineForOthers
        : rows.filter((row) => row.holders.length === 0);

  const filtered = (currentRows ?? []).filter((row) => {
    if (onlyOwned && row.holders.length === 0) return false;
    if (memberFilter) {
      // 我缺的 / 共同寻找：按「谁有」筛；我能补的：按「缺这只的人」筛
      // （选莱茵 = 看我能补给莱茵哪些，2026-10-25 用户口径）
      const related =
        effectiveView === 'seeking'
          ? row.holders.some((holder) => holder.accountId === memberFilter) ||
            row.missingMemberIds.includes(memberFilter) ||
            row.unknownMemberIds.includes(memberFilter)
          : effectiveView === 'mine'
            ? row.missingMemberIds.includes(memberFilter)
            : row.holders.some((holder) => holder.accountId === memberFilter);
      if (!related) return false;
    }
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return (
      row.name.toLowerCase().includes(keyword) ||
      (searchIndex.get(`egg:${row.eggGameId}`) ?? '').includes(keyword)
    );
  });

  const holderText = (row: MotherCoverageRow): string =>
    row.holders
      .map((holder) => {
        const member = memberById.get(holder.accountId);
        return member ? labelOf(member) : holder.accountId.slice(0, 6);
      })
      .join('、');

  const missingText = (row: MotherCoverageRow): string =>
    row.missingMemberIds
      .map((id) => {
        const member = memberById.get(id);
        return member ? labelOf(member) : id.slice(0, 6);
      })
      .join('、');

  const taskKeyOf = (row: MotherCoverageRow): string => `mother:${row.eggGameId}`;
  const taskOf = (row: MotherCoverageRow): CollectionTaskRecord | undefined =>
    tasks.find((task) => task.targetKey === taskKeyOf(row));
  const nameOf = (accountId: string): string => {
    const member = memberById.get(accountId);
    return member ? labelOf(member) : accountId.slice(0, 6);
  };
  const runTask = async (row: MotherCoverageRow, action: 'claim' | 'release') => {
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

  const transferTo = async (row: MotherCoverageRow, toAccountId: string) => {
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
    <section className="space-y-2 rounded-2xl bg-white p-3 shadow-sm" data-testid="mother-resources">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-500">小组资源</h2>
        <span className="text-[11px] text-slate-400" data-testid="mother-criteria">
          小组口径：母 · 大块头 · +100dB
        </span>
      </div>
      <p className="text-[11px] text-slate-400">按已共享账号汇总，未知成员不计缺口。</p>

      <SegmentedControl
        label="小组资源视图"
        value={effectiveView}
        options={VIEWS.map((item) => ({ value: item.id, label: item.label }))}
        onValueChange={(next) => setList({ view: next as ViewId })}
        optionTestId={(value) => `mother-view-${value}`}
      />

      {taskError ? (
        <p className="text-xs text-rose-600" data-testid="mother-task-error">{taskError}</p>
      ) : null}

      {currentRows === null ? (
        <StateNotice
          kind="incomparable"
          title={effectiveView === 'mine' ? '不能计算我能补的' : '不能计算我的缺口'}
          description="我的资源尚未发布，或图鉴/口径与当前版本不一致；发布或更新后再看这一页。"
          testId="mother-view-unknown-self"
        />
      ) : null}

      <SearchField
        label="搜索小组资源"
        value={query}
        onValueChange={(value) => setList({ query: value })}
        placeholder="搜母本 / 同血脉名称 / 图鉴号"
        testId="mother-search"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={onlyOwned}
            onChange={(event) => setList({ onlyOwned: event.target.checked })}
            data-testid="mother-only-owned"
          />
          只看组内有人拥有
        </label>
        <InlineSelect
          label="筛选成员"
          value={memberFilter}
          options={[
            { value: '', label: '全部成员' },
            ...group.members.map((member) => ({
              value: member.accountId,
              label: labelOf(member),
            })),
          ]}
          onValueChange={(value) => setList({ memberFilter: value })}
          testId="mother-member-filter"
          menuTestId="mother-member-options"
          align="right"
          className="max-w-[168px]"
        />
      </div>

      {/* 不可计算时不再叠一条「当前页 0 项 / 这一页没有条目」的普通空态：那是两种事实 */}
      {currentRows !== null ? (
        <>
          <p className="text-[11px] text-slate-400" data-testid="mother-resource-count">
            当前页 {filtered.length} 项
          </p>

          {filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">
              {effectiveView === 'mine' ? '组员暂时没有需要你补的母本' : '这一页没有条目'}
            </p>
          ) : (
        <ul className="grid grid-cols-2 items-start gap-1.5">
          {filtered.map((row) => (
            <li key={row.eggGameId} className="min-w-0 break-words rounded-xl bg-slate-50 px-2.5 py-2 only:col-span-2" data-testid="mother-resource-row">
              <p className="text-sm text-slate-700">{row.name}</p>
              {row.holders.length > 0 ? (
                <p className="mt-0.5 text-[11px] text-emerald-700" data-testid="mother-resource-holders">
                  有：{holderText(row)}
                </p>
              ) : (
                <p className="mt-0.5 text-[11px] text-slate-400" data-testid="mother-resource-none">
                  已发布成员均无
                  {row.unknownMemberIds.length > 0
                    ? `，另 ${row.unknownMemberIds.length} 人待发布/更新`
                    : ''}
                </p>
              )}
              {row.holders.length > 0 && row.missingMemberIds.length > 0 ? (
                <p className="mt-0.5 text-[11px] text-slate-400" data-testid="mother-resource-missing">
                  缺：{missingText(row)}
                  {row.unknownMemberIds.length > 0
                    ? `，另 ${row.unknownMemberIds.length} 人待发布/更新`
                    : ''}
                </p>
              ) : null}
              {effectiveView === 'seeking' ? (
                <div className="mt-1 border-t border-slate-200 pt-1 text-[11px]" data-testid="mother-task">
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
                          : `负责人：${nameOf(taskOf(row)?.ownerAccountId ?? '')}`}
                      </span>
                      {taskOf(row)?.ownerAccountId === viewerAccountId || isOwner ? (
                        <button
                          type="button"
                          disabled={busyKey === taskKeyOf(row)}
                          onClick={() => void runTask(row, 'release')}
                          data-testid="mother-task-release"
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
                              .filter((member) => member.accountId !== taskOf(row)?.ownerAccountId)
                              .map((member) => ({
                                value: member.accountId,
                                label: labelOf(member),
                              })),
                          ]}
                          onValueChange={(to) => void transferTo(row, to)}
                          testId="mother-task-transfer"
                          menuTestId="mother-task-transfer-options"
                          className="max-w-[110px]"
                        />
                      ) : null}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busyKey === taskKeyOf(row)}
                      onClick={() => void runTask(row, 'claim')}
                      data-testid="mother-task-claim"
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
          )}
        </>
      ) : null}
    </section>
  );
}
