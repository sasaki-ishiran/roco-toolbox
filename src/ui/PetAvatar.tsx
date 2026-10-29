import { useState } from 'react';
import { petAvatarUrl } from '../domain/petAvatar';

/** 尺寸只允许这几档，用静态类名（Tailwind 不能拼字符串） */
export type PetAvatarSize = 20 | 24 | 32 | 40 | 56 | 72;

const SIZE_CLASS: Record<PetAvatarSize, string> = {
  20: 'h-5 w-5 text-[10px]',
  24: 'h-6 w-6 text-[11px]',
  32: 'h-8 w-8 text-sm',
  40: 'h-10 w-10 text-sm',
  56: 'h-14 w-14 text-lg',
  72: 'h-[4.5rem] w-[4.5rem] text-xl',
};

export interface PetAvatarProps {
  gameId: number | null | undefined;
  /** 加载失败时用它的首字占位 */
  name: string;
  /** 异色 / 炫彩 / 异色炫彩 → 异色图（`icon_yise.png`） */
  shiny?: boolean;
  size?: PetAvatarSize;
  className?: string;
}

/**
 * 精灵头像（官方 CDN，透明 PNG）。纯装饰（`alt=""`），可访问名称由旁边的文字承担。
 *
 * 兜底两段：异色图 404 → 先退回普通头像；普通头像也失败（官方未收录的新精灵）
 * → 名字首字占位，不留破图。所有列表/卡片统一用它，不要各处自己拼 URL。
 */
export function PetAvatar({ gameId, name, shiny = false, size = 32, className = '' }: PetAvatarProps) {
  const [stage, setStage] = useState<'primary' | 'normal' | 'fallback'>('primary');
  const sizeClass = SIZE_CLASS[size];
  const url =
    stage === 'fallback'
      ? null
      : petAvatarUrl(gameId, stage === 'primary' && shiny ? 'shiny' : 'normal');

  if (!url) {
    return (
      <span
        data-testid="pet-avatar-fallback"
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center rounded-md bg-slate-100 font-semibold text-slate-500 ${sizeClass} ${className}`}
      >
        {name.slice(0, 1)}
      </span>
    );
  }

  return (
    <img
      data-testid="pet-avatar"
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      className={`shrink-0 object-contain ${sizeClass} ${className}`}
      onError={() => setStage((current) => (current === 'primary' && shiny ? 'normal' : 'fallback'))}
    />
  );
}
