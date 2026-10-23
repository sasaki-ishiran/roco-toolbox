import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  busy?: boolean;
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-emerald-600 text-white active:bg-emerald-700',
  secondary: 'border border-slate-200 bg-white text-slate-600',
  text: 'text-emerald-700',
  danger: 'border border-rose-200 bg-white text-rose-600',
};

/** 四层动作层级（主 / 次 / 文字 / 危险），统一 44px 触区、禁用与忙碌态。 */
export function Button({
  variant = 'primary',
  busy = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-[44px] items-center justify-center gap-1 rounded-xl px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${className}`}
    >
      {busy ? '处理中…' : children}
    </button>
  );
}
