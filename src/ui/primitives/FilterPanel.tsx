import type { ReactNode } from 'react';
import { TOOL_CARD } from './styles';

export interface FilterPanelProps {
  title: string;
  /** 常显摘要（未选时写「不限」等单位自己的语义） */
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClear?: () => void;
  clearLabel?: string;
  /** 紧凑档：贴在搜索框下面时上下留白更小（精灵背包用） */
  dense?: boolean;
  testId?: string;
  toggleTestId?: string;
  clearTestId?: string;
  summaryTestId?: string;
  children: ReactNode;
}

/**
 * 可折叠的本页筛选工具区（2026-10-24 统一控件）。
 *
 * 只负责展开收起、摘要与清除按钮的外观；「清除」清什么由页面决定
 * （不能清目标、计划、复制勾选或发布草稿）。
 */
export function FilterPanel({
  title,
  summary,
  open,
  onOpenChange,
  onClear,
  clearLabel = '清除',
  dense = false,
  testId,
  toggleTestId,
  clearTestId,
  summaryTestId,
  children,
}: FilterPanelProps) {
  return (
    <section
      className={dense ? 'rounded-xl bg-white px-2 pb-2 pt-0.5 shadow-sm' : TOOL_CARD}
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          data-testid={toggleTestId}
          className="min-h-[28px] text-xs font-medium text-emerald-700"
        >
          {title}
          <span aria-hidden="true" className="ml-1 text-[10px] text-slate-400">
            {open ? '▲' : '▼'}
          </span>
        </button>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            data-testid={clearTestId}
            className="min-h-[28px] px-2 text-xs text-slate-500"
          >
            {clearLabel}
          </button>
        ) : null}
      </div>
      {summary ? (
        <p className="mt-0.5 text-xs text-slate-500" data-testid={summaryTestId}>
          {summary}
        </p>
      ) : null}
      {open ? <div className="mt-2 space-y-2.5">{children}</div> : null}
    </section>
  );
}
