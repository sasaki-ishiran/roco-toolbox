import { useMemo, useState, type ReactNode } from 'react';
import { GRADE_BODY, gradeLabel, type PetGrade, type TargetMode } from '../domain/petFilters';
import {
  buildStudMatrix,
  representativeOf,
  studMatrixPickKey,
  type StudMatrixCell,
  type StudMatrixPet,
} from '../domain/studMatrix';
import type { CoverageSlot } from '../domain/studCoverage';
import type { StudRecommendation } from '../domain/suggestions';
import { recommendedNaturesForSpecies } from '../domain/studRecommendations';
import { isBreedableGroup } from '../domain/eggs';
import { speciesDisplayName } from '../domain/speciesName';
import type { OwnedPet, SpeciesEntry } from '../domain/types';
import type { DemandBody, DemandVoice } from '../shared/collectionGroups';
import { PetAvatar } from './PetAvatar';
import { ModalSurface } from './primitives/ModalSurface';
import { clearStudMatrixPick, setStudMatrixPick, useStudMatrixPicks } from './studMatrixStore';

const GRADE_LABEL: Record<PetGrade, string> = {
  大婉: '大婉',
  小婉: '小婉',
  大粗: '大粗',
  小粗: '小粗',
};

/**
 * 列宽 / 格子高度（2026-10-29 用户要求「左侧蛋组太占地方，卡片再收缩一点」）：
 * 蛋组列 64 → 52 → 35（2026-10-30 再缩到约 2/3），性格列 60，格子 52（头像仍 32）。
 * 蛋组列只有 35px：「巨灵组」这类三字名会截断，靠 title 悬停看全名。
 */
const EGG_GROUP_COL_WIDTH = 35;
const NATURE_COL_WIDTH = 60;
const CELL_HEIGHT = 52;

export interface StudMatrixProps {
  /** 覆盖度槽位（蛋组 × 目标性格 × 档位），来自全局筛选 */
  slots: CoverageSlot[];
  owned: OwnedPet[];
  species: SpeciesEntry[];
  speciesByGameId: Map<number, SpeciesEntry>;
  eggGroupNames: Record<number, string>;
  mode: TargetMode;
  /** 「优质种公推荐」（与看板 / 求种公同源）：用来填还没收集的格子。 */
  recommendations?: StudRecommendation[];
  /** 收集页没有小组上下文：点淡黄推荐格时按需读取我加入的小组。 */
  demandGroups?: StudDemandGroup[] | null;
  demandGroupsLoading?: boolean;
  demandGroupsError?: string;
  onLoadDemandGroups?: () => void;
  onPublishStudDemand?: (input: StudDemandPublishInput) => Promise<void>;
  /** 筛选内容收在卡片右上角（2026-10-29 用户要求）：传了才有「筛选」按钮与折叠面板。 */
  filterPanel?: ReactNode;
  filterOpen?: boolean;
  onToggleFilter?: () => void;
  /** 筛选与默认值不同：右上角小圆点提示。 */
  filterActive?: boolean;
}

export interface StudDemandGroup {
  id: string;
  name: string;
}

/** 点推荐格发到小组需求中心：种公需求用负数蛋组 id，性别固定公。 */
export interface StudDemandPublishInput {
  groupId: string;
  groupName: string;
  eggGroupId: number;
  natureName: string;
  body: DemandBody;
  voice: DemandVoice;
}

interface PickerState {
  grade: PetGrade;
  cell: StudMatrixCell;
}

/** 格子里填的推荐种公（精确推荐或同蛋组兜底都收敛成这一形状）。 */
interface CellRecommendation {
  gameId: number;
  displayName: string;
}

/**
 * 格子里的名字（2026-10-28 用户口径）：名字太长时不展示形态，只留 `_` 前的基础名。
 * 例：`雪绒鸟_夏天的样子` → `雪绒鸟`；短名字原样保留。
 */
export function studMatrixCellName(name: string): string {
  const base = name.split('_')[0] ?? name;
  return name.length > 6 && base !== name ? base : name;
}

/**
 * 种公阵列（2026-10-28，参考蛋神助手）：行 = 蛋组、列 = 目标性格并集、档位做 tab。
 *
 * - 每格展示排序第一的种公；**多只时在名字下方显示小数字**，点格子弹层换代表。
 * - 代表选择记在本机（`roco.studMatrixPicks`），刷新/重开还在；可「恢复自动」。
 * - 某组没把该性格列为目标 → 淡灰「—」，不算缺口。
 */
export function StudMatrix({
  slots,
  owned,
  species,
  speciesByGameId,
  eggGroupNames,
  mode,
  recommendations = [],
  demandGroups = null,
  demandGroupsLoading = false,
  demandGroupsError = '',
  onLoadDemandGroups,
  onPublishStudDemand,
  filterPanel,
  filterOpen = false,
  onToggleFilter,
  filterActive = false,
}: StudMatrixProps) {
  const grades = useMemo(() => {
    const order: PetGrade[] = ['大婉', '小婉', '大粗', '小粗'];
    return order.filter((grade) => slots.some((slot) => slot.grade === grade));
  }, [slots]);

  const [activeGrade, setActiveGrade] = useState<PetGrade>(grades[0] ?? '大婉');
  const grade = grades.includes(activeGrade) ? activeGrade : grades[0] ?? '大婉';

  const { picks } = useStudMatrixPicks();
  const matrix = useMemo(
    () =>
      buildStudMatrix({ slots, owned, species, speciesByGameId, eggGroupNames, mode, grade }),
    [slots, owned, species, speciesByGameId, eggGroupNames, mode, grade],
  );
  /** 还没收集的格子填什么推荐种公：按「蛋组 + 性格 + 当前档位」对上。 */
  const recommendationByCell = useMemo(() => {
    const map = new Map<string, StudRecommendation>();
    for (const rec of recommendations) {
      if (rec.grade !== grade) continue;
      for (const groupId of rec.groupIds) {
        const key = `${groupId}::${rec.natureName}`;
        if (!map.has(key)) map.set(key, rec);
      }
    }
    return map;
  }, [recommendations, grade]);

  /**
   * 精确推荐只覆盖「有物种把该性格列为推荐」的格子；剩下的缺口按蛋组兜底挑一只
   * 能出公的蛋物种，保证每个选中的格子都能看到「该补哪只」（2026-10-28 用户反馈）。
   */
  const fallbackByCell = useMemo(() => {
    const ownedEggIds = new Set<number>();
    for (const pet of owned) {
      const eggGameId = speciesByGameId.get(pet.gameId)?.eggGameId;
      if (eggGameId != null) ownedEggIds.add(eggGameId);
    }
    const byGroup = new Map<number, SpeciesEntry[]>();
    for (const entry of species) {
      // 只能推荐「本身就是一颗蛋」且能出公的物种
      if (entry.eggGameId !== entry.gameId) continue;
      if (entry.maleCapable !== true) continue;
      for (const groupId of (entry.eggGroups ?? []).filter(isBreedableGroup)) {
        const list = byGroup.get(groupId) ?? [];
        list.push(entry);
        byGroup.set(groupId, list);
      }
    }
    for (const list of byGroup.values()) list.sort((a, b) => a.gameId - b.gameId);

    const map = new Map<string, CellRecommendation>();
    for (const row of matrix.rows) {
      for (const cell of row.cells) {
        if (!cell.targeted) continue;
        const key = `${cell.groupId}::${cell.natureName}`;
        if (recommendationByCell.has(key) || map.has(key)) continue;
        const candidates = byGroup.get(cell.groupId) ?? [];
        if (candidates.length === 0) continue;
        // 优先未拥有的；同组里优先「推荐性格里包含这个性格」的物种
        const unowned = candidates.filter((entry) => !ownedEggIds.has(entry.gameId));
        const pool = unowned.length > 0 ? unowned : candidates;
        const entry =
          pool.find((item) => recommendedNaturesForSpecies(item).includes(cell.natureName)) ??
          pool[0];
        map.set(key, {
          gameId: entry.gameId,
          displayName: speciesDisplayName(entry, entry.name),
        });
      }
    }
    return map;
  }, [matrix.rows, recommendationByCell, species, speciesByGameId, owned]);
  const [picker, setPicker] = useState<PickerState | null>(null);
  /** 点淡黄推荐格 → 选小组，把这条种公需求发到小组需求中心。 */
  const [publishCell, setPublishCell] = useState<{
    eggGroupId: number;
    groupLabel: string;
    natureName: string;
  } | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishMessage, setPublishMessage] = useState('');
  const [publishError, setPublishError] = useState('');
  const demandBody = GRADE_BODY[grade] as DemandBody;
  const demandVoice: DemandVoice =
    grade === '大婉' || grade === '小婉' ? '+100' : '-100';

  const openPublish = (cell: StudMatrixCell) => {
    setPublishCell({
      eggGroupId: cell.groupId,
      groupLabel: eggGroupNames[cell.groupId] ?? `蛋组${cell.groupId}`,
      natureName: cell.natureName,
    });
    setPublishMessage('');
    setPublishError('');
    onLoadDemandGroups?.();
  };

  const publishTo = async (group: StudDemandGroup) => {
    if (!publishCell || !onPublishStudDemand || publishBusy) return;
    setPublishBusy(true);
    setPublishError('');
    setPublishMessage('');
    try {
      await onPublishStudDemand({
        groupId: group.id,
        groupName: group.name,
        eggGroupId: publishCell.eggGroupId,
        natureName: publishCell.natureName,
        body: demandBody,
        voice: demandVoice,
      });
      setPublishMessage(`已发到「${group.name}」的需求中心`);
    } catch (failure) {
      setPublishError(failure instanceof Error ? failure.message : '发布失败，请稍后再试');
    } finally {
      setPublishBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-white p-2.5 shadow-sm" data-testid="stud-matrix">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-slate-500">种公阵列</h2>
          <p className="mt-0.5 truncate text-[10px] text-slate-400">
            跟随「覆盖度」目标 · 点带数字的格子换代表
          </p>
        </div>
        {filterPanel ? (
          <button
            type="button"
            aria-expanded={filterOpen}
            onClick={onToggleFilter}
            data-testid="stud-matrix-filter-toggle"
            className={`relative min-h-[26px] shrink-0 rounded-md border px-2 text-[11px] ${
              filterOpen
                ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                : 'border-slate-200 text-slate-500'
            }`}
          >
            筛选<span aria-hidden className="ml-0.5 text-[9px]">{filterOpen ? '▲' : '▼'}</span>
            {filterActive ? (
              <span
                className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500"
                data-testid="stud-matrix-filter-dot"
                aria-hidden
              />
            ) : null}
          </button>
        ) : null}
      </header>

      {grades.length > 0 ? (
        <div className="mt-1.5 flex items-center gap-1" role="group" aria-label="阵列档位">
          {grades.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setActiveGrade(item)}
              aria-pressed={item === grade}
              data-testid={`stud-matrix-grade-${item}`}
              className={`rounded-md px-1.5 text-[10px] leading-[1.6] ${
                item === grade ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {GRADE_LABEL[item]}
            </button>
          ))}
          <span className="ml-auto truncate text-[10px] text-slate-400">
            左右滑动看更多性格
            {onPublishStudDemand ? ' · 点淡黄格可求蛋' : ''}
          </span>
        </div>
      ) : null}

      {filterPanel && filterOpen ? (
        <div
          className="mt-2 rounded-xl bg-slate-50 p-2"
          data-testid="stud-matrix-filter"
        >
          {filterPanel}
        </div>
      ) : null}

      {/* 2026-10-28：表格只做横向滚动；不要加 touch-pan-x，否则触摸表格区域时整页上下也滑不动 */}
      {grades.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400" data-testid="stud-matrix-empty">
          覆盖度里还没选目标档位与性格：先点右上角「筛选」勾选要追的档位与性格。
        </p>
      ) : matrix.natures.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400" data-testid="stud-matrix-no-nature">
          当前档位下没有选中的目标性格。
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto overscroll-x-contain" data-testid="stud-matrix-scroll">
          <table
            className="table-fixed border-separate border-spacing-0 text-[10px]"
            style={{ width: `${EGG_GROUP_COL_WIDTH + matrix.natures.length * NATURE_COL_WIDTH}px` }}
          >
            <colgroup>
              <col style={{ width: `${EGG_GROUP_COL_WIDTH}px` }} />
              {matrix.natures.map((nature) => (
                <col key={nature} style={{ width: `${NATURE_COL_WIDTH}px` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {/* 左上角只写「蛋组」：列宽 35px 放不下「蛋组 / 性格」一行，
                    右侧表头本来就是性格名（2026-10-30 用户口径「一横显示」） */}
                <th
                  className="sticky left-0 z-10 bg-white px-0.5 pb-1 text-left font-normal text-[9px] leading-tight text-slate-400"
                  aria-label="蛋组"
                >
                  蛋组
                </th>
                {matrix.natures.map((nature) => (
                  <th
                    key={nature}
                    className="px-0.5 pb-1 text-center font-medium text-slate-500"
                  >
                    {nature}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.groupId}>
                  <th
                    className="sticky left-0 z-10 truncate whitespace-nowrap bg-white px-0.5 py-0.5 text-left text-[9px] font-normal leading-tight text-slate-500"
                    title={row.groupLabel}
                  >
                    {row.groupLabel}
                  </th>
                  {row.cells.map((cell) => {
                    const cellKey = `${cell.groupId}::${cell.natureName}`;
                    return (
                      <td key={cell.natureName} className="p-0.5 align-middle">
                        <MatrixCell
                          cell={cell}
                          grade={grade}
                          picks={picks}
                          recommendation={
                            recommendationByCell.get(cellKey) ?? fallbackByCell.get(cellKey)
                          }
                          onOpen={() => setPicker({ grade, cell })}
                          onRecommend={
                            onPublishStudDemand ? () => openPublish(cell) : undefined
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picker ? (
        <PickerSheet
          grade={picker.grade}
          cell={picker.cell}
          picks={picks}
          onClose={() => setPicker(null)}
        />
      ) : null}

      <ModalSurface
        open={publishCell !== null}
        title="加到需求中心"
        onClose={() => setPublishCell(null)}
        testId="stud-demand-publish"
        closeTestId="stud-demand-publish-close"
        backdropTestId="stud-demand-publish-backdrop"
      >
        {publishCell ? (
          <div className="space-y-2 p-3" data-testid="stud-demand-publish-body">
            <p className="text-xs text-slate-700" data-testid="stud-demand-publish-summary">
              {publishCell.groupLabel} × {publishCell.natureName} · {gradeLabel(grade, mode)}
              <span className="ml-1 text-[11px] text-slate-500">
                公 · {demandBody} · {demandVoice}
              </span>
            </p>
            <p className="text-[11px] text-slate-400">选一个小组，把这条种公需求发到需求中心。</p>
            {publishMessage ? (
              <p className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700" data-testid="stud-demand-publish-message">
                {publishMessage}
              </p>
            ) : null}
            {publishError ? (
              <p className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-600" data-testid="stud-demand-publish-error">
                {publishError}
              </p>
            ) : null}
            {demandGroupsLoading ? (
              <p className="text-xs text-slate-400" data-testid="stud-demand-groups-loading">
                正在读取你加入的小组…
              </p>
            ) : demandGroupsError ? (
              <p className="text-xs text-rose-600" data-testid="stud-demand-groups-error">
                {demandGroupsError}
              </p>
            ) : demandGroups && demandGroups.length === 0 ? (
              <p className="text-xs text-slate-400" data-testid="stud-demand-groups-empty">
                你还没加入小组；先到「收集小组」加入一个，才能发需求。
              </p>
            ) : null}
            <ul className="space-y-1">
              {(demandGroups ?? []).map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    disabled={publishBusy}
                    onClick={() => void publishTo(group)}
                    data-testid={`stud-demand-publish-${group.id}`}
                    className="min-h-[36px] w-full rounded-lg border border-emerald-500 px-2 text-sm font-medium text-emerald-700 disabled:opacity-40"
                  >
                    发到「{group.name}」
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </ModalSurface>
    </section>
  );
}

function MatrixCell({
  cell,
  grade,
  picks,
  recommendation,
  onOpen,
  onRecommend,
}: {
  cell: StudMatrixCell;
  grade: PetGrade;
  picks: Record<string, string>;
  recommendation?: CellRecommendation;
  onOpen: () => void;
  /** 点了淡黄推荐格：发到小组需求中心（没传就只展示、不可点）。 */
  onRecommend?: () => void;
}) {
  if (!cell.targeted) {
    return (
      <span
        className="flex w-full items-center justify-center rounded bg-slate-50 text-slate-300"
        style={{ height: CELL_HEIGHT }}
      >
        —
      </span>
    );
  }
  const rep = representativeOf(cell, picks, grade);
  if (!rep) {
    // 还没收集到：用「优质种公推荐」里对应的那只填上，淡黄色表示这是推荐目标
    if (recommendation) {
      const recName = studMatrixCellName(recommendation.displayName);
      const body = (
        <>
          <PetAvatar gameId={recommendation.gameId} name={recName} size={32} />
          <span className="w-full truncate text-center text-[9px] leading-tight text-amber-800">
            {recName}
          </span>
          <span className="absolute right-0.5 top-0.5 rounded bg-white/85 px-0.5 text-[8px] leading-tight text-amber-700">
            荐
          </span>
        </>
      );
      const shell =
        'relative flex w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded bg-amber-50 px-0.5 py-0.5 ring-1 ring-inset ring-amber-200';
      if (!onRecommend) {
        return (
          <div
            className={shell}
            style={{ height: CELL_HEIGHT }}
            data-testid={`stud-cell-recommend-${cell.groupId}-${cell.natureName}`}
            title={`推荐种公：${recommendation.displayName}`}
          >
            {body}
          </div>
        );
      }
      return (
        <button
          type="button"
          onClick={onRecommend}
          className={shell}
          style={{ height: CELL_HEIGHT }}
          data-testid={`stud-cell-recommend-${cell.groupId}-${cell.natureName}`}
          title={`推荐种公：${recommendation.displayName}；点击加到需求中心`}
        >
          {body}
        </button>
      );
    }
    return (
      <span
        className="flex w-full items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400"
        style={{ height: CELL_HEIGHT }}
        data-testid={`stud-cell-empty-${cell.groupId}-${cell.natureName}`}
      >
        缺
      </span>
    );
  }
  const count = cell.candidates.length;
  const cellName = studMatrixCellName(rep.name);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${cell.natureName} 种公 ${rep.name}，共 ${count} 只，点击选择代表`}
      data-testid={`stud-cell-${cell.groupId}-${cell.natureName}`}
      className="relative flex w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded bg-emerald-50/50 px-0.5 py-0.5 ring-1 ring-inset ring-emerald-100"
      style={{ height: CELL_HEIGHT }}
    >
      <PetAvatar
        gameId={rep.gameId}
        name={cellName}
        shiny={rep.isShiny}
        size={32}
      />
      <span
        className="w-full truncate text-center text-[9px] leading-tight text-slate-700"
        title={rep.name}
      >
        {cellName}
      </span>
      {count > 1 ? (
        <span
          className="absolute right-0.5 top-0.5 rounded bg-white/85 px-0.5 text-[8px] leading-tight text-slate-500"
          data-testid={`stud-cell-count-${cell.groupId}-${cell.natureName}`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function PickerSheet({
  grade,
  cell,
  picks,
  onClose,
}: {
  grade: PetGrade;
  cell: StudMatrixCell;
  picks: Record<string, string>;
  onClose: () => void;
}) {
  const key = studMatrixPickKey(grade, cell.groupId, cell);
  const auto = cell.candidates[0] ?? null;
  const picked = picks[key] ? cell.candidates.find((pet) => pet.key === picks[key]) : undefined;

  const choose = (pet: StudMatrixPet) => {
    setStudMatrixPick(key, pet.key);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-2"
      onClick={onClose}
      data-testid="stud-picker"
    >
      <div
        className="max-h-[75vh] w-full max-w-md overflow-hidden rounded-2xl bg-white p-3 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">选择代表种公</h3>
          <span className="text-[10px] text-slate-400">
            {cell.natureName} · {GRADE_LABEL[grade]} · {cell.candidates.length} 只
          </span>
        </header>
        <ul className="mt-2 max-h-[52vh] space-y-1 overflow-y-auto">
          {cell.candidates.map((pet) => {
            const selected = picked ? picked.key === pet.key : auto?.key === pet.key;
            return (
              <li key={pet.key}>
                <button
                  type="button"
                  onClick={() => choose(pet)}
                  data-testid={`stud-picker-option-${pet.key}`}
                  aria-pressed={selected}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                    selected ? 'bg-emerald-50 ring-1 ring-emerald-500' : 'bg-slate-50'
                  }`}
                >
                  <PetAvatar
                    gameId={pet.gameId}
                    name={pet.name}
                    shiny={pet.isShiny}
                    size={32}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-800">{pet.name}</span>
                    <span className="block text-[10px] text-slate-500">
                      {pet.account} · {pet.weightPercent != null ? `${pet.weightPercent.toFixed(2)}%` : '—'}
                      {' · '}
                      {pet.voiceDb}dB
                    </span>
                  </span>
                  {selected ? <span className="text-[10px] text-emerald-700">当前</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <footer className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              clearStudMatrixPick(key);
              onClose();
            }}
            data-testid="stud-picker-auto"
            className="min-h-[28px] rounded-md border border-slate-200 px-2 text-[11px] text-slate-500"
          >
            恢复自动
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="stud-picker-close"
            className="min-h-[28px] rounded-md border border-slate-200 px-2 text-[11px] text-slate-500"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
