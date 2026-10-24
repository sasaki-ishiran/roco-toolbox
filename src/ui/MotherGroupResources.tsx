import { useEffect, useMemo } from 'react';
import { buildEggSearchIndex } from '../domain/petFilters';
import { buildMotherCoverage, isMotherResourceComparable, selectMotherSharingViews } from '../domain/motherSharing';
import type { SpeciesEntry } from '../domain/types';
import type { MotherCoverageRow, MotherGroupDetail, MotherGroupMember } from '../shared/motherGroups';
import { ensureGroupSession, setGroupList, useGroupList, type GroupListState } from './listViewStore';
import { InlineSelect } from './primitives/InlineSelect';
import { SearchField } from './primitives/SearchField';
import { SegmentedControl } from './primitives/SegmentedControl';
import { StateNotice } from './primitives/StateNotice';

type ViewId = 'missing' | 'help' | 'all';

const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: 'missing', label: '我缺的' },
  { id: 'help', label: '我能补谁' },
  { id: 'all', label: '小组资源' },
];

export interface MotherGroupResourcesProps {
  group: MotherGroupDetail;
  viewerAccountId: string;
  species: SpeciesEntry[];
  catalogVersion: string;
  /** 本组口径；旧组 / 不传时按一期固定口径。 */
  criteriaId?: string;
}

/**
 * 小组资源三视图。
 *
 * 「我缺的」= 我没发布过的目标；组内已有人拥有的排前面。
 * 未发布 / 已停止共享 / 图鉴或口径不兼容的成员是**未知**，不能算成「缺」——
 * 有未知成员时「小组都没有」必须改写成「已发布成员均无，另 N 人待发布/更新」。
 */
export function MotherGroupResources({ group, viewerAccountId, species, catalogVersion, criteriaId }: MotherGroupResourcesProps) {
  // 临时查看状态按「身份 + 小组」隔离：换身份立即清空，切组不串条件（2026-10-24）
  const list = useGroupList(viewerAccountId, group.group.id);
  const setList = (patch: Partial<GroupListState>) =>
    setGroupList(viewerAccountId, group.group.id, patch);
  const { view, query, memberFilter, onlyOwned } = list;

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

  const sourceNames = (row: MotherCoverageRow, memberId: string): string => {
    const member = memberById.get(memberId);
    if (!member?.resource) return '';
    const holder = row.holders.find((item) => item.accountId === memberId);
    if (!holder) return '';
    return holder.accountKeys
      .map((key) => member.resource?.accounts.find((account) => account.accountKey === key)?.accountName ?? key)
      .join('、');
  };

  const currentRows =
    view === 'missing'
      ? views.missingForMe
      : view === 'help'
        ? views.mineForOthers
        : views.all;

  const filtered = (currentRows ?? []).filter((row) => {
    if (onlyOwned && row.holders.length === 0) return false;
    if (memberFilter) {
      const related = view === 'help'
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
        const name = member ? labelOf(member) : holder.accountId.slice(0, 6);
        const sources = sourceNames(row, holder.accountId);
        return sources ? `${name}（${sources}）` : name;
      })
      .join('、');

  const missingText = (row: MotherCoverageRow): string =>
    row.missingMemberIds
      .map((id) => {
        const member = memberById.get(id);
        return member ? labelOf(member) : id.slice(0, 6);
      })
      .join('、');

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
        value={view}
        options={VIEWS.map((item) => ({ value: item.id, label: item.label }))}
        onValueChange={(next) => setList({ view: next as ViewId })}
        optionTestId={(value) => `mother-view-${value}`}
      />

      {currentRows === null ? (
        <StateNotice
          kind="incomparable"
          title="不能计算我的缺口"
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
            <p className="py-4 text-center text-xs text-slate-400">这一页没有条目</p>
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
            </li>
          ))}
        </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
