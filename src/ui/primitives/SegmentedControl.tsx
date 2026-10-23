import type { ChoiceOption } from './InlineSelect';

export interface SegmentedControlProps {
  label: string;
  value: string;
  options: readonly ChoiceOption[];
  onValueChange: (value: string) => void;
  /** 每个分段的 data-testid */
  optionTestId?: (value: string) => string;
  className?: string;
}

/**
 * 互斥视角分段（2026-10-24 统一控件）。
 *
 * 用具名 group + aria-pressed，不用实现不完整的 tablist：
 * 一个分段只表示一种互斥视角，不把不同维度混成一排。
 */
export function SegmentedControl({
  label,
  value,
  options,
  onValueChange,
  optionTestId,
  className = '',
}: SegmentedControlProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex gap-1 rounded-xl bg-slate-100 p-1 ${className}`}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            disabled={option.disabled}
            onClick={() => onValueChange(option.value)}
            data-testid={optionTestId?.(option.value)}
            className={`min-h-[44px] flex-1 rounded-lg px-2 text-xs disabled:cursor-not-allowed disabled:text-slate-300 ${
              on ? 'bg-white font-medium text-emerald-700 shadow-sm' : 'text-slate-500'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
