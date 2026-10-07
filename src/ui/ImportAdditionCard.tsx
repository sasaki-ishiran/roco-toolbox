import { AccountBlock, countOf } from './ImportResultCard';
import { toggleCollapsedResult, useCollapsedResult } from './additionCardStore';
import { useLastImportResult } from './useLastImportResult';

/**
 * 看板顶部的「本次新增」卡片：导入 / 云同步后立刻告诉用户这次新进来的、够格进看板分类的精灵。
 *
 * 2026-10-05（用户拍板）：明细从「导入数据」页移到看板，标题就叫「本次新增」；
 * 导入数据页只剩历史入口。重启后内存里没有最新结果 → 卡片不渲染（历史不走看板）。
 *
 * 2026-10-07：展开态挪到 `additionCardStore`（按「收起的是哪一份结果」记），
 * 切页回来不再自动弹开；来了新结果仍会自动展开。
 */
export function ImportAdditionCard() {
  const results = useLastImportResult();
  const collapsed = useCollapsedResult();

  if (results === null || results.length === 0) return null;

  const open = collapsed !== results;
  const total = results.reduce((sum, account) => sum + countOf(account), 0);

  return (
    <section data-testid="import-result" className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-500">
          本次新增{' '}
          <span className="text-xs font-normal text-slate-400">（符合看板分类）</span>
        </h2>
        <button
          type="button"
          data-testid="import-result-dismiss"
          aria-expanded={open}
          onClick={() => toggleCollapsedResult(results)}
          className="min-h-[24px] shrink-0 text-xs text-slate-400"
        >
          {open ? '收起' : '展开'}
        </button>
      </div>

      {open ? (
        total === 0 ? (
          <p className="mt-2 text-xs text-slate-400" data-testid="import-result-empty">
            本次没有新增符合看板分类的精灵。
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {results.map((account) => (
              <AccountBlock key={account.accountKey} account={account} />
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}