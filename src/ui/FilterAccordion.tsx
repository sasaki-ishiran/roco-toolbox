import { useState } from 'react';

export interface AccordionOption<V extends string> {
  value: V;
  label: string;
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
}

/**
 * 手风琴式筛选（2026-10-05 用户拍板）：
 * - 维度头部瓦片网格（每行 3 个），点击展开该维度、自动收起其它维度（互斥）；
 * - 点选项**不自动收起**（同一维度内可连续多选），点头部或切换其它维度才收起；
 * - 头部右侧：未选显示淡色小号「不限」，已选显示绿色数字徽章；
 * - 展开面板从网格下方滑出（连接式下拉），带「清除本组」。
 */
export function FilterAccordion({
  dimensions,
  emptyHint = '不限',
}: {
  dimensions: AccordionDimension<string>[];
  emptyHint?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = dimensions.find((d) => d.id === activeId) ?? null;

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {dimensions.map((d) => {
          const open = d.id === activeId;
          return (
            <button
              key={d.id}
              type="button"
              aria-expanded={open}
              onClick={() => setActiveId(open ? null : d.id)}
              data-testid={`filter-tile-${d.id}`}
              className={`relative flex min-h-[44px] items-center justify-between gap-1.5 rounded-xl border px-2.5 py-2 text-left transition ${
                open
                  ? 'border-emerald-100 bg-emerald-50'
                  : 'border-transparent bg-slate-50 active:scale-[.97]'
              }`}
            >
              <span
                className={`text-xs ${
                  open ? 'font-semibold text-emerald-600' : 'font-medium text-slate-600'
                }`}
              >
                {d.label}
              </span>
              <span className="flex items-center gap-1">
                {d.selected.length === 0 ? (
                  <span className="text-[11px] font-normal text-slate-300">{emptyHint}</span>
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
        <div className="mt-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm" data-testid={`filter-panel-${active.id}`}>
          <div className="flex items-center justify-between px-0.5 pb-2">
            <span className="text-xs font-medium text-slate-700">{active.label}</span>
            <button
              type="button"
              onClick={active.onClear}
              className="text-[11px] font-medium text-emerald-600"
              data-testid={`filter-clear-${active.id}`}
            >
              清除本组
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
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
                  className={`rounded-full px-3 py-1.5 text-xs transition active:scale-95 disabled:cursor-not-allowed ${
                    on
                      ? 'bg-emerald-500 font-semibold text-white shadow'
                      : 'bg-slate-100 font-medium text-slate-500 disabled:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}