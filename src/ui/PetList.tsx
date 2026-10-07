import { useEffect, useState } from 'react';
import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { PetCard } from './PetCard';

/** 每页条数可选档位（用户要求：20 / 50 / 100） */
export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 20;
const PAGE_SIZE_STORAGE_KEY = 'roco.petPageSize';

/**
 * 2026-10-06 修复（M4）：部分安卓 WebView（隐私模式 / 关存储）访问
 * window.localStorage 会直接抛 SecurityError，一次抛错就把整页精灵列表崩掉。
 * 这里降级成「不记住偏好」：读写都吞掉存储异常，列表照常工作。
 */
const safeGetItem = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSetItem = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存储被禁时静默放弃：只影响「记住每页条数」这一个偏好
  }
};

export interface PetListProps {
  pets: OwnedPet[];
  speciesByGameId: Map<number, SpeciesEntry>;
  eggGroupNames: Record<number, string>;
  /** 筛选条件变化时用它把页码重置回第 1 页 */
  resetKey?: string;
}

export function PetList({ pets, speciesByGameId, eggGroupNames, resetKey = '' }: PetListProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => {
    const saved = Number(safeGetItem(PAGE_SIZE_STORAGE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(saved) ? (saved as PageSize) : DEFAULT_PAGE_SIZE;
  });

  useEffect(() => {
    setPage(1);
  }, [resetKey, pageSize]);

  useEffect(() => {
    safeSetItem(PAGE_SIZE_STORAGE_KEY, String(pageSize));
  }, [pageSize]);

  const totalPages = Math.max(1, Math.ceil(pets.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const visible = pets.slice(start, start + pageSize);

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500" data-testid="page-indicator">
        共 {pets.length} 只 · 第 {safePage} / {totalPages} 页（每页 {pageSize} 只）
      </p>

      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span>每页</span>
        {PAGE_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            onClick={() => setPageSize(size)}
            aria-pressed={pageSize === size}
            className={`min-h-[32px] rounded-lg border px-2.5 text-xs ${
              pageSize === size
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            {size}
          </button>
        ))}
      </div>

      {/* 一行两张：手机宽度下一张约 170px，比一行一张的信息密度高一倍 */}
      <ul className="grid grid-cols-2 gap-2">
        {visible.map((pet, index) => (
          <li key={`${pet.account}-${pet.gameId}-${start + index}`}>
            <PetCard
              pet={pet}
              species={speciesByGameId.get(pet.gameId)}
              eggGroupNames={eggGroupNames}
            />
          </li>
        ))}
      </ul>

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between gap-2 pt-1" aria-label="分页">
          <button
            type="button"
            disabled={safePage === 1}
            onClick={() => setPage(safePage - 1)}
            className="min-h-[44px] flex-1 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 disabled:text-slate-300"
          >
            上一页
          </button>
          <button
            type="button"
            disabled={safePage === totalPages}
            onClick={() => setPage(safePage + 1)}
            className="min-h-[44px] flex-1 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 disabled:text-slate-300"
          >
            下一页
          </button>
        </nav>
      ) : null}
    </div>
  );
}
