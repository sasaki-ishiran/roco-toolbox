import { useAccountFilter } from './accountFilterStore';

export interface AccountFilterBarProps {
  accounts: string[];
}

/**
 * 账号筛选条。看板 / 覆盖度 / 换什么 / 我的精灵四页各放一份，共用同一个 store。
 * 只有一个账号时不显示。
 *
 * 2026-10-05：按用户拍板去掉「可收起」，账号列表**默认展开**（原样展示）。
 */
export function AccountFilterBar({ accounts }: AccountFilterBarProps) {
  const { excluded, toggleAccount, toggleAllAccounts } = useAccountFilter();
  if (accounts.length < 2) return null;

  const onCount = accounts.filter((account) => !excluded.has(account)).length;
  const allOn = excluded.size === 0;

  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm" data-testid="account-filter">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">
          账号（{onCount}/{accounts.length}）
        </span>
        <button
          type="button"
          onClick={() => toggleAllAccounts(accounts)}
          className="min-h-[28px] text-xs font-medium text-emerald-700"
          data-testid="account-filter-toggle-all"
        >
          {allOn ? '全不选' : '全选'}
        </button>
      </div>
      <div className="mt-1 flex gap-1.5 overflow-x-auto pb-0.5">
        {accounts.map((account) => {
          const on = !excluded.has(account);
          return (
            <button
              key={account}
              type="button"
              aria-pressed={on}
              onClick={() => toggleAccount(account)}
              className={`min-h-[32px] shrink-0 rounded-full border px-2.5 text-xs ${
                on
                  ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-400'
              }`}
              data-testid={`account-chip-${account}`}
            >
              {account}
            </button>
          );
        })}
      </div>
    </section>
  );
}
