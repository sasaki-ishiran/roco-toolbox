import type { ReactNode } from 'react';
/** 账号聚拢的统一标题（2026-10-05 建议1：配窝建议 / 母本全收集 / 我的精灵复用） */
export function AccountSection({ account, children }: { account: string; children: ReactNode }) {
  return (
    <div data-testid="account-section">
      <h3 className="mb-1 text-xs font-medium text-slate-400">{account}</h3>
      {children}
    </div>
  );
}