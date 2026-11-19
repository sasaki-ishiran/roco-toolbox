import { useState } from 'react';
import type { ReactNode } from 'react';

export interface AccordionOption<V extends string> {
  value: V;
  label: string;
  icon?: ReactNode;
  /** 无命中时置灰不可点（如 count 为 0 的标签） */
  disabled?: boolean;
}

export interface AccordionDimension<V extends string> {
  /** 稳定 id，用于手风琴互斥展开 */
  id: string;
  label: string;
  options: AccordionOption<V>[];
  selected: V[];
  onToggle: (value: V) => void;
  onClear: () => void;
  headerActions?: ReactNode;
  /** 独占一行的附加控件（如蛋组筛选的「多选 / 双组」），排在选项网格上方 */
  actionsRow?: ReactNode;
  content?: ReactNode;
  centerOptions?: boolean;
  columns?: 3 | 4 | 5;
  hideClear?: boolean;
  fullWidth?: boolean;
}

/**
 * 手风琴式筛选（2026-10-05 用户拍板）：
 * - 维度头部瓦片网格（每行 3 个），点击展开该维度、自动收起其它维度（互斥）；
 * - 点选项**不自动收起**（同一维度内可连续多选），点头部或切换其它维度才收起；
 * - 头部右侧：未选显示淡色小号「不限」，已选显示绿色数字徽章；
 * - 默认面板展示在网格下方；popover 模式绝对定位，不挤压筛选行，带「清除本组」。
 */
export function FilterAccordion({
  dimensions,
  emptyHint = '不限',
  inline = false,
  popover = false,
  centered = false,
}: {
  dimensions: AccordionDimension<string>[];
  emptyHint?: string;
  inline?: boolean;
  popover?: boolean;
  centered?: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = dimensions.find((d) => d.id === activeId) ?? null;

  return (
    <div className={inline ? 'min-w-0 flex-1' : ''}>
      <div className={inline ? 'grid grid-cols-2 gap-1' : 'grid grid-cols-3 gap-2'}>
        {dimensions.map((d) => {
          const open = d.id === activeId;
          return (
            <button
              key={d.id}
              type="button"
              aria-expanded={open}
              onClick={() => setActiveId(open ? null : d.id)}
              data-testid={`filter-tile-${d.id}`}
              className={`relative flex items-center ${
                centered ? 'justify-center' : 'justify-between'
              } rounded-lg border text-left transition ${
                inline
                  ? 'min-h-[28px] gap-1 px-2 py-1'
                  : 'min-h-[36px] gap-1.5 px-2.5 py-1.5'
              } ${
                open
                  ? 'border-emerald-100 bg-emerald-50'
                  : 'border-transparent bg-slate-50 active:scale-[.97]'
              } ${d.fullWidth ? (inline ? 'col-span-2' : 'col-span-3') : ''}`}
            >
              <span
                className={`${inline ? 'text-[10px]' : 'text-xs'} ${
                  open ? 'font-semibold text-emerald-600' : 'font-medium text-slate-600'
                }`}
              >
                {d.label}
              </span>
              <span className="flex items-center gap-1">
                {d.selected.length === 0 ? (
                  <span className="text-[9px] font-normal text-slate-300">{emptyHint}</span>
                ) : (
                  <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold text-white">
                    {d.selected.length}
                  </span>
                )}
                <span className={`text-[10px] text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`}>
                  ▼
                </span>
              </span>
              {open ? (
                <span className="absolute bottom-1.5 left-3 right-3 h-0.5 rounded-full bg-emerald-500" aria-hidden />
              ) : null}
            </button>
          );
        })}
      </div>

      {active ? (
        <div
          className={`rounded-2xl border border-slate-100 bg-white shadow-sm ${
            popover
              ? 'absolute left-1/2 right-auto top-full z-30 mt-1.5 w-[calc(100vw-2rem)] max-w-[28rem] -translate-x-1/2 max-h-[70vh] overflow-y-auto p-2 shadow-xl'
              : inline
                ? 'mt-1.5 p-2'
                : 'mt-2 p-3'
          }`}
          data-testid={`filter-panel-${active.id}`}
        >
          {!popover || active.headerActions || !active.hideClear ? (
            <div
              className={`relative flex items-center px-0.5 ${
                centered ? 'justify-center' : 'justify-between'
              } ${inline ? 'pb-1' : 'pb-2'}`}
            >
              {!popover ? (
                <span className="text-xs font-medium text-slate-700">{active.label}</span>
              ) : null}
              {active.headerActions ? (
                <div
                  className={`flex items-center gap-1 ${
                    centered ? 'absolute left-1/2 -translate-x-1/2' : ''
                  }`}
                >
                  {active.headerActions}
                </div>
              ) : null}
              {!active.hideClear ? (
                <button
                  type="button"
                  onClick={active.onClear}
                  className={`text-[11px] font-medium text-emerald-600 ${
                    centered ? 'absolute right-0' : ''
                  }`}
                  data-testid={`filter-clear-${active.id}`}
                >
                  清除
                </button>
              ) : null}
            </div>
          ) : null}
          {active.actionsRow ? (
            <div className="mb-2 w-full" data-testid={`filter-actions-${active.id}`}>
              {active.actionsRow}
            </div>
          ) : null}
          {active.content ?? (
            <div
              className={
                active.columns
                  ? `grid ${inline ? 'gap-1' : 'gap-2'} ${
                      active.centerOptions ? 'justify-items-center' : ''
                    } ${OPTION_GRID_CLASSES[active.columns]}`
                  : `flex flex-wrap ${inline ? 'gap-1' : 'gap-2'} ${
                      active.centerOptions ? 'justify-center' : ''
                    }`
              }
            >
              {active.options.map((opt) => {
                const on = active.selected.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={on}
                    disabled={opt.disabled}
                    onClick={() => active.onToggle(opt.value)}
                    data-testid={`filter-opt-${active.id}-${opt.value}`}
                    className={`min-w-0 rounded-md border transition active:scale-95 disabled:cursor-not-allowed ${
                      inline
                        ? 'min-h-[26px] px-2 py-1 text-[10px]'
                        : 'min-h-[28px] px-2 py-1 text-xs'
                    } ${
                      active.columns ? 'flex items-center justify-center gap-1 truncate px-1' : ''
                    } ${
                      on
                        ? 'bg-emerald-500 font-semibold text-white shadow'
                        : 'bg-slate-100 font-medium text-slate-500 disabled:text-slate-300'
                    }`}
                  >
                    {opt.icon}
                    <span className={active.columns ? 'truncate' : ''}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

const OPTION_GRID_CLASSES: Record<3 | 4 | 5, string> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};