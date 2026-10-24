import type { ButtonHTMLAttributes } from 'react';
import { BUTTON_MD, BUTTON_SM } from './styles';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';
export type ButtonSize = 'md' | 'sm';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-emerald-600 text-white active:bg-emerald-700',
  secondary: 'border border-slate-200 bg-white text-slate-600',
  text: 'text-emerald-700',
  danger: 'border border-rose-200 bg-white text-rose-600',
};

const SIZE: Record<ButtonSize, string> = {
  md: BUTTON_MD,
  sm: BUTTON_SM,
};

/** 四层动作层级（主 / 次 / 文字 / 危险），统一 md 36px / sm 32px 尺寸与禁用、忙碌态。 */
export function Button({
  variant = 'primary',
  size = 'md',
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
      className={`${SIZE[size]} disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${className}`}
    >
      {busy ? '处理中…' : children}
    </button>
  );
}
