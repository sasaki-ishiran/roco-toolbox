import { useState } from 'react';
import { ALL_EGG_GROUP_IDS, type CoverageFilter } from '../domain/coverageTargets';
import { gradeLabel } from '../domain/petFilters';
import { eggGroupNames } from '../data/catalog';
import { useTargetMode } from './targetModeStore';

export interface CoverageFilterBarProps {
  filter: CoverageFilter;
  onToggleGroup: (groupId: number) => void;
  onReset: () => void;
}

const CHIP_ON = 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700';
const CHIP_OFF = 'border-slate-200 bg-white text-slate-500';
const CHIP_BASE = 'min-h-[32px] rounded-full border px-2.5 text-xs';

const chipClass = (active: boolean): string => `${CHIP_BASE} ${active ? CHIP_ON : CHIP_OFF}`;

/**
 * 覆盖矩阵的筛选条：档位（只读，跟随看板）+ 蛋组（默认收起）。
 *
 * **档位 2026-10-06 起是全局口径**（用户拍板）：看板 / 覆盖度 / 母本 / 配窝共用一份，
 * 入口只在看板的「当前模式」，这里只显示当前值，避免两处各有一套、看着像两码事。
 *
 * 性格不在这里——「每组推荐前 3」这个预设只在**组内**有意义（部分性格在部分组几乎没用），
 * 所以它下沉到蛋组展开区，由 CoverageMatrix 渲染，不再有「对所有组一起加减」的全局开关。
 */
export function CoverageFilterBar({ filter, onToggleGroup, onReset }: CoverageFilterBarProps) {
  const [groupsOpen, setGroupsOpen] = useState(false);
  const mode = useTargetMode();
  const groupCount = filter.groupIds.length;
  const gradeText = filter.grades.map((grade) => gradeLabel(grade, mode)).join('、');

  const emptyDimensions = [
    groupCount === 0 ? '蛋组' : null,
    filter.grades.length === 0 ? '档位' : null,
  ].filter((label): label is string => label !== null);

  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="coverage-filter">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium text-slate-500">筛选</h2>
        <button
          type="button"
          onClick={onReset}
          className="min-h-[28px] text-xs font-medium text-emerald-700"
          data-testid="coverage-filter-reset"
        >
          恢复默认
        </button>
      </div>

      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="coverage-grade-readonly">
          <span className="text-xs text-slate-400">档位</span>
          <span className="text-xs font-medium text-slate-600">{gradeText || '未选'}</span>
          <span className="text-[11px] text-slate-400">跟随看板「当前模式」</span>
        </div>

        <div>
          <button
            type="button"
            aria-expanded={groupsOpen}
            onClick={() => setGroupsOpen((open) => !open)}
            className="flex min-h-[32px] w-full items-center justify-between text-xs text-slate-400"
            data-testid="coverage-groups-toggle"
          >
            <span>蛋组（{groupCount}/14）</span>
            <span aria-hidden>{groupsOpen ? '▲' : '▼'}</span>
          </button>
          {groupsOpen ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ALL_EGG_GROUP_IDS.map((groupId) => (
                <button
                  key={groupId}
                  type="button"
                  aria-pressed={filter.groupIds.includes(groupId)}
                  onClick={() => onToggleGroup(groupId)}
                  className={chipClass(filter.groupIds.includes(groupId))}
                  data-testid={`coverage-group-${groupId}`}
                >
                  {eggGroupNames[groupId] ?? `蛋组${groupId}`}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {emptyDimensions.length > 0 ? (
        <p className="mt-2 text-xs text-amber-600" data-testid="coverage-filter-empty">
          请至少勾选一个{emptyDimensions.join('、')}，否则没有目标槽位。
        </p>
      ) : null}
    </section>
  );
}
