import { useMemo } from 'react';
import type { StudRecommendation } from '../domain/suggestions';
import {
  setSuggestionDoneOpen,
  setSuggestionQuantity,
  toggleSuggestionDone,
  useSuggestionCard,
} from './suggestionCardStore';

const QUANTITY_OPTIONS = [5, 15, '全部'] as const;

export interface SuggestionCardProps {
  title: string;
  items: StudRecommendation[];
  /** 数量选项选「全部」时跳到「换什么」页看完整求蛋清单 */
  onOpenSwap?: () => void;
}

/**
 * 优质种公推荐（2026-10-04 改版）：每条是「性格精灵（组别）」的待办。
 *
 * 2026-10-05 拍板后的交互：
 * - 勾选 = 标记「已换到」，条目移出主列表、收进**已换到折叠区**（默认收起，避免页面过长）；
 *   点折叠区展开可还原（再点勾选框）。
 * - 待办是栈：按完成时间倒序，先完成的在折叠区底部（先入后出）。
 * - 数量（5 / 15 / 全部）只作用于主列表；折叠区是已完成的，不受数量限制。
 */
export function SuggestionCard({ title, items, onOpenSwap }: SuggestionCardProps) {
  // 完成时间戳 / 折叠态 / 数量都在模块级 store：切页签回来不丢（见 suggestionCardStore）
  const { doneAt, doneOpen, quantity } = useSuggestionCard();

  const doneIds = useMemo(
    () =>
      Object.entries(doneAt)
        .sort((a, b) => a[1] - b[1]) // 先完成的在前，渲染时反转为「先入后出」：先完成的在底部
        .map(([id]) => id),
    [doneAt],
  );

  const visiblePending = useMemo(() => {
    const pending = items.filter((item) => !(item.id in doneAt));
    return pending.slice(0, quantity);
  }, [items, doneAt, quantity]);

  const doneItems = useMemo(
    () =>
      doneIds
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is StudRecommendation => Boolean(item))
        .reverse(), // 栈：先完成的沉底
    [doneIds, items],
  );

  const toggle = (id: string) => {
    toggleSuggestionDone(id);
  };

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="recommend-list">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-500">{title}</h2>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="推荐数量"
          data-testid="recommend-quantity"
        >
          {QUANTITY_OPTIONS.map((option) =>
            option === '全部' ? (
              <button
                key={option}
                type="button"
                onClick={onOpenSwap}
                className="min-h-[28px] rounded-full border px-2.5 text-xs text-emerald-700"
                data-testid="recommend-quantity-all"
              >
                {option}
              </button>
            ) : (
              <button
                key={option}
                type="button"
                aria-pressed={quantity === option}
                onClick={() => setSuggestionQuantity(option)}
                className={`min-h-[28px] rounded-full border px-2.5 text-xs ${
                  quantity === option
                    ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-500'
                }`}
                data-testid={`recommend-quantity-${option}`}
              >
                {option}
              </button>
            ),
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-1 text-sm text-slate-400">导入抓包数据后给出建议</p>
      ) : (
        <>
          {visiblePending.length > 0 && (
            <ul className="mt-1 space-y-1" data-testid="recommend-items">
              {visiblePending.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"
                  data-testid="recommend-item"
                >
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggle(item.id)}
                    className="h-4 w-4 shrink-0 accent-emerald-600"
                    data-testid="recommend-item-check"
                    aria-label={`标记 ${item.natureName}${item.displayName} 已换到`}
                  />
                  <span>
                    {item.natureName}
                    {item.displayName}（{item.groupLabels.join(' × ')}）
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* 已换到折叠区：默认收起，点击展开可还原（先完成的在底部） */}
          {doneItems.length > 0 && (
            <div className="mt-2" data-testid="recommend-done">
              <button
                type="button"
                onClick={() => setSuggestionDoneOpen(!doneOpen)}
                aria-expanded={doneOpen}
                className="min-h-[32px] rounded-lg bg-slate-100 px-3 text-xs text-slate-500"
                data-testid="recommend-done-toggle"
              >
                已换到 {doneItems.length} 条{doneOpen ? ' · 收起' : ''}
              </button>
              {doneOpen && (
                <ul className="mt-1 space-y-1">
                  {doneItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400 line-through"
                      data-testid="recommend-item"
                    >
                      <input
                        type="checkbox"
                        checked
                        onChange={() => toggle(item.id)}
                        className="h-4 w-4 shrink-0 accent-emerald-600"
                        data-testid="recommend-item-check"
                        aria-label={`还原 ${item.natureName}${item.displayName}`}
                      />
                      <span>
                        {item.natureName}
                        {item.displayName}（{item.groupLabels.join(' × ')}）
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
