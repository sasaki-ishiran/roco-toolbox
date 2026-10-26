import { useEffect, useState } from 'react';
import { allNatureNames, targetNaturePool } from '../data/catalog';
import { DEMAND_NATURE_MAX } from '../shared/collectionGroups';
import { ModalSurface } from './primitives/ModalSurface';

/** 八大性格放前面，其余收进「更多性格」（2026-10-26 用户口径）。 */
const PRIMARY_NATURES = targetNaturePool.map((nature) => nature.name);
const EXTRA_NATURES = allNatureNames.filter((nature) => !PRIMARY_NATURES.includes(nature));

export interface DemandPublishItem {
  eggGameId: number;
  name: string;
  /** 默认性格（本组口径 / 图鉴推荐），进来时可被改。 */
  natures: string[];
}

export interface DemandPublishSheetProps {
  open: boolean;
  items: DemandPublishItem[];
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (items: Array<{ eggGameId: number; natures: string[] }>) => void;
}

/**
 * 发需求确认弹层（2026-10-26 用户补的口径）：选中卡片后先在这里挑性格，再发布。
 *
 * 每颗蛋默认带本组口径的性格（没有就留空 = 不挑），点性格标签增删；
 * 一条需求最多 DEMAND_NATURE_MAX 个，和服务器校验一致。
 */
export function DemandPublishSheet({
  open,
  items,
  busy = false,
  error = '',
  onClose,
  onConfirm,
}: DemandPublishSheetProps) {
  const [draft, setDraft] = useState<Record<number, string[]>>({});
  const [showAll, setShowAll] = useState(false);

  // 每次打开按 items 的默认性格重置草稿，避免带上一次的选择
  useEffect(() => {
    if (!open) return;
    setShowAll(false);
    setDraft(Object.fromEntries(items.map((item) => [item.eggGameId, [...item.natures]])));
  }, [open, items]);

  const toggle = (eggGameId: number, nature: string) => {
    setDraft((current) => {
      const picked = current[eggGameId] ?? [];
      if (picked.includes(nature)) {
        return { ...current, [eggGameId]: picked.filter((item) => item !== nature) };
      }
      if (picked.length >= DEMAND_NATURE_MAX) return current;
      return { ...current, [eggGameId]: [...picked, nature] };
    });
  };

  const totalCount = items.reduce(
    (sum, item) => sum + Math.max(1, (draft[item.eggGameId] ?? item.natures).length),
    0,
  );

  return (
    <ModalSurface
      open={open}
      title="发需求"
      placement="sheet"
      onClose={onClose}
      testId="demand-publish"
      closeTestId="demand-publish-close"
      backdropTestId="demand-publish-backdrop"
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            data-testid="demand-publish-cancel"
            className="min-h-[36px] flex-1 rounded-lg border border-slate-200 text-sm text-slate-500"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onConfirm(
                items.map((item) => ({
                  eggGameId: item.eggGameId,
                  natures: draft[item.eggGameId] ?? item.natures,
                })),
              )
            }
            data-testid="demand-publish-confirm"
            className="min-h-[36px] flex-[2] rounded-lg bg-emerald-600 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? '发布中…' : `发布 ${totalCount} 条需求`}
          </button>
        </div>
      }
    >
      <div className="space-y-2 p-3" data-testid="demand-publish-body">
        <p className="text-[11px] leading-snug text-slate-400">
          给每颗蛋选性格，一个性格算一条需求（勾 2 个就是 2 条，占 2 个额度）；
          不选表示不挑性格。发布后组员能在「我能补的」里看到并接单。
        </p>
        {items.map((item) => {
          const picked = draft[item.eggGameId] ?? item.natures;
          const visible = showAll ? [...PRIMARY_NATURES, ...EXTRA_NATURES] : PRIMARY_NATURES;
          return (
            <div key={item.eggGameId} className="rounded-lg bg-slate-50 px-2 py-1.5" data-testid="demand-publish-item">
              <p className="text-[11px] font-medium text-slate-700">{item.name}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {visible.map((nature) => {
                  const on = picked.includes(nature);
                  return (
                    <button
                      key={nature}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(item.eggGameId, nature)}
                      data-testid={`demand-nature-${item.eggGameId}-${nature}`}
                      className={`min-h-[26px] rounded-md border px-1.5 text-xs ${
                        on
                          ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                          : 'border-slate-200 bg-white text-slate-500'
                      }`}
                    >
                      {nature}
                    </button>
                  );
                })}
                {EXTRA_NATURES.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowAll((value) => !value)}
                    data-testid="demand-nature-toggle"
                    className="min-h-[26px] rounded-md border border-dashed border-slate-300 px-1.5 text-xs text-slate-500"
                  >
                    {showAll ? '收起 ▴' : `更多性格 +${EXTRA_NATURES.length} ▾`}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {error ? (
          <p className="text-[11px] text-rose-600" data-testid="demand-publish-error">{error}</p>
        ) : null}
      </div>
    </ModalSurface>
  );
}
