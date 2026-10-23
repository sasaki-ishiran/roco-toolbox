import { useEffect, useMemo, useRef, useState } from 'react';
import { buildEggSearchIndex } from '../domain/petFilters';
import { buildMotherCoverage, isMotherResourceComparable, selectMotherSharingViews } from '../domain/motherSharing';
import type { SpeciesEntry } from '../domain/types';
import type { MotherCoverageRow, MotherGroupDetail, MotherGroupMember } from '../shared/motherGroups';

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
}

/**
 * 小组资源三视图。
 *
 * 「我缺的」= 我没发布过的目标；组内已有人拥有的排前面。
 * 未发布 / 已停止共享 / 图鉴或口径不兼容的成员是**未知**，不能算成「缺」——
 * 有未知成员时「小组都没有」必须改写成「已发布成员均无，另 N 人待发布/更新」。
 */
export function MotherGroupResources({ group, viewerAccountId, species, catalogVersion }: MotherGroupResourcesProps) {
  const [view, setView] = useState<ViewId>('missing');
  const [query, setQuery] = useState('');
  const [memberFilter, setMemberFilter] = useState('');
  const [memberMenuOpen, setMemberMenuOpen] = useState(false);
  const memberMenuRef = useRef<HTMLDivElement>(null);
  const [onlyOwned, setOnlyOwned] = useState(false);

  useEffect(() => {
    if (!memberMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!memberMenuRef.current?.contains(event.target as Node)) setMemberMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMemberMenuOpen(false);
        memberMenuRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [memberMenuOpen]);

  useEffect(() => {
    if (memberFilter && !group.members.some((member) => member.accountId === memberFilter)) {
      setMemberFilter('');
    }
  }, [group.members, memberFilter]);

  const rows = useMemo(
    () => buildMotherCoverage({ species, catalogVersion, members: group.members }),
    [species, catalogVersion, group.members],
  );
  const comparableIds = useMemo(
    () =>
      group.members
        .filter((member) => isMotherResourceComparable(member.resource, catalogVersion))
        .map((member) => member.accountId),
    [group.members, catalogVersion],
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
    <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm" data-testid="mother-resources">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-500">小组资源</h2>
        <span className="text-[11px] text-slate-400" data-testid="mother-criteria">
          一期口径：母 · 大块头 · +100dB
        </span>
      </div>
      <p className="text-[11px] text-slate-400">按已共享账号汇总。未知成员不会算成「缺」。</p>

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
            data-testid={`mother-view-${item.id}`}
            className={`min-h-[34px] flex-1 rounded-lg text-[11px] ${
              view === item.id ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {currentRows === null ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700" data-testid="mother-view-unknown-self">
          我的资源尚未发布，或者图鉴/口径与当前版本不一致 → 不能计算我的缺口。先在下面发布或更新我的资源。
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜母本 / 同血脉名称 / 图鉴号"
          data-testid="mother-search"
          className="min-h-[36px] min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-300"
        />
        <div className="relative min-w-0 max-w-full" ref={memberMenuRef}>
          <button
            type="button"
            aria-expanded={memberMenuOpen}
            aria-label={`筛选成员：${memberById.has(memberFilter) ? labelOf(memberById.get(memberFilter)!) : '全部成员'}`}
            onClick={() => setMemberMenuOpen((open) => !open)}
            data-testid="mother-member-filter"
            className="flex min-h-[36px] max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-normal text-slate-600"
          >
            <span className="truncate">{memberById.has(memberFilter) ? labelOf(memberById.get(memberFilter)!) : '全部成员'}</span>
            <span aria-hidden="true">{memberMenuOpen ? '▲' : '▼'}</span>
          </button>
          {memberMenuOpen ? (
            <div className="absolute right-0 top-full z-20 mt-1 max-h-64 w-max min-w-[128px] max-w-[calc(100vw-4rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg" data-testid="mother-member-options">
              {[{ id: '', label: '全部成员' }, ...group.members.map((member) => ({ id: member.accountId, label: labelOf(member) }))].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={memberFilter === option.id}
                  onClick={() => {
                    setMemberFilter(option.id);
                    setMemberMenuOpen(false);
                    memberMenuRef.current?.querySelector('button')?.focus();
                  }}
                  className={`block min-h-[36px] w-full truncate rounded-lg px-2 py-1.5 text-left text-xs ${memberFilter === option.id ? 'bg-emerald-50 font-medium text-emerald-700' : 'text-slate-600'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-500">
        <input
          type="checkbox"
          checked={onlyOwned}
          onChange={(event) => setOnlyOwned(event.target.checked)}
          data-testid="mother-only-owned"
        />
        只看组内有人拥有
      </label>

      <p className="text-[11px] text-slate-400" data-testid="mother-resource-count">
        当前页 {filtered.length} 项
      </p>

      {filtered.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">这一页没有条目</p>
      ) : (
        <ul className="space-y-1">
          {filtered.map((row) => (
            <li key={row.eggGameId} className="rounded-xl bg-slate-50 px-3 py-2" data-testid="mother-resource-row">
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
    </section>
  );
}
