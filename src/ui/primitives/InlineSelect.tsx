import { useEffect, useId, useRef, useState } from 'react';

export interface ChoiceOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface InlineSelectProps {
  label: string;
  value: string;
  options: readonly ChoiceOption[];
  onValueChange: (value: string) => void;
  /** 触发按钮的 data-testid（保留旧页面的选择器） */
  testId?: string;
  /** 展开面板的 data-testid */
  menuTestId?: string;
  /** 每个选项（可见的 label 元素）的 data-testid */
  optionTestId?: (value: string) => string;
  /** 面板靠哪边展开 */
  align?: 'left' | 'right';
  className?: string;
}

/**
 * 页内展开的单选（2026-10-24 统一控件）。
 *
 * 沿用看板的页内下拉外观（不是系统 select），但补全键盘语义：
 * 按钮展开 → 焦点落在当前项 → 原生 radio 列表（方向键由本组件处理）
 * → 选择 / Esc / 点外关闭并返回焦点。禁用项不可选。
 */
export function InlineSelect({
  label,
  value,
  options,
  onValueChange,
  testId,
  menuTestId,
  optionTestId,
  align = 'left',
  className = '',
}: InlineSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const radios = useRef(new Map<string, HTMLInputElement>());
  const groupName = useId();
  const current = options.find((option) => option.value === value);

  const closeAndRefocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const target =
      radios.current.get(value) ?? [...radios.current.values()].find((input) => !input.disabled);
    target?.focus();
  }, [open, value]);

  const choose = (next: string) => {
    onValueChange(next);
    closeAndRefocus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeAndRefocus();
      return;
    }
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const enabled = options.filter((option) => !option.disabled);
    if (enabled.length === 0) return;
    const index = enabled.findIndex((option) => option.value === value);
    const next = enabled[index < 0 ? 0 : (index + step + enabled.length) % enabled.length];
    if (!next) return;
    onValueChange(next.value);
    radios.current.get(next.value)?.focus();
  };

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className={`relative min-w-0 max-w-full ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-label={`${label}：${current?.label ?? '未选择'}`}
        onClick={() => setOpen((value) => !value)}
        data-testid={testId}
        className="flex min-h-[44px] max-w-full items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-normal text-slate-600"
      >
        <span className="truncate">{current?.label ?? '未选择'}</span>
        <span aria-hidden="true" className="text-[10px] text-slate-400">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open ? (
        <div
          role="radiogroup"
          aria-label={label}
          data-testid={menuTestId}
          className={`absolute top-full z-20 mt-1 max-h-64 w-max max-w-[calc(100vw-4rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {options.map((option) => {
            const on = option.value === value;
            return (
              <label
                key={option.value}
                data-testid={optionTestId?.(option.value)}
                onClick={() => {
                  // 点当前已选项不会触发 change，也要能收起
                  if (on) closeAndRefocus();
                }}
                className={`flex min-h-[44px] w-full cursor-pointer items-center gap-2 truncate rounded-lg px-2 text-left text-xs ${
                  on ? 'bg-emerald-50 font-medium text-emerald-700' : 'text-slate-600'
                } ${option.disabled ? 'cursor-not-allowed text-slate-300' : ''}`}
              >
                <input
                  ref={(input) => {
                    if (input) radios.current.set(option.value, input);
                    else radios.current.delete(option.value);
                  }}
                  type="radio"
                  name={groupName}
                  value={option.value}
                  checked={on}
                  disabled={option.disabled}
                  onChange={() => {
                    // jsdom 里 disabled 的 radio 仍可能触发 change，这里再兜一层
                    if (!option.disabled) choose(option.value);
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
