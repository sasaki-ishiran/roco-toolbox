import { useMemo, useState } from 'react';
import {
  buildChainSearchIndex,
  buildEggSearchIndex,
  buildTagIndex,
  chainKeyOf,
  computeFacetCounts,
  filterByTags,
  gradeLabel,
  groupMothersByEgg,
  TARGET_MODE_LABELS,
  type PetView,
} from '../domain/petFilters';
import { ALL_GRADES, ALL_EGG_GROUP_IDS } from '../domain/coverageTargets';
import { isBreedableGroup } from '../domain/eggs';
import type { OwnedPet } from '../domain/types';
import { describeStudTargets } from '../domain/studTargets';
import { speciesDisplayName } from '../domain/speciesName';
import { eggGroupNames, species, targetNaturePool } from '../data/catalog';
import { AccountFilterBar } from './AccountFilterBar';
import { AccountSection } from './AccountSection';
import { EmptyState } from './EmptyState';
import { MotherView } from './MotherView';
import { PetList } from './PetList';
import { FilterAccordion } from './FilterAccordion';
import { useCoverageSlots } from './useCoverageSlots';
import { useOwnedPets } from './useOwnedPets';
import { useTargetMode } from './targetModeStore';
import {
  clearMyPetsFilters,
  setMyPetsFiltersOpen,
  setMyPetsSelected,
  toggleStudGrade,
  toggleStudGroup,
  toggleStudNature,
  useMyPetsFilters,
} from './myPetsFilterStore';

const VIEW_LABELS: Array<{ id: PetView; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'stud', label: '种公' },
  { id: 'mother', label: '母本' },
];

/** 种公视角的性格筛选选项：与覆盖度里可勾选的性格池同一套（八大性格）+ 「其他」 */
const STUD_NATURE_OPTIONS = [
  ...targetNaturePool.map((entry) => entry.name),
  '其他',
];
const STUD_NATURE_NAMES = new Set(targetNaturePool.map((entry) => entry.name));

/** 「全部」页筛选维度顺序（2026-10-05 用户拍板：第一行 性别/体型/声音，第二行 性格/蛋组/稀有度） */
const FILTER_DIMENSIONS: Array<{ kind: string; label: string }> = [
  { kind: 'gender', label: '性别' },
  { kind: 'body', label: '体型' },
  { kind: 'voice', label: '声音' },
  { kind: 'nature', label: '性格' },
  { kind: 'eggGroup', label: '蛋组' },
  { kind: 'shiny', label: '稀有度' },
];

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
  view: PetView;
  onViewChange: (view: PetView) => void;
  /** 空数据时「去导入数据」按钮的跳转 */
  onGoImport?: () => void;
}

export function MyPets({ view, onViewChange, onGoImport }: MyPetsProps) {
  const { owned, accounts } = useOwnedPets();
  const mode = useTargetMode();
  // 筛选状态提升到模块级 store：切页签 / 切视角都不丢（2026-10-04 用户拍板）
  const { selected, filtersOpen, studGrades, studNatures, studGroups } = useMyPetsFilters();
  // 全部页的名称搜索（本地过滤，不持久化）
  const [nameQuery, setNameQuery] = useState('');
  // 种公视角的名称搜索（2026-10-05 用户拍板加入）
  const [studQuery, setStudQuery] = useState('');

  const speciesByGameId = useMemo(() => new Map(species.map((s) => [s.gameId, s])), []);
  // 进化链搜索索引：搜链上任一成员名/图鉴号 → 命中整条链（火花→焰火/火神）
  const chainSearchIndex = useMemo(() => buildChainSearchIndex(species), []);
  // 蛋搜索索引：母本清单按蛋分组，搜任一归属形态（火神/古卷执政官）都要命中那颗蛋
  const eggSearchIndex = useMemo(() => buildEggSearchIndex(species), []);
  /** 该精灵是否命中搜索词（按进化链全员匹配，图鉴未收录时退回抓包原名） */
  const petMatchesQuery = (pet: OwnedPet, query: string): boolean => {
    const entry = speciesByGameId.get(pet.gameId);
    const text =
      chainSearchIndex.get(chainKeyOf(entry, pet.gameId)) ??
      speciesDisplayName(entry, pet.name).toLowerCase();
    return text.includes(query);
  };
  const slots = useCoverageSlots();
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

  const motherGroups = useMemo(
    // 以图鉴里的「蛋」为全集：完全没拥有的蛋也会出现在未收集里，与看板同口径
    () => groupMothersByEgg(owned, speciesByGameId, species, mode),
    [owned, speciesByGameId, mode],
  );

  /**
   * 种公视角的名单：**公 + 档位达标**就算（性格不当门槛，否则「合格但性格不在目标池」
   * 的精灵会凭空消失）；覆盖目标数只影响排序（`describeStudTargets` 里覆盖多的在前）。
   */
  const studEntries = useMemo(
    () =>
      describeStudTargets({ owned, species, slots, eggGroupNames, mode }).filter(
        (hit) => hit.grade !== null,
      ),
    [owned, slots, mode],
  );

  /** 种公视角的蛋组筛选：每个可孵蛋组有多少只合格种公（用于选项计数与置灰） */
  const studGroupCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const hit of studEntries) {
      const entries = speciesByGameId.get(owned[hit.petIndex].gameId)?.eggGroups ?? [];
      for (const groupId of new Set(entries)) {
        if (!isBreedableGroup(groupId)) continue;
        counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
      }
    }
    return counts;
  }, [studEntries, owned, speciesByGameId]);

  /** 名单上再叠三层可选筛选（都不选 = 全部）：档位、性格（「其他」= 不在八大性格池里）、蛋组 */
  const visibleStuds = useMemo(
    () =>
      studEntries.filter((hit) => {
        if (studGrades.size > 0 && (hit.grade === null || !studGrades.has(hit.grade))) return false;
        const pet = owned[hit.petIndex];
        if (studNatures.size > 0) {
          // 多选是并集语义：勾了「其他」只代表「接受八大门派之外的性格」，
          // 不能把同时勾上的具体性格反过来滤掉
          const matched =
            studNatures.has(pet.nature) ||
            (studNatures.has('其他') && !STUD_NATURE_NAMES.has(pet.nature));
          if (!matched) return false;
        }
        if (studGroups.size > 0) {
          const groups = (speciesByGameId.get(pet.gameId)?.eggGroups ?? []).map(String);
          if (!groups.some((groupId) => studGroups.has(groupId))) return false;
        }
        const keyword = studQuery.trim().toLowerCase();
        if (keyword && !petMatchesQuery(pet, keyword)) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studEntries, studGrades, studNatures, studGroups, owned, studQuery, speciesByGameId, chainSearchIndex],
  );
  /** 其中真正覆盖了当前目标的只数（只用于提示，不再当门槛） */
  const coveredStudCount = visibleStuds.filter((hit) => hit.targets.length > 0).length;

  /** 种公卡片按账号分组（2026-10-05 拍板：展示层按账号聚拢，账号不做分组标题之外的统计口径改动） */
  const studPetsByAccount = useMemo(() => {
    const map = new Map<string, OwnedPet[]>();
    for (const hit of visibleStuds) {
      const pet = owned[hit.petIndex];
      const list = map.get(pet.account) ?? [];
      list.push(pet);
      map.set(pet.account, list);
    }
    return [...map.entries()].map(([account, pets]) => ({ account, pets }));
  }, [visibleStuds, owned]);

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
    <main className="mx-auto max-w-md space-y-3 p-4">
      <div className="flex rounded-xl bg-slate-100 p-1">
        {VIEW_LABELS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onViewChange(item.id)}
            className={`min-h-[40px] flex-1 rounded-lg text-sm font-medium ${
              view === item.id ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="px-1 text-[11px] text-slate-400" data-testid="mypets-mode">
        当前模式 · {TARGET_MODE_LABELS[mode]}
      </p>

      <AccountFilterBar accounts={accounts} />

      {view === 'mother' ? (
        <MotherView
          owned={owned}
          searchIndex={eggSearchIndex}
          eggGroupNames={eggGroupNames}
          motherGroups={motherGroups}
          mode={mode}
        />
      ) : view === 'stud' ? (
        <>
          {/* 搜索在最上（2026-10-05 用户拍板：搜索框跑下面很奇怪），支持进化链全员命中 */}
          <input
            type="search"
            value={studQuery}
            onChange={(event) => setStudQuery(event.target.value)}
            placeholder="搜索种公名称（支持进化链）"
            data-testid="stud-search"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none"
          />
          {/* 档位 / 性格 / 蛋组 统一成与「全部」页一致的手风琴（白卡包一层，与其它筛选区统一） */}
          <section className="rounded-xl bg-white p-3 shadow-sm" data-testid="stud-filters">
            <FilterAccordion
              dimensions={[
                {
                  id: 'studGrade',
                  label: '档位',
                  options: ALL_GRADES.map((grade) => ({ value: grade, label: gradeLabel(grade, mode) })),
                  selected: [...studGrades],
                  onToggle: (grade) => toggleStudGrade(grade as (typeof ALL_GRADES)[number]),
                  onClear: () => [...studGrades].forEach((grade) => toggleStudGrade(grade)),
                },
                {
                  id: 'studNature',
                  label: '性格',
                  options: STUD_NATURE_OPTIONS.map((name) => ({ value: name, label: name })),
                  selected: [...studNatures],
                  onToggle: (name) => toggleStudNature(name),
                  onClear: () => [...studNatures].forEach((name) => toggleStudNature(name)),
                },
                {
                  id: 'studGroup',
                  label: '蛋组',
                  options: ALL_EGG_GROUP_IDS.filter((groupId) => studGroupCounts.has(groupId)).map(
                    (groupId) => ({
                      value: String(groupId),
                      label: `${eggGroupNames[groupId] ?? `蛋组${groupId}`} (${studGroupCounts.get(groupId) ?? 0})`,
                    }),
                  ),
                  selected: [...studGroups],
                  onToggle: (groupId) => toggleStudGroup(groupId),
                  onClear: () => [...studGroups].forEach((groupId) => toggleStudGroup(groupId)),
                },
              ]}
            />
          </section>
          <p className="text-xs text-slate-400" data-testid="stud-view-hint">
            手里的种公（公 · 档位达标）{visibleStuds.length} 只 · 其中覆盖当前目标{' '}
            {coveredStudCount} 只
          </p>
          {visibleStuds.length === 0 ? (
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500" data-testid="stud-empty">
              当前筛选下没有种公。可清掉档位 / 性格 / 蛋组筛选，或到「覆盖度」调整目标。
            </div>
          ) : (
            <div className="space-y-2">
              {studPetsByAccount.map(({ account, pets }) => (
                <AccountSection key={account} account={account}>
                  <PetList
                    pets={pets}
                    speciesByGameId={speciesByGameId}
                    eggGroupNames={eggGroupNames}
                    resetKey={`${slots.length}|${[...studGrades].join(',')}|${[...studGroups].join(',')}|${studQuery.trim()}`}
                  />
                </AccountSection>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* 全部页筛选抽屉（2026-10-05 拍板：按参考图紧凑分组，默认展开，带搜索与重置） */}
          <section className="rounded-xl bg-white p-3 shadow-sm" data-testid="pet-filters">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setMyPetsFiltersOpen(!filtersOpen)}
                className="min-h-[32px] text-xs font-medium text-emerald-700"
                data-testid="pet-filters-toggle"
              >
                筛选{filtersOpen ? ' ▲' : ' ▼'}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearMyPetsFilters();
                  setNameQuery('');
                }}
                className="min-h-[32px] text-xs text-slate-500"
                data-testid="pet-filters-reset"
              >
                重置{selected.size > 0 ? `（${selected.size}）` : ''}
              </button>
            </div>

            {filtersOpen ? (
              <div className="mt-2 space-y-2.5">
                <input
                  type="search"
                  value={nameQuery}
                  onChange={(event) => setNameQuery(event.target.value)}
                  placeholder="搜索精灵名"
                  data-testid="pet-name-search"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none"
                />
                <FilterAccordion
                  dimensions={FILTER_DIMENSIONS.filter(({ kind }) =>
                    displayTags.some((tag) => tag.kind === kind),
                  ).map(({ kind, label }) => {
                    const rowTags =
                      kind === 'nature'
                        ? sortNaturePoolFirst(displayTags.filter((tag) => tag.kind === kind))
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
              </div>
            ) : null}

            {selectedLabels.length > 0 ? (
              <p className="mt-1 text-xs text-slate-500" data-testid="pet-filters-selected">
                已选：{selectedLabels.join('、')}
              </p>
            ) : null}
          </section>
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
        </>
      )}
    </main>
  );
}