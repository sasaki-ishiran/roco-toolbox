import type { KeyboardEvent, ReactNode } from 'react';

export interface PetCardLayoutProps {
  name: string;
  number?: string;
  eggGroups?: readonly string[];
  natures?: readonly string[];
  naturePrefix?: ReactNode;
  natureAdornment?: ReactNode;
  /** 蛋组下方的小徽标（如稀有度图标，2026-11-17 用户口径） */
  badge?: ReactNode;
  avatar: ReactNode;
  details?: ReactNode;
  footer?: ReactNode;
  testId?: string;
  eggGroupsTestId?: string;
  naturesTestId?: string;
  title?: string;
  ariaLabel?: string;
  className?: string;
  academy?: boolean;
  /**
   * 卡片高度档位。
   * - `default`：98px，紧凑卡 / 母本 / 家园用（文字 6px）；
   * - `tall`：104px，精灵背包用（名字 / 身高体重 / 账号位置放大到 8px，头像略微上移）。
   */
  size?: PetCardSize;
  onClick?: () => void;
  ariaPressed?: boolean;
}

export type PetCardSize = 'default' | 'tall';

/** Shared card frame for pet displays across the app. */
export function PetCardLayout({
  name,
  number,
  eggGroups = [],
  natures = [],
  naturePrefix,
  natureAdornment,
  badge,
  avatar,
  details,
  footer,
  testId,
  eggGroupsTestId = 'pet-card-egg-groups',
  naturesTestId = 'pet-card-natures',
  title,
  ariaLabel,
  className = '',
  academy,
  size = 'default',
  onClick,
  ariaPressed,
}: PetCardLayoutProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onClick || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onClick();
  };
  const showDetails = details != null && details !== false;
  const showFooter = footer != null && footer !== false;
  const tall = size === 'tall';

  return (
    <article
      className={`relative ${tall ? 'h-[104px]' : 'h-[98px]'} min-w-0 overflow-hidden rounded-xl border border-emerald-300 bg-emerald-50/60 p-1 shadow-sm ${onClick ? 'cursor-pointer hover:border-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500' : ''} ${className}`}
      data-testid={testId}
      data-academy={academy ? 'true' : undefined}
      title={title}
      aria-label={ariaLabel}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? ariaPressed : undefined}
      onClick={onClick}
      onKeyDown={onClick ? handleKeyDown : undefined}
    >
      <header className="absolute inset-x-1 top-1 z-10 grid max-h-[48px] grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] items-start overflow-hidden text-[7px] leading-[8px]">
        <div className="flex min-w-0 flex-col items-start gap-px">
          {number ? (
            <span className="truncate font-semibold text-slate-500">No.{number}</span>
          ) : (
            <span className="h-2" aria-hidden />
          )}
          <span className="flex min-w-0 flex-col items-start gap-px" data-testid={eggGroupsTestId}>
            {eggGroups.map((group) => (
              <span
                key={group}
                className="max-w-full truncate rounded bg-sky-100 px-0.5 py-0 text-sky-800"
                title={group}
              >
                {group}
              </span>
            ))}
          </span>
          {badge ? <span className="flex min-w-0 items-start">{badge}</span> : null}
        </div>
        <div className="col-start-3 row-start-1 flex min-w-0 flex-col items-end gap-px">
          <div className="flex min-w-0 items-center justify-end gap-px">
            {naturePrefix}
            <span className="flex min-w-0 flex-col items-end gap-px" data-testid={naturesTestId}>
              {natures.map((nature) => (
                <span
                  key={nature}
                  className="inline-flex h-3 max-w-full items-center truncate rounded bg-amber-100 px-0.5 py-0 font-medium text-amber-900"
                  title={nature}
                >
                  {nature}
                </span>
              ))}
            </span>
          </div>
          {natureAdornment}
        </div>
      </header>

      <div
        className={`absolute left-1/2 z-0 flex h-11 w-11 -translate-x-1/2 items-center justify-center ${
          tall ? 'top-[16px]' : 'top-1/2 -translate-y-1/2'
        }`}
        data-testid="pet-card-avatar"
      >
        {avatar}
      </div>

      <h3
        className={`absolute inset-x-1 flex items-center justify-center truncate text-center font-bold text-slate-900 ${
          tall ? 'top-[62px] h-2.5 text-[8px] leading-[10px]' : 'top-[70px] h-2 text-[6px] leading-2'
        }`}
        title={title ?? name}
      >
        {name}
      </h3>

      {showDetails ? (
        <div
          className={`absolute inset-x-1 flex items-center justify-center overflow-hidden text-center ${
            tall ? 'top-[74px] h-2.5' : 'top-[80px] h-2'
          }`}
        >
          {details}
        </div>
      ) : null}

      {showFooter ? (
        <div
          className={`absolute inset-x-1 flex items-center justify-center ${
            tall ? 'top-[88px] h-2.5' : 'bottom-1 h-1.5'
          }`}
        >
          {footer}
        </div>
      ) : null}
    </article>
  );
}
