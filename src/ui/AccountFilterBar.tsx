import { useEffect, useState } from 'react';
import { clearAccountFilter, useAccountFilter } from './accountFilterStore';

export interface AccountFilterBarProps {
  accounts: string[];
  compact?: boolean;
}

/** 可折叠账号摘要与选择面板；与看板共用筛选状态和交互。 */
export function AccountFilterBar({ accounts, compact = false }: AccountFilterBarProps) {
  const [open, setOpen] = useState(false);
  const { excluded, toggleAccount, toggleAllAccounts } = useAccountFilter();
  const selectedAccounts = accounts.filter((account) => !excluded.has(account));
  const selectedCount = selectedAccounts.length;
  const noSelectedAccounts = accounts.length > 0 && selectedCount === 0;
  useEffect(() => {
    if (noSelectedAccounts) clearAccountFilter();
  }, [noSelectedAccounts]);
  if (accounts.length === 0) return null;

  return (
    <section className={compact ? 'relative min-w-0' : ''} data-testid="account-filter">
      <div className={compact ? 'min-w-0' : 'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2'}>
        {compact ? null : <span className="text-xs font-medium text-slate-500">账号</span>}
        {accounts.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((wasOpen) => !wasOpen)}
            aria-expanded={open}
            aria-controls={open ? 'account-filter-options' : undefined}
            aria-label={compact ? `账号筛选 ${selectedCount}/${accounts.length}` : undefined}
            className={`flex min-h-[32px] min-w-0 w-full items-center rounded-lg border text-slate-700 shadow-sm hover:border-emerald-300 ${
              compact
                ? 'min-h-[44px] justify-center gap-0.5 px-1 text-[10px]'
                : 'gap-1 px-2 text-xs'
            } ${
              open ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200 bg-white'
            }`}
            data-testid="account-filter-summary"
            title={`${selectedAccounts.join('、')} (${selectedCount}/${accounts.length})`}
          >
            {compact ? (
              <span className="min-w-0 flex-1 truncate text-left">
                {selectedAccounts[0] ?? '账号'}
              </span>
            ) : (
              <span className="flex min-w-0 flex-1 items-center">
                <span
                  className={`truncate ${
                    selectedAccounts.length > 1 ? 'max-w-[45%] shrink-0' : 'min-w-0 flex-1'
                  }`}
                >
                  {selectedAccounts[0] ?? '选择账号'}
                </span>
                {selectedAccounts.length > 1 ? (
                  <span className="min-w-0 flex-1 truncate" title={selectedAccounts.slice(1).join('、')}>
                    、{selectedAccounts.slice(1).join('、')}
                  </span>
                ) : null}
              </span>
            )}
            <span className="shrink-0">{compact ? `${selectedCount}/${accounts.length}` : `(${selectedCount}/${accounts.length})`}</span>
            <span aria-hidden className="shrink-0 text-[10px] text-slate-400">
              {open ? '⌃' : '⌄'}
            </span>
          </button>
        ) : null}
      </div>
      {open && accounts.length > 0 ? (
        <div
          className={`rounded-xl border border-slate-100 bg-slate-50/70 p-2 ${
            compact ? 'absolute left-0 top-full z-30 mt-1 w-64 max-w-[80vw] shadow-lg' : 'mt-2'
          }`}
          data-testid="account-filter-selector"
          id="account-filter-options"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">至少选择一个账号</span>
            {selectedCount < accounts.length ? (
              <button
                type="button"
                onClick={() => toggleAllAccounts(accounts)}
                className="text-[11px] font-medium text-emerald-700"
                data-testid="account-filter-select-all"
              >
                全选
              </button>
            ) : null}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1" role="group" aria-label="账号选择">
            {accounts.map((account) => {
              const selected = !excluded.has(account);
              const isLastSelected = selected && selectedCount === 1;
              return (
                <button
                  key={account}
                  type="button"
                  aria-pressed={selected}
                  disabled={isLastSelected}
                  title={isLastSelected ? '至少保留一个已选账号' : account}
                  onClick={() => toggleAccount(account)}
                  className={`min-h-[32px] min-w-0 truncate rounded-lg border px-2 text-left text-xs ${
                    selected
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-white text-slate-500'
                  } disabled:cursor-not-allowed`}
                  data-testid={`account-filter-${account}`}
                >
                  {account}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
