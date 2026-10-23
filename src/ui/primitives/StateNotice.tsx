import type { ReactNode } from 'react';

export type NoticeKind =
  | 'loading'
  | 'empty-data'
  | 'empty-query'
  | 'unset-scope'
  | 'complete'
  | 'incomparable'
  | 'unknown'
  | 'cached'
  | 'error'
  | 'success';

export interface StateNoticeProps {
  kind: NoticeKind;
  title: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
}

const STYLE: Record<NoticeKind, string> = {
  loading: 'bg-slate-50 text-slate-500',
  'empty-data': 'bg-slate-50 text-slate-500',
  'empty-query': 'bg-slate-50 text-slate-500',
  'unset-scope': 'bg-amber-50 text-amber-800',
  complete: 'bg-emerald-50 text-emerald-800',
  incomparable: 'bg-amber-50 text-amber-800',
  unknown: 'bg-amber-50 text-amber-800',
  cached: 'bg-slate-50 text-slate-500',
  error: 'bg-rose-50 text-rose-700',
  success: 'bg-emerald-50 text-emerald-800',
};

/**
 * 可恢复状态反馈（2026-10-24 统一控件）。
 *
 * 只展示传入的状态，**不推断**领域事实：调用方必须自己分清
 * 无数据 / 无匹配 / 全收齐 / 未设置 / 不可计算 / 待确认 / 缓存 / 失败。
 * 失败用 alert 播报；其余用 status，内容变化才播报，页面不要为轮询重复挂载。
 */
export function StateNotice({ kind, title, description, action, testId }: StateNoticeProps) {
  const tone = STYLE[kind];
  return (
    <div
      className={`rounded-xl px-3 py-2 ${tone}`}
      role={kind === 'error' ? 'alert' : 'status'}
      data-testid={testId ?? `notice-${kind}`}
    >
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-0.5 text-xs opacity-90">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
