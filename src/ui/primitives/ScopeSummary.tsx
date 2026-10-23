export interface ScopeSummaryProps {
  /** 这条条件属于谁 / 哪个范围（如「我的母本达标条件」「种公目标」） */
  scope: string;
  criteria?: string;
  /** 数据来源时间（如「上次导入 10/24 12:00」） */
  sourceTime?: string;
  onEdit?: () => void;
}

/**
 * 范围 / 条件摘要（2026-10-24 统一控件）：主语与作用范围必须写清。
 * 只展示传入的事实，不推断收集状态。
 */
export function ScopeSummary({ scope, criteria, sourceTime, onEdit }: ScopeSummaryProps) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-sm font-semibold text-slate-900">{scope}</span>
      {criteria ? <span className="text-xs text-slate-500">{criteria}</span> : null}
      {sourceTime ? <span className="text-[11px] text-slate-400">数据：{sourceTime}</span> : null}
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="min-h-[44px] px-1 text-xs font-medium text-emerald-700"
        >
          调整
        </button>
      ) : null}
    </div>
  );
}
