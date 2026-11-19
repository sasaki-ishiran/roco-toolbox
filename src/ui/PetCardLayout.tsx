import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface PetCardLayoutProps {
  name: string;
  number?: string;
  eggGroups?: readonly string[];
  natures?: readonly string[];
  /** 提供时按「该性格是否已收集」上色：已收集浅绿、未收集灰色；不提供保持原琥珀色 */
  natureCollected?: (nature: string) => boolean;
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
   * - `default`：98px，紧凑卡 / 家园用（文字 6px）；
   * - `tall`：104px，精灵背包用（名字 / 身高体重 / 账号位置放大到 8px，头像略微上移）；
   * - `mother`：106px，收集页母本卡用（62px 头像、12px 名字、底部「查看 / 计划」）；
   * - `gap`：104px，看板「母本缺口 / 种公推荐」四列卡用（52px 头像、12px 名字，
   *   2026-11-19 原型口径：四列不变，头像 44 → 52、名字 6px → 12px）。
   */
  size?: PetCardSize;
  /** 名字过长时从基准字号逐档缩小，避免长名字直接截断（母本卡 / 看板推荐卡用） */
  fitName?: boolean;
  /** 名字基准字号（默认 12；看板种公推荐卡传 9） */
  fitNameBase?: number;
  /** 名字最小字号（默认 9；看板种公推荐卡传 8） */
  fitNameMin?: number;
  /** 精灵背包传性别：母粉 / 公蓝 / 未知灰，底色与边框都和配窝卡一致 */
  gender?: '公' | '母' | '未知';
  onClick?: () => void;
  ariaPressed?: boolean;
}

export type PetCardSize = 'default' | 'tall' | 'mother' | 'gap' | 'suggest';

/** Shared card frame for pet displays across the app. */
export function PetCardLayout({
  name,
  number,
  eggGroups = [],
  natures = [],
  natureCollected,
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
  fitName = false,
  fitNameBase,
  fitNameMin,
  gender,
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
  const mother = size === 'mother';
  /** 看板四列缺口卡：52px 头像 + 12px 名字（2026-11-19 原型） */
  const gap = size === 'gap';
  /** 看板「种公推荐」卡：44px 头像居中、名字 9px（2026-11-19 用户口径） */
  const suggest = size === 'suggest';
  /** 与配窝卡（NestPlanCard）同一套性别色：母粉、公蓝、未知灰；不传保持母本绿 */
  const genderTone =
    gender === '母'
      ? 'border-pink-200 bg-pink-50'
      : gender === '公'
        ? 'border-sky-200 bg-sky-50'
        : gender === '未知'
          ? 'border-slate-200 bg-slate-50'
          : 'border-emerald-300 bg-emerald-50/60';
  const nameRef = useRef<HTMLHeadingElement | null>(null);
  const nameTextRef = useRef<HTMLSpanElement | null>(null);

  /**
   * 母本卡名字：默认 12px，只有超出卡片宽度时才逐档缩到 9px。
   * 用元素实测宽度而不是按字数猜，375 / 390 屏宽切换都能各自贴合。
   */
  useLayoutEffect(() => {
    if (!fitName) return;
    const heading = nameRef.current;
    const text = nameTextRef.current;
    if (!heading || !text) return;
    const fit = () => {
      const base = fitNameBase ?? 12;
      text.style.fontSize = `${base}px`;
      // 先放开宽度量出文字自然宽度，再交给 truncate 兜底
      text.style.maxWidth = 'none';
      text.style.width = 'max-content';
      text.style.flexShrink = '0';
      const width = text.getBoundingClientRect().width;
      text.style.width = '';
      text.style.flexShrink = '';
      text.style.maxWidth = '';
      const available = heading.clientWidth;
      if (width > 0 && available > 0 && width > available) {
        const scaled = Math.max(
          fitNameMin ?? 9,
          Math.floor(((base * available) / width) * 2) / 2,
        );
        text.style.fontSize = `${scaled}px`;
      }
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(heading);
    return () => observer.disconnect();
  }, [fitName, name, size]);

  return (
    <article
      className={`relative ${mother ? 'h-[106px]' : tall || gap ? 'h-[104px]' : 'h-[98px]'} min-w-0 overflow-hidden rounded-xl border ${genderTone} p-1 shadow-sm ${onClick ? 'cursor-pointer hover:border-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500' : ''} ${className}`}
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
                  className={`inline-flex h-3 max-w-full items-center truncate rounded px-0.5 py-0 font-medium ${
                    natureCollected
                      ? natureCollected(nature)
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-400'
                      : 'bg-amber-100 text-amber-900'
                  }`}
                  data-nature-collected={
                    natureCollected ? (natureCollected(nature) ? 'true' : 'false') : undefined
                  }
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
        className={`absolute left-1/2 z-0 flex -translate-x-1/2 items-center justify-center ${
          mother
            ? 'top-[9px] h-[62px] w-[62px]'
            : gap
              ? 'top-[8px] h-[52px] w-[52px]'
              : tall
                ? 'top-[16px] h-11 w-11'
                : 'top-1/2 h-11 w-11 -translate-y-1/2'
        }`}
        data-testid="pet-card-avatar"
      >
        {avatar}
      </div>

      <h3
        ref={nameRef}
        className={`absolute ${mother ? 'inset-x-0.5' : 'inset-x-1'} flex items-center justify-center truncate text-center text-slate-900 ${
          mother ? 'font-medium' : 'font-bold'
        } ${
          mother
            ? 'top-[72px] h-[14px] text-[12px] leading-[14px]'
            : gap
              ? 'top-[64px] h-4 text-[12px] leading-4'
              : suggest
                ? 'top-[72px] h-[12px] text-[9px] leading-3'
                : tall
                  ? 'top-[62px] h-2.5 text-[8px] leading-[10px]'
                  : 'top-[70px] h-2 text-[6px] leading-2'
        }`}
        title={title ?? name}
      >
        {fitName ? (
          <span
            ref={nameTextRef}
            className="inline-block max-w-full truncate whitespace-nowrap"
            data-testid="pet-card-name"
          >
            {name}
          </span>
        ) : (
          name
        )}
      </h3>

      {showDetails ? (
        <div
          className={`absolute inset-x-1 flex items-center justify-center overflow-hidden text-center ${
            mother ? 'top-[90px] h-2' : gap ? 'top-[84px] h-2.5' : tall ? 'top-[74px] h-2.5' : 'top-[80px] h-2'
          }`}
        >
          {details}
        </div>
      ) : null}

      {showFooter ? (
        <div
          className={`absolute inset-x-1 flex items-center justify-center ${
            mother ? 'bottom-[3px] h-3' : gap ? 'bottom-[4px] h-3' : tall ? 'top-[88px] h-2.5' : 'bottom-1 h-1.5'
          }`}
        >
          {footer}
        </div>
      ) : null}
    </article>
  );
}
