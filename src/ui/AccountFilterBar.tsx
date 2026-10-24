import { useAccountFilter } from './accountFilterStore';
import { ACTION, CHIP_BASE, CHIP_OFF, CHIP_ON } from './primitives/styles';

export interface AccountFilterBarProps {
  accounts: string[];
}

/**
 * 账号筛选条。看板 / 覆盖度 / 换什么 / 我的精灵四页各放一份，共用同一个 store。
 * 只有一个且已选中账号时不显示；被取消选择时仍提供恢复入口。
 *
 * 2026-10-05：按用户拍板去掉「可收起」，账号列表**默认展开**（原样展示）。
 * 2026-10-25：芯片收紧到 28px，与全站控件尺寸统一。
 */
export function AccountFilterBar({ accounts }: AccountFilterBarProps) {
  const { excluded, toggleAccount, toggleAllAccounts } = useAccountFilter();
  // 单账号默认不需要筛选条；但如果用户把它取消选中，必须保留恢复入口。
  if (accounts.length < 2 && !(accounts.length === 1 && excluded.has(accounts[0]))) return null;

  const onCount = accounts.filter((account) => !excluded.has(account)).length;
  const allOn = excluded.size === 0;

  return (
    <section className="rounded-xl bg-white p-2.5 shadow-sm" data-testid="account-filter">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">
          账号（{onCount}/{accounts.length}）
        </span>
        <button
          type="button"
          onClick={() => toggleAllAccounts(accounts)}
          className={ACTION}
          data-testid="account-filter-toggle-all"
        >
          {allOn ? '全不选' : '全选'}
        </button>
      </div>
      {onCount === 0 ? (
        <p className="mt-1 text-xs text-amber-700" data-testid="account-filter-empty">
          未选择游戏账号：个人进度按 0 个账号计算，点「全选」可恢复。
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {accounts.map((account) => {
          const on = !excluded.has(account);
          return (
            <button
              key={account}
              type="button"
              aria-pressed={on}
              onClick={() => toggleAccount(account)}
              className={`${CHIP_BASE} ${on ? CHIP_ON : CHIP_OFF}`}
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
