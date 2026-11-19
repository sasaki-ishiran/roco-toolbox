import { useMemo } from 'react';
import { species } from '../data/catalog';
import type { StudRecommendation } from '../domain/suggestions';
import { PetAvatar } from './PetAvatar';
import { PetCardLayout } from './PetCardLayout';
import {
  setSuggestionGroupDone,
  setSuggestionDoneOpen,
  useSuggestionCard,
} from './suggestionCardStore';

const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));

export interface GroupedRecommendation {
  gameId: number;
  displayName: string;
  records: StudRecommendation[];
  natureNames: string[];
  groupLabels: string[];
}

export interface SuggestionCardProps {
  items: StudRecommendation[];
  /**
   * 点卡片看「怎么补」（2026-11-19 用户口径）：传了就改成开悬浮窗，
   * 不再用点卡标记「已换到」；不传保留旧的标记行为（小屏列表仍可用）。
   */
  onOpenGap?: (group: GroupedRecommendation) => void;
  /**
   * 清单为空时的提示语：由页面按「有没有数据 / 目标是否全收齐」给出，
   * 组件不自己猜（2026-10-24：以前写死「导入抓包数据后给出建议」，
   * 种公已收齐的用户会被误导以为数据没导进来）。
   */
  emptyNote: string;
}

/**
 * 种公推荐：每张卡是一只精灵，汇总其不同性格和蛋组推荐。
 *
 * 2026-10-05 拍板后的交互：
 * - 点击卡片 = 标记「已换到」，条目移出主列表、收进**已换到折叠区**（默认收起，避免页面过长）；
 *   点折叠区展开可还原（再点卡片）。
 * - 同一精灵的多条推荐合并为一张卡；完成时整组标记或还原。
 */
export function SuggestionCard({ items, emptyNote, onOpenGap }: SuggestionCardProps) {
  // 完成时间戳 / 折叠态都在模块级 store：切页签回来不丢（见 suggestionCardStore）
  const { doneAt, doneOpen } = useSuggestionCard();

  const groupedRecommendations = useMemo(() => {
    const groups = new Map<number, GroupedRecommendation>();
    for (const item of items) {
      let group = groups.get(item.gameId);
      if (!group) {
        group = {
          gameId: item.gameId,
          displayName: item.displayName,
          records: [],
          natureNames: [],
          groupLabels: [],
        };
        groups.set(item.gameId, group);
      }
      group.records.push(item);
      if (!group.natureNames.includes(item.natureName)) group.natureNames.push(item.natureName);
      for (const label of item.groupLabels) {
        if (!group.groupLabels.includes(label)) group.groupLabels.push(label);
      }
    }
    return [...groups.values()];
  }, [items]);

  const visiblePending = useMemo(
    () =>
      groupedRecommendations.filter(
        (group) => !group.records.every((item) => item.id in doneAt),
      ),
    [doneAt, groupedRecommendations],
  );

  const doneItems = useMemo(
    () =>
      groupedRecommendations
        .filter((group) => group.records.every((item) => item.id in doneAt))
        .sort((a, b) => {
          const aDoneAt = Math.max(...a.records.map((item) => doneAt[item.id] ?? 0));
          const bDoneAt = Math.max(...b.records.map((item) => doneAt[item.id] ?? 0));
          return bDoneAt - aDoneAt;
        }),
    [doneAt, groupedRecommendations],
  );

  return (
    <section className="rounded-2xl bg-white shadow-sm" data-testid="recommend-list">
      {items.length === 0 ? (
        <p className="p-4 text-sm text-slate-400" data-testid="recommend-empty">
          {emptyNote}
        </p>
      ) : (
        <>
          {visiblePending.length > 0 && (
            <ul className="grid grid-cols-4 gap-1" data-testid="recommend-items">
              {visiblePending.map((group) => (
                <SuggestionItem key={group.gameId} group={group} done={false} onOpenGap={onOpenGap} />
              ))}
            </ul>
          )}

          {/* 已换到折叠区：默认收起，点击展开可还原（改开悬浮窗后不再产生新记录） */}
          {!onOpenGap && doneItems.length > 0 && (
            <div className="mt-2 px-1 pb-1" data-testid="recommend-done">
              <button
                type="button"
                onClick={() => setSuggestionDoneOpen(!doneOpen)}
                aria-expanded={doneOpen}
                className="min-h-[28px] rounded-md bg-slate-100 px-2.5 text-xs text-slate-500"
                data-testid="recommend-done-toggle"
              >
                已换到 {doneItems.length} 只{doneOpen ? ' · 收起' : ''}
              </button>
              {doneOpen && (
                <ul className="mt-1 grid grid-cols-4 gap-1">
                  {doneItems.map((group) => (
                    <SuggestionItem key={group.gameId} group={group} done onOpenGap={onOpenGap} />
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

function SuggestionItem({
  group,
  done,
  onOpenGap,
}: {
  group: GroupedRecommendation;
  done: boolean;
  onOpenGap?: (group: GroupedRecommendation) => void;
}) {
  const detail = `${group.natureNames.join('、')}${group.displayName}（${group.groupLabels.join(' × ')}）`;
  return (
    <li title={detail} data-testid="recommend-item">
      <PetCardLayout
        name={group.displayName}
        number={speciesByGameId.get(group.gameId)?.number}
        eggGroups={group.groupLabels}
        natures={group.natureNames}
        naturesTestId="recommend-item-nature"
        title={detail}
        ariaLabel={
          onOpenGap
            ? `看 ${detail} 怎么补`
            : done
              ? `还原 ${detail} 已换到`
              : `标记 ${detail} 已换到`
        }
        className="w-full"
        size="suggest"
        fitName
        fitNameBase={9}
        fitNameMin={8}
        avatar={<PetAvatar gameId={group.gameId} name={group.displayName} size={44} />}
        onClick={() =>
          onOpenGap
            ? onOpenGap(group)
            : setSuggestionGroupDone(
                group.records.map((item) => item.id),
                !done,
              )
        }
        ariaPressed={onOpenGap ? undefined : done}
      />
    </li>
  );
}
