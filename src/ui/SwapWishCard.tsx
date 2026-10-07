import { useEffect, useMemo, useRef, useState } from 'react';
import { gradeLabel } from '../domain/petFilters';
import type { StudRecommendation } from '../domain/suggestions';
import { NEST_PREFIX, type NestKind } from '../domain/swapPlan';
import { useTargetMode } from './targetModeStore';
import { setSwapSelected, useSwapView } from './swapViewStore';
import { CopySheet, isCopyPreviewOff } from './CopySheet';

export interface SwapWishCardProps {
  /** 优质种公推荐算法的完整清单（换什么页与看板同一口径，2026-10-05 复用） */
  recommendations: StudRecommendation[];
  /** 分页每页条数 */
  pageSize?: number;
}

/**
 * 窝类型按钮上的短文案（2026-10-04 用户拍板：只写绿窝/普通窝，不写「100%」等规则解释）。
 */
const NEST_LABEL: Record<NestKind, string> = {
  green: '绿窝',
  plain: '普通窝',
};

const keyOf = (rec: StudRecommendation): string => rec.id;

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // WebView / 非安全上下文里可能没有 clipboard API，退回到临时 textarea
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/** 整段复制的文本（用户 2026-10-03 拍的格式）：首行「窝 + 档位」+ 每行「性格 + 精灵名」，不同档位间空一行。 */
function formatSwapWishes(
  recommendations: StudRecommendation[],
  mode: Parameters<typeof gradeLabel>[1],
  nest?: NestKind,
): string {
  const groups = new Map<string, string[]>();
  for (const rec of recommendations) {
    const lines = groups.get(rec.grade) ?? [];
    lines.push(`${rec.natureName}${rec.displayName}`);
    groups.set(rec.grade, lines);
  }

  const prefix = nest ? NEST_PREFIX[nest] : '';
  const blocks: string[] = [];
  for (const [grade, lines] of groups) {
    blocks.push([`${prefix}${gradeLabel(grade as never, mode)}`, ...lines].join('\n'));
  }
  return blocks.join('\n\n');
}

/** 单条：窝 + 档位 + 性格 + 精灵名，如「绿窝满分大婉平和白发懒人」。 */
function formatSwapWish(rec: StudRecommendation, mode: Parameters<typeof gradeLabel>[1], nest?: NestKind): string {
  const prefix = nest ? NEST_PREFIX[nest] : '';
  return `${prefix}${gradeLabel(rec.grade, mode)}${rec.natureName}${rec.displayName}`;
}

/**
 * 求蛋清单（换什么页）：与看板「优质种公推荐」同一口径（复用 computeStudRecommendations），
 * 每条 = 性格 + 精灵名，性格是该精灵进化链最高形态自己能换到的性格（PVP 推荐 / 种族值兜底），
 * 不再可能「性格与精灵不匹配」。支持勾选多条一起复制，复制文本按「窝 + 档位」分组。
 */
export function SwapWishCard({ recommendations, pageSize = 20 }: SwapWishCardProps) {
  const mode = useTargetMode();
  const [nest, setNest] = useState<NestKind>('green');
  // 勾选集合放模块级 store：用户常勾十几条再一起复制，切页签回来不能丢（见 swapViewStore）
  const { selected } = useSwapView();
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState<{ ok: boolean } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  /** 「已复制」提示的隐藏定时器：连点时清掉旧的再起新的，卸载时也要清 */
  const copyTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const totalPages = Math.max(1, Math.ceil(recommendations.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = useMemo(
    () => recommendations.slice((safePage - 1) * pageSize, safePage * pageSize),
    [recommendations, safePage, pageSize],
  );

  const selectedRecs = useMemo(
    () => recommendations.filter((rec) => selected.has(keyOf(rec))),
    [recommendations, selected],
  );
  const toCopy = selectedRecs.length > 0 ? selectedRecs : recommendations;
  const copyTextValue = formatSwapWishes(toCopy, mode, nest);

  const doCopy = async () => {
    const ok = await copyText(copyTextValue);
    setCopied({ ok });
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopied(null);
    }, 1500);
  };

  /** 复制前先弹预览（除非勾过「不再提示」）；2026-10-04 用户拍板 */
  const handleCopy = () => {
    if (isCopyPreviewOff()) {
      void doCopy();
      return;
    }
    setPreviewOpen(true);
  };

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSwapSelected(next);
  };

  // 「全选」按**当前可见清单**判断：选中集合是跨筛选保留的，用 size 比较会在
  // 「筛选后数量恰好相同」时误显示「取消选择」，点下去清掉的还不是可见的那批
  const allSelected =
    recommendations.length > 0 && recommendations.every((rec) => selected.has(keyOf(rec)));

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="swap-wish-list">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-500">求蛋清单（{recommendations.length}）</h2>
        <div className="flex gap-1 rounded-full bg-slate-100 p-0.5" role="group" aria-label="窝类型">
          {(Object.keys(NEST_LABEL) as NestKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={nest === kind}
              onClick={() => setNest(kind)}
              data-testid={`swap-nest-${kind}`}
              className={`min-h-[28px] rounded-full px-2.5 text-xs ${
                nest === kind ? 'bg-white font-medium text-emerald-700 shadow-sm' : 'text-slate-500'
              }`}
            >
              {NEST_LABEL[kind]}
            </button>
          ))}
        </div>
      </div>

      {recommendations.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400" data-testid="swap-wish-empty">
          当前筛选下没有要去换的缺口。
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSwapSelected(allSelected ? new Set() : new Set(recommendations.map(keyOf)))}
              className="min-h-[32px] rounded-full border border-slate-200 px-3 text-xs text-slate-600"
              data-testid="swap-wish-select-all"
            >
              {allSelected ? '取消选择' : '全选'}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="min-h-[32px] rounded-full border border-emerald-500 px-3 text-xs font-medium text-emerald-700"
              data-testid="swap-wish-copy"
            >
              {copied ? (copied.ok ? '已复制' : '复制失败') : `复制${selectedRecs.length > 0 ? `选中 ${selectedRecs.length}` : `全部 ${recommendations.length}`}`}
            </button>
          </div>

          <ul className="mt-2 space-y-1" data-testid="swap-wish-items">
            {visible.map((rec) => {
              const key = keyOf(rec);
              return (
                <li key={key} data-testid="swap-wish-item">
                  <label className="flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggle(key)}
                      aria-label={`选择 ${formatSwapWish(rec, mode, nest)}`}
                      data-testid="swap-wish-select"
                      className="mt-1 h-4 w-4 shrink-0 accent-emerald-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-slate-900">
                          {rec.natureName}
                          {rec.displayName}
                        </span>
                        <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 text-[10px] text-emerald-700">
                          补 {rec.groupLabels.length} 组
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {gradeLabel(rec.grade, mode)} · {rec.groupLabels.join(' × ')}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-2 pt-2" aria-label="分页">
              <button
                type="button"
                disabled={safePage === 1}
                onClick={() => setPage(safePage - 1)}
                className="min-h-[40px] flex-1 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 disabled:text-slate-300"
              >
                上一页
              </button>
              <span className="text-xs text-slate-400" data-testid="swap-page-indicator">
                第 {safePage} / {totalPages} 页
              </span>
              <button
                type="button"
                disabled={safePage === totalPages}
                onClick={() => setPage(safePage + 1)}
                className="min-h-[40px] flex-1 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 disabled:text-slate-300"
              >
                下一页
              </button>
            </nav>
          ) : null}
        </>
      )}

      <CopySheet
        open={previewOpen}
        text={copyTextValue}
        onConfirm={() => {
          setPreviewOpen(false);
          void doCopy();
        }}
        onCancel={() => setPreviewOpen(false)}
      />
    </section>
  );
}