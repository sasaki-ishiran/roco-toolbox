import { useMemo, useState } from 'react';
import type { CoverageState, StudCoverageResult } from '../domain/studCoverage';
import type { CoverageCellDetail, PetRef } from '../domain/coverageDetail';
import { groupRecommendedNatures } from '../domain/coverageTargets';
import { gradeLabel } from '../domain/petFilters';
import { targetNatures } from '../data/catalog';
import { GenderMark } from './GenderMark';
import { useTargetMode } from './targetModeStore';

/** 推荐性格（数据推导）：只在组内筛选里做标注，不决定矩阵规模 */
const RECOMMENDED = groupRecommendedNatures(targetNatures);

/**
 * 三态文案（2026-10-05 用户拍板）：「有母本·缺公」不再单列，实际就算**未收集**
 *（都是"得去弄一只"，分那么细对用户没意义）。
 */
export const COVERAGE_STATE_LABELS: Record<CoverageState, string> = {
  covered: '已通',
  breedable: '可迭代',
  missingStud: '未收集',
  empty: '未收集',
};

/** 四态配色（色块 + 文本色） */
export const COVERAGE_STATE_CHIP: Record<CoverageState, string> = {
  covered: 'bg-emerald-500',
  breedable: 'bg-sky-500',
  missingStud: 'bg-amber-500',
  empty: 'bg-slate-300',
};

/** 图例展示顺序：从最好到最差（未收集把 missingStud 和 empty 合并成一条） */
export const COVERAGE_LEGEND_ORDER: CoverageState[] = [
  'covered',
  'breedable',
  'empty',
];

// 与领域层同序：covered 最好，empty 最差
const STATE_RANK: Record<CoverageState, number> = {
  covered: 0,
  breedable: 1,
  missingStud: 2,
  empty: 3,
};

const worst = (a: CoverageState, b: CoverageState): CoverageState =>
  STATE_RANK[a] >= STATE_RANK[b] ? a : b;

interface GroupRow {
  groupId: number;
  covered: number;
  total: number;
  state: CoverageState;
}

export type { GroupRow };

/**
 * 蛋组行的**状态色档**（就是行首那个圆点的颜色），从差到好：
 * 灰（一格没通）→ 橙（通了一部分，但没有可迭代的）→ 蓝（有可迭代的）→ 绿（全通）。
 *
 * 排序与圆点共用这一份判定（2026-10-07 用户要求：蛋组行按外显的状态色排），
 * 免得「看到的颜色」和「排列顺序」两处走偏。
 */
export type GroupTone = 'gray' | 'amber' | 'sky' | 'emerald';

export const GROUP_TONE_RANK: Record<GroupTone, number> = {
  gray: 0,
  amber: 1,
  sky: 2,
  emerald: 3,
};

export const GROUP_TONE_CLASS: Record<GroupTone, string> = {
  gray: 'bg-slate-300',
  amber: 'bg-amber-500',
  sky: 'bg-sky-500',
  emerald: 'bg-emerald-500',
};

export const groupTone = (
  group: { groupId: number; covered: number; total: number },
  iterableGroups: ReadonlySet<number>,
): GroupTone =>
  group.covered === group.total
    ? 'emerald'
    : iterableGroups.has(group.groupId)
      ? 'sky'
      : group.covered > 0
        ? 'amber'
        : 'gray';

/**
 * 蛋组行排序（2026-10-07 用户要求：未收集多的先展示）：
 * 1. 状态色档，从差到好（灰 → 橙 → 蓝 → 绿）——顺序跟行首圆点一致，肉眼可核对；
 * 2. 同色档再比「还差几行」多的在前（色档是粗档，同色里 0/3 与 0/9 分不开）；
 * 3. 最后按蛋组 id，保证顺序稳定。
 *
 * 注：不再固定按蛋组 id 排（那是 2026-10-05 的旧口径）。
 */
export function orderGroupRows(rows: GroupRow[], iterableGroups: ReadonlySet<number>): GroupRow[] {
  return [...rows].sort((a, b) => {
    const byTone = GROUP_TONE_RANK[groupTone(a, iterableGroups)] - GROUP_TONE_RANK[groupTone(b, iterableGroups)];
    if (byTone !== 0) return byTone;
    const byMissing = b.total - b.covered - (a.total - a.covered);
    if (byMissing !== 0) return byMissing;
    return a.groupId - b.groupId;
  });
}

export interface CoverageMatrixProps {
  stud: StudCoverageResult;
  eggGroupNames: Record<number, string>;
  /** 展开的蛋组（受控）。由上层持有，切页签不会丢 */
  expandedGroupId?: number | null;
  onToggleGroup?: (groupId: number | null) => void;
  /** 每个目标的明细：具体是哪只母本/种公、缺什么、下一步怎么放 */
  details?: CoverageCellDetail[];
  /** 可勾选的性格池（八大性格）；给了才在展开的蛋组里显示组内性格开关 */
  naturePool?: Array<{ id: number; name: string }>;
  /** 每个蛋组当前选中的性格名 */
  groupNatures?: Record<number, string[]>;
  onToggleGroupNature?: (groupId: number, natureName: string) => void;
  /** 自选性格模式下隐藏组内性格开关（性格由全局面板统管） */
  natureMode?: 'recommended' | 'custom';
}

/** 一行精灵：左侧角色标签 + 名字 + 性别 + 性格 + 位置（位置淡色，不抢视线） */
function PetRow({ label, pet, testId }: { label: string; pet: PetRef; testId?: string }) {
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-700"
      data-testid={testId}
    >
      {/* 标签列定宽：学院小窝(4字)/配对(2字)/种公/母本 后面的内容才会对齐 */}
      <span className="flex w-[4.6rem] shrink-0 items-center">
        <span
          className={`flex-1 rounded px-1.5 py-0.5 text-center text-[10px] leading-none ${
            label === '学院小窝' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {label}
        </span>
      </span>
      <span className="font-medium">{pet.name}</span>
      <GenderMark gender={pet.gender} />
      <span className="rounded bg-amber-50 px-1 py-0.5 text-[10px] leading-none text-amber-700">
        {pet.nature}
      </span>
      <span className="text-[10px] text-slate-400">
        {pet.account} · {pet.box}
      </span>
    </p>
  );
}

/**
 * 覆盖度矩阵：每行一个蛋组，展示「已覆盖 / 总目标」与颜色点；点击行展开该组的性格明细。
 * 行与列都来自筛选出来的槽位（蛋组 × 性格 × 档位），所以分母随筛选变化。
 */
export function CoverageMatrix({
  stud,
  eggGroupNames,
  expandedGroupId,
  onToggleGroup,
  details = [],
  naturePool,
  groupNatures,
  onToggleGroupNature,
  natureMode = 'recommended',
}: CoverageMatrixProps) {
  const [internalExpanded, setInternalExpanded] = useState<number | null>(null);
  const expanded = expandedGroupId === undefined ? internalExpanded : expandedGroupId;
  /** 有「可迭代」目标的蛋组 → 组状态灯标蓝（2026-10-05 用户要求） */
  const iterableGroups = useMemo(
    () => new Set(stud.cells.filter((cell) => cell.state === 'breedable').map((cell) => cell.groupId)),
    [stud],
  );
  const setExpanded = onToggleGroup ?? setInternalExpanded;
  const mode = useTargetMode();

  // 勾了多个档位时，明细里要标出这条是哪一档
  const multiGrade = useMemo(
    () => new Set(stud.cells.map((cell) => cell.grade)).size > 1,
    [stud],
  );

  const groups = useMemo<GroupRow[]>(() => {
    const byGroup = new Map<number, GroupRow>();
    for (const cell of stud.cells) {
      const row =
        byGroup.get(cell.groupId) ??
        ({ groupId: cell.groupId, covered: 0, total: 0, state: 'empty' } as GroupRow);
      row.total += 1;
      if (cell.state === 'covered') row.covered += 1;
      row.state = row.total === 1 ? cell.state : worst(row.state, cell.state);
      byGroup.set(cell.groupId, row);
    }

    // 2026-10-07 用户要求：未收集多的排前面（按行首圆点的状态色档，从差到好；见 orderGroupRows）
    return orderGroupRows([...byGroup.values()], iterableGroups);
  }, [stud, iterableGroups]);

  return (
    <ul className="space-y-2" data-testid="coverage-matrix">
      {groups.map((group) => {
        const name = eggGroupNames[group.groupId] ?? `蛋组${group.groupId}`;
        const open = expanded === group.groupId;
        const cells = details.filter((detail) => detail.groupId === group.groupId);
        const tone = groupTone(group, iterableGroups);

        return (
          <li
            key={group.groupId}
            className="rounded-xl bg-white shadow-sm"
            data-testid="coverage-group-row"
            data-tone={tone}
            data-group-id={group.groupId}
          >
            <button
              type="button"
              aria-expanded={open}
              data-testid="coverage-group-toggle"
              onClick={() => setExpanded(open ? null : group.groupId)}
              className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left"
            >
              <span className="flex items-center gap-2">
                <span
                  className={`inline-block h-3 w-3 shrink-0 rounded-full ${GROUP_TONE_CLASS[tone]}`}
                  aria-hidden
                />
                <span className="text-sm font-medium text-slate-800">{name}</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                <span>
                  {group.covered} / {group.total}
                </span>
                <span className="text-slate-300" aria-hidden>
                  {open ? '▲' : '▼'}
                </span>
              </span>
            </button>

            {open ? (
              <ul className="space-y-1 border-t border-slate-100 p-3">
                {/* 自选性格模式下不显示组内性格开关（由覆盖度页顶部的全局面板统管） */}
                {naturePool && onToggleGroupNature && natureMode === 'recommended' ? (
                  <li className="pb-1">
                    <p className="text-xs text-slate-400">
                      本组性格
                      <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
                      <span className="ml-0.5">推荐</span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {naturePool.map((nature) => {
                        const on = (groupNatures?.[group.groupId] ?? []).includes(nature.name);
                        const recommended = (RECOMMENDED[group.groupId] ?? []).includes(nature.name);
                        return (
                          <button
                            key={nature.name}
                            type="button"
                            aria-pressed={on}
                            onClick={() => onToggleGroupNature(group.groupId, nature.name)}
                            className={`min-h-[28px] rounded-full border px-2 text-xs ${
                              on
                                ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                                : 'border-slate-200 bg-white text-slate-400'
                            }`}
                            data-testid={`coverage-group-nature-${group.groupId}-${nature.name}`}
                          >
                            {nature.name}
                            {recommended ? (
                              <span className="ml-0.5 text-emerald-400" aria-hidden>
                                ·
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ) : null}
                {cells.map((cell) => (
                  <li
                    key={`${cell.groupId}-${cell.natureName}-${cell.grade}`}
                    data-testid="coverage-nature-cell"
                    className="space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                  >
                    <div className="flex min-h-[44px] items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-slate-700">
                        <span
                          className={`inline-block h-3 w-3 shrink-0 rounded-full ${COVERAGE_STATE_CHIP[cell.state]}`}
                          aria-hidden
                        />
                        {cell.natureName}
                        {multiGrade ? (
                          <span className="text-xs text-slate-400">{gradeLabel(cell.grade, mode)}</span>
                        ) : null}
                      </span>
                      <span className="text-right text-xs text-slate-500">
                        {COVERAGE_STATE_LABELS[cell.state]}
                      </span>
                    </div>

                    {/* 每格只显示与它当前状态相关的那几只精灵，不写机制解释。
                        可迭代 = 给出**迭代方案**（2026-10-05 用户定稿）：
                        学院小窝那只（自带目标性格，100% 遗传）× 同档位异性。 */}
                    {cell.studs.map((stud) => (
                      <PetRow key={`${stud.account}-${stud.name}-${stud.box}`} label="种公" pet={stud} testId="coverage-cell-stud" />
                    ))}
                    {cell.state === 'breedable' && cell.academyParent && cell.partner ? (
                      <div className="space-y-0.5" data-testid="coverage-cell-academy">
                        <PetRow label="学院小窝" pet={cell.academyParent} />
                        <PetRow label="配对" pet={cell.partner} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
