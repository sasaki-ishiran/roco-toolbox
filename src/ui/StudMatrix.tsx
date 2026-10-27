import { useMemo, useState } from 'react';
import type { PetGrade, TargetMode } from '../domain/petFilters';
import {
  buildStudMatrix,
  representativeOf,
  studMatrixPickKey,
  type StudMatrixCell,
  type StudMatrixPet,
} from '../domain/studMatrix';
import type { CoverageSlot } from '../domain/studCoverage';
import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { PetAvatar } from './PetAvatar';
import { clearStudMatrixPick, setStudMatrixPick, useStudMatrixPicks } from './studMatrixStore';

const GRADE_LABEL: Record<PetGrade, string> = {
  大婉: '大婉',
  小婉: '小婉',
  大粗: '大粗',
  小粗: '小粗',
};

export interface StudMatrixProps {
  /** 覆盖度槽位（蛋组 × 目标性格 × 档位），来自全局筛选 */
  slots: CoverageSlot[];
  owned: OwnedPet[];
  species: SpeciesEntry[];
  speciesByGameId: Map<number, SpeciesEntry>;
  eggGroupNames: Record<number, string>;
  mode: TargetMode;
}

interface PickerState {
  grade: PetGrade;
  cell: StudMatrixCell;
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
  const [picker, setPicker] = useState<PickerState | null>(null);

  if (grades.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="stud-matrix-empty">
        <h2 className="text-sm font-medium text-slate-500">种公阵列</h2>
        <p className="mt-1 text-xs text-slate-400">
          覆盖度里还没选目标档位，先到「覆盖度」勾选要追的档位与性格。
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="stud-matrix">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-slate-500">种公阵列</h2>
          <p className="mt-0.5 text-[10px] text-slate-400">
            跟随「覆盖度」目标 · 左右滑动看更多性格 · 点带数字的格子可换代表种公
          </p>
        </div>
        <div className="flex shrink-0 gap-1" role="group" aria-label="阵列档位">
          {grades.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setActiveGrade(item)}
              aria-pressed={item === grade}
              data-testid={`stud-matrix-grade-${item}`}
              className={`rounded-md px-1.5 text-[10px] leading-[1.6] ${
                item === grade
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {GRADE_LABEL[item]}
            </button>
          ))}
        </div>
      </header>

      {matrix.natures.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400" data-testid="stud-matrix-no-nature">
          当前档位下没有选中的目标性格。
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto overscroll-x-contain touch-pan-x" data-testid="stud-matrix-scroll">
          <table className="border-separate border-spacing-0 text-[10px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[56px] whitespace-nowrap bg-white px-1 pb-1 text-left font-normal text-slate-400">
                  蛋组 / 性格
                </th>
                {matrix.natures.map((nature) => (
                  <th
                    key={nature}
                    className="min-w-[64px] px-0.5 pb-1 text-center font-medium text-slate-500"
                  >
                    {nature}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.groupId}>
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-white px-1 py-0.5 text-left text-[10px] font-normal text-slate-500">
                    {row.groupLabel}
                  </th>
                  {row.cells.map((cell) => (
                    <td key={cell.natureName} className="p-0.5 align-top">
                      <MatrixCell
                        cell={cell}
                        grade={grade}
                        picks={picks}
                        onOpen={() => setPicker({ grade, cell })}
                      />
                    </td>
                  ))}
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
    </section>
  );
}

function MatrixCell({
  cell,
  grade,
  picks,
  onOpen,
}: {
  cell: StudMatrixCell;
  grade: PetGrade;
  picks: Record<string, string>;
  onOpen: () => void;
}) {
  if (!cell.targeted) {
    return (
      <span className="flex h-[58px] items-center justify-center rounded bg-slate-50 text-slate-300">
        —
      </span>
    );
  }
  const rep = representativeOf(cell, picks, grade);
  if (!rep) {
    return (
      <span
        className="flex h-[58px] items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400"
        data-testid={`stud-cell-empty-${cell.groupId}-${cell.natureName}`}
      >
        缺
      </span>
    );
  }
  const count = cell.candidates.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${cell.natureName} 种公 ${rep.name}，共 ${count} 只，点击选择代表`}
      data-testid={`stud-cell-${cell.groupId}-${cell.natureName}`}
      className="flex w-full flex-col items-center rounded bg-emerald-50/50 px-0.5 pb-0.5 pt-1 ring-1 ring-inset ring-emerald-100"
    >
      <PetAvatar
        gameId={rep.gameId}
        name={rep.name}
        shiny={rep.isShiny || rep.isColorful}
        size={32}
      />
      <span className="mt-0.5 w-full truncate text-center text-[9px] leading-tight text-slate-700">
        {rep.name}
      </span>
      {count > 1 ? (
        <span
          className="text-[9px] leading-tight text-slate-400"
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
  const key = studMatrixPickKey(grade, cell.groupId, cell.natureName);
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
                    shiny={pet.isShiny || pet.isColorful}
                    size={32}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-800">{pet.name}</span>
                    <span className="block text-[10px] text-slate-500">
                      {pet.account} · {pet.weightPercent != null ? `${Math.round(pet.weightPercent)}%` : '—'}
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
