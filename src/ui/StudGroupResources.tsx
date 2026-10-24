import { useMemo } from 'react';
import { eggGroupNames } from '../data/catalog';
import {
  buildStudCoverage,
  groupRowsByGroupId,
  isStudMemberComparable,
  selectStudSharingViews,
  type StudSlotRow,
} from '../domain/studSharing';
import { TARGET_MODE_LABELS } from '../domain/petFilters';
import type { CollectionGroupDetail } from '../shared/collectionGroups';
import { setGroupList, useGroupList } from './listViewStore';
import { InlineSelect } from './primitives/InlineSelect';
import { SearchField } from './primitives/SearchField';
import { SegmentedControl } from './primitives/SegmentedControl';
import { StateNotice } from './primitives/StateNotice';

type ViewId = 'missing' | 'all';

const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: 'missing', label: '我缺的' },
  { id: 'all', label: '小组槽位' },
];

export interface StudGroupResourcesProps {
  group: CollectionGroupDetail;
  viewerAccountId: string;
  catalogVersion: string;
}

/**
 * 种公组的槽位覆盖视图：我缺的 / 小组槽位。
 *
 * 「我缺的」= 我没有真实公精灵覆盖的槽位；组内已有人覆盖的排前。
 * 可迭代单独一行展示，不算已覆盖；未知成员（未发布 / 目标修订或图鉴不一致）不计缺口。
 */
export function StudGroupResources({ group, viewerAccountId, catalogVersion }: StudGroupResourcesProps) {
  const target = group.group.target;
  const list = useGroupList(viewerAccountId, group.group.id);
  const setList = (patch: Partial<typeof list>) => setGroupList(viewerAccountId, group.group.id, patch);
  const { view, query, memberFilter } = list;

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

  const currentRows = view === 'missing' ? views.missingForMe : views.all;
  const filtered = (currentRows ?? []).filter((row) => {
    if (memberFilter) {
      const related =
        row.holders.some((holder) => holder.accountId === memberFilter) ||
        row.missingMemberIds.includes(memberFilter) ||
        row.breedableHolders.some((holder) => holder.accountId === memberFilter);
      if (!related) return false;
    }
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    const groupLabel = eggGroupNames[row.groupId] ?? `蛋组${row.groupId}`;
    return `${groupLabel}${row.natureName}${row.grade}`.toLowerCase().includes(keyword);
  });
  const grouped = groupRowsByGroupId(filtered);
  const sourceNames = (row: StudSlotRow, accountId: string): string => {
    const member = memberById.get(accountId);
    const holder =
      row.holders.find((item) => item.accountId === accountId) ??
      row.breedableHolders.find((item) => item.accountId === accountId);
    if (!member || !holder) return '';
    return holder.accountKeys
      .map(
        (key) =>
          member.studResource?.accounts.find((account) => account.accountKey === key)?.accountName ??
          key,
      )
      .join('、');
  };
  const holderText = (row: StudSlotRow): string =>
    row.holders
      .map((holder) => {
        const sources = sourceNames(row, holder.accountId);
        return sources ? `${labelOf(holder.accountId)}（${sources}）` : labelOf(holder.accountId);
      })
      .join('、');
  const breedableText = (row: StudSlotRow): string =>
    row.breedableHolders
      .map((holder) => {
        const sources = sourceNames(row, holder.accountId);
        return sources ? `${labelOf(holder.accountId)}（${sources}）` : labelOf(holder.accountId);
      })
      .join('、');

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
        value={view}
        options={VIEWS.map((item) => ({ value: item.id, label: item.label }))}
        onValueChange={(next) => setList({ view: next as ViewId })}
        optionTestId={(value) => `stud-slot-view-${value}`}
      />

      {currentRows === null ? (
        <StateNotice
          kind="incomparable"
          title="不能计算我的缺口"
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
      </div>

      {currentRows !== null ? (
        <>
          <p className="text-[11px] text-slate-400" data-testid="stud-resource-count">
            当前页 {filtered.length} 项
          </p>
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">这一页没有条目</p>
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
