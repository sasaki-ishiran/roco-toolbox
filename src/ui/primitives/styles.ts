/**
 * 最小控件规范里的固定样式起点（2026-10-24 重构任务 2）。
 *
 * 只集中「多处必须一致」的数值：页面/卡片圆角与间距、文字层级、输入与焦点。
 * 不在通用组件里推断收集事实或业务状态。
 */
export const PAGE = 'mx-auto max-w-md space-y-3 p-4';
export const CARD = 'rounded-2xl bg-white p-4 shadow-sm';
export const TOOL_CARD = 'rounded-xl bg-white p-3 shadow-sm';
export const INSET = 'rounded-xl bg-slate-50 p-3';

/** 页 / 卡标题：16px semibold */
export const TITLE = 'text-base font-semibold text-slate-900';
/** 常规正文 / 关键状态：14px */
export const BODY = 'text-sm text-slate-700';
/** 辅助说明：12px */
export const HINT = 'text-xs text-slate-500';

export const FIELD =
  'min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50 disabled:text-slate-400';

export const CHIP_ON = 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700';
export const CHIP_OFF = 'border-slate-200 bg-white text-slate-500';
