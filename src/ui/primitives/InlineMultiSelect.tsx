import { useEffect, useRef, useState } from 'react';
import type { ChoiceOption } from './InlineSelect';

export interface InlineMultiSelectProps {
  label: string;
  /** 空数组 = 全选（所有选项） */
  values: readonly string[];
  options: readonly ChoiceOption[];
  onValuesChange: (values: string[]) => void;
  /** 一个都没选时按钮上显示的文案，同时作为「全选」项 */
  allLabel?: string;
  testId?: string;
  menuTestId?: string;
  optionTestId?: (value: string) => string;
  align?: 'left' | 'right';
  className?: string;
}

/**
 * 页内展开的多选（2026-10-25「共同寻找」用）。
 *
 * 与 InlineSelect 同一套外观与关闭语义，但面板里的选项是 checkbox：
 * 连续勾选不会收起面板，方便一次选好几个人；「全部成员」= 清空选择。
 */
export function InlineMultiSelect({
  label,
  values,
  options,
  onValuesChange,
  allLabel = '全部成员',
  testId,
  menuTestId,
  optionTestId,
  align = 'left',
  className = '',
}: InlineMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = new Set(values);
  const chosen = options.filter((option) => selected.has(option.value));
  const summary =
    chosen.length === 0
      ? allLabel
      : chosen.length <= 2
        ? chosen.map((option) => option.label).join('、')
        : `${chosen.length} 人`;

  const closeAndRefocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('button, a[href], input, select, textarea, [tabindex], label')) {
        event.preventDefault();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // 保持选项顺序，避免选择顺序影响记忆结果
    onValuesChange(options.filter((option) => next.has(option.value)).map((option) => option.value));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeAndRefocus();
    }
  };

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className={`relative min-w-0 max-w-full ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-label={`${label}：${summary}`}
        onClick={() => setOpen((value) => !value)}
        data-testid={testId}
        className="flex min-h-[32px] max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-normal text-slate-600"
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden="true" className="text-[10px] text-slate-400">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open ? (
        <div
          role="group"
          aria-label={label}
          data-testid={menuTestId}
          className={`absolute top-full z-20 mt-1 max-h-64 w-max max-w-[calc(100vw-4rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <label
            data-testid={optionTestId?.('')}
            className={`flex min-h-[36px] w-full cursor-pointer items-center gap-2 truncate rounded-md px-2 text-left text-xs ${
              chosen.length === 0 ? 'bg-emerald-50 font-medium text-emerald-700' : 'text-slate-600'
            }`}
          >
            <input
              type="checkbox"
              checked={chosen.length === 0}
              onChange={() => onValuesChange([])}
              className="h-3.5 w-3.5 shrink-0 accent-emerald-600"
            />
            <span className="truncate">{allLabel}</span>
          </label>
          {options.map((option) => {
            const on = selected.has(option.value);
            return (
              <label
                key={option.value}
                data-testid={optionTestId?.(option.value)}
                className={`flex min-h-[36px] w-full cursor-pointer items-center gap-2 truncate rounded-md px-2 text-left text-xs ${
                  on ? 'bg-emerald-50 font-medium text-emerald-700' : 'text-slate-600'
                } ${option.disabled ? 'cursor-not-allowed text-slate-300' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={option.disabled}
                  onChange={() => {
                    if (!option.disabled) toggle(option.value);
                  }}
                  className="h-3.5 w-3.5 shrink-0 accent-emerald-600"
                />
                <span className="truncate">{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
