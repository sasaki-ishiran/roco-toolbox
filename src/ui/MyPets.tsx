import { useMemo } from 'react';
import {
  buildChainSearchIndex,
  buildTagIndex,
  chainKeyOf,
  computeFacetCounts,
  filterByTags,
} from '../domain/petFilters';
import type { OwnedPet } from '../domain/types';
import { speciesDisplayName } from '../domain/speciesName';
import { eggGroupNames, species, targetNaturePool } from '../data/catalog';
import { AccountFilterBar } from './AccountFilterBar';
import { EmptyState } from './EmptyState';
import { PetList } from './PetList';
import { FilterAccordion } from './FilterAccordion';
import { FilterPanel } from './primitives/FilterPanel';
import { SearchField } from './primitives/SearchField';
import { useOwnedPets } from './useOwnedPets';
import {
  clearInventoryFilters,
  setMyPetsFiltersOpen,
  setMyPetsSelected,
  useMyPetsFilters,
} from './myPetsFilterStore';
import { setPersonalQuery, usePersonalList } from './listViewStore';

/** 「全部」页筛选维度顺序（2026-10-05 用户拍板：第一行 性别/体型/声音，第二行 性格/蛋组/稀有度） */
const FILTER_DIMENSIONS: Array<{ kind: string; label: string }> = [
  { kind: 'gender', label: '性别' },
  { kind: 'body', label: '体型' },
  { kind: 'voice', label: '声音' },
  { kind: 'nature', label: '性格' },
  { kind: 'eggGroup', label: '蛋组' },
  { kind: 'shiny', label: '稀有度' },
];

/** 体型四个选项的展示顺序（2026-10-29）：奖牌两档在前，身高两档在后 */
const BODY_TAG_ORDER = ['大块头', '小不点', '满身高', '零身高'];
const sortBodyFirst = <T extends { label: string }>(tags: T[]): T[] =>
  [...tags].sort((a, b) => {
    const ia = BODY_TAG_ORDER.indexOf(a.label);
    const ib = BODY_TAG_ORDER.indexOf(b.label);
    if (ia === -1 && ib === -1) return a.label.localeCompare(b.label);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

/** 性格选项：八大性格排前面，其余性格在后（2026-10-05 用户拍板） */
const NATURE_POOL_ORDER = new Map(targetNaturePool.map((entry, index) => [entry.name, index]));
const sortNaturePoolFirst = <T extends { id: string; label: string }>(tags: T[]): T[] =>
  [...tags].sort((a, b) => {
    const ia = NATURE_POOL_ORDER.get(a.label);
    const ib = NATURE_POOL_ORDER.get(b.label);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return a.id.localeCompare(b.id);
  });

export interface MyPetsProps {
  /** 空数据时「去导入数据」按钮的跳转 */
  onGoImport?: () => void;
}

/**
 * 精灵背包（原「我的精灵」）：只放**全部精灵**。
 *
 * 2026-10-29 用户口径：「合格种公」视图不要了——挑种公去「收集 · 种公」看种公阵列；
 * 母本去看「收集 · 母本」。这里不再有视角切换。
 */
export function MyPets({ onGoImport }: MyPetsProps) {
  const { owned, accounts } = useOwnedPets();
  // 筛选状态提升到模块级 store：切页签 / 切视角都不丢（2026-10-04 用户拍板）
  const { selected, filtersOpen } = useMyPetsFilters();
  // 搜索是本次会话的临时查看条件（切页保留、重启清空），放 listViewStore
  const nameQuery = usePersonalList('inventory-all').query;
  const setNameQuery = (value: string) => setPersonalQuery('inventory-all', value);

  const speciesByGameId = useMemo(() => new Map(species.map((s) => [s.gameId, s])), []);
  // 进化链搜索索引：搜链上任一成员名/图鉴号 → 命中整条链（火花→焰火/火神）
  const chainSearchIndex = useMemo(() => buildChainSearchIndex(species), []);
  /** 该精灵是否命中搜索词（按进化链全员匹配，图鉴未收录时退回抓包原名） */
  const petMatchesQuery = (pet: OwnedPet, query: string): boolean => {
    const entry = speciesByGameId.get(pet.gameId);
    const text =
      chainSearchIndex.get(chainKeyOf(entry, pet.gameId)) ??
      speciesDisplayName(entry, pet.name).toLowerCase();
    return text.includes(query);
  };
  const { tags, index } = useMemo(
    () => buildTagIndex(owned, speciesByGameId, eggGroupNames),
    [owned, speciesByGameId],
  );
  // 账号筛选交给页面顶部的 AccountFilterBar，下方筛选面板不再重复展示账号标签
  // （2026-10-05 用户拍板去冗余）
  const displayTags = useMemo(() => tags.filter((tag) => tag.kind !== 'account'), [tags]);

  const filteredIndices = useMemo(() => {
    if (selected.size === 0) return owned.map((_, i) => i);
    return filterByTags(index, [...selected]);
  }, [selected, index, owned]);

  // 动态标签数量：按"其他类别已选条件"重新计算每个标签能筛出多少只
  const facetCounts = useMemo(
    () => computeFacetCounts(index, [...selected].filter((id) => !id.startsWith('account:'))),
    [index, selected],
  );

  // 名称搜索 + 标签筛选的最终结果（搜索不持久化；按进化链全员匹配）
  const visiblePets = useMemo(() => {
    const list = filteredIndices.map((i) => owned[i]);
    const query = nameQuery.trim().toLowerCase();
    if (!query) return list;
    return list.filter((pet) => petMatchesQuery(pet, query));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredIndices, owned, nameQuery, speciesByGameId, chainSearchIndex]);

  const toggle = (tagId: string) => {
    const next = new Set(selected);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    setMyPetsSelected(next);
  };

  // 完全没数据才早退；账号筛选全取消导致 owned 为空时，保留页面与顶部账号筛选条
  // （2026-10-05 用户反馈：全取消后控件会消失）
  if (accounts.length === 0) {
    return (
      <main className="mx-auto max-w-md p-4">
        <EmptyState onGoImport={onGoImport} />
      </main>
    );
  }

  const selectedLabels = displayTags.filter((tag) => selected.has(tag.id)).map((tag) => tag.label);

  return (
    <main className="mx-auto max-w-md space-y-1 px-4 pb-4 pt-0.5">
      <AccountFilterBar accounts={accounts} />

      {/* 搜索常显、独立于高级筛选（2026-10-24 统一控件） */}
      <SearchField
        label="搜索精灵名"
        value={nameQuery}
        onValueChange={setNameQuery}
        placeholder="搜索精灵名"
        testId="pet-name-search"
      />
      <FilterPanel
        title={`筛选${selected.size > 0 ? `（${selected.size}）` : ''}`}
        dense
        open={filtersOpen}
        onOpenChange={setMyPetsFiltersOpen}
        onClear={() => {
          clearInventoryFilters();
          setNameQuery('');
        }}
        clearLabel={`重置${selected.size > 0 ? `（${selected.size}）` : ''}`}
        testId="pet-filters"
        toggleTestId="pet-filters-toggle"
        clearTestId="pet-filters-reset"
        summary={selectedLabels.length > 0 ? `已选：${selectedLabels.join('、')}` : undefined}
        summaryTestId="pet-filters-selected"
      >
        <FilterAccordion
          dimensions={FILTER_DIMENSIONS.filter(({ kind }) =>
            displayTags.some((tag) => tag.kind === kind),
          ).map(({ kind, label }) => {
            const rowTags =
              kind === 'nature'
                ? sortNaturePoolFirst(displayTags.filter((tag) => tag.kind === kind))
                : kind === 'body'
                  ? sortBodyFirst(displayTags.filter((tag) => tag.kind === kind))
                  : displayTags.filter((tag) => tag.kind === kind);
            return {
              id: kind,
              label,
              options: rowTags.map((tag) => ({
                value: tag.id,
                label: `${tag.label} (${facetCounts[tag.id] ?? 0})`,
                disabled: (facetCounts[tag.id] ?? 0) === 0,
              })),
              selected: rowTags.filter((tag) => selected.has(tag.id)).map((tag) => tag.id),
              onToggle: (id) => toggle(id),
              onClear: () =>
                setMyPetsSelected(
                  new Set([...selected].filter((id) => !id.startsWith(`${kind}:`))),
                ),
            };
          })}
        />
      </FilterPanel>
      {visiblePets.length === 0 ? (
        <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
          没有符合条件的精灵，试试取消部分标签。
        </div>
      ) : (
        <PetList
          pets={visiblePets}
          speciesByGameId={speciesByGameId}
          eggGroupNames={eggGroupNames}
          resetKey={[...selected].sort().join('|') + `|${nameQuery.trim()}`}
        />
      )}
    </main>
  );
}
