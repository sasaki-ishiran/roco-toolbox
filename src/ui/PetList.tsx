import type { CSSProperties } from 'react';
import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { PetCard } from './PetCard';

export interface PetListProps {
  pets: OwnedPet[];
  speciesByGameId: Map<number, SpeciesEntry>;
  eggGroupNames: Record<number, string>;
  showCount?: boolean;
  /** 卡片网格列数（2026-11-18 用户口径：三列时卡片内容整体放大、一行铺满） */
  columns?: 3 | 4;
}

/**
 * 三列模式的缩放倍数：
 * 四列时卡片宽度 ≈ (W - 3*gap)/4，三列时 ≈ (W - 2*gap)/3，两者之比约 1.35，
 * 用 CSS zoom 让字号、头像、奖牌、圆角一起等比放大（不用改卡片里的每一处尺寸）。
 */
const THREE_COLUMN_ZOOM = 1.35;

export function PetList({
  pets,
  speciesByGameId,
  eggGroupNames,
  showCount = true,
  columns = 4,
}: PetListProps) {
  const zoomStyle: CSSProperties | undefined =
    columns === 3 ? { zoom: THREE_COLUMN_ZOOM } : undefined;

  return (
    <div className="space-y-2">
      {showCount ? (
        <p className="text-xs text-slate-500" data-testid="pet-count">
          共 {pets.length} 只
        </p>
      ) : null}

      {/* 一行四张 / 三张：移动端保持紧凑卡片网格 */}
      <ul
        className={`grid gap-1.5 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}
        data-testid="pet-list-items"
        data-columns={columns}
      >
        {pets.map((pet, index) => (
          <li key={`${pet.account}-${pet.gameId}-${index}`} style={zoomStyle}>
            <PetCard
              pet={pet}
              species={speciesByGameId.get(pet.gameId)}
              eggGroupNames={eggGroupNames}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}