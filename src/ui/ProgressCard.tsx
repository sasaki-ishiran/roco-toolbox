export interface ProgressCardProps {
  title: string;
  numerator: number;
  denominator: number;
  hint?: string;
  /** 给了它就整卡可点，用作快速入口 */
  onClick?: () => void;
  /** 可点时右下角的动作文案 */
  action?: string;
  /** 可点卡的 testid（页面里可能有多张可点卡，避免 strict mode 冲突） */
  actionTestId?: string;
}

export function ProgressCard({
  title,
  numerator,
  denominator,
  hint,
  onClick,
  action,
  actionTestId,
}: ProgressCardProps) {
  const percent = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
  const content = (
    <>
      <h2 className="text-sm font-medium text-slate-500">{title}</h2>
      <p className="mt-1 text-2xl font-semibold text-slate-900">
        {numerator} <span className="text-slate-400">/ {denominator}</span>
      </p>
      <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
      </div>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      {action ? <p className="mt-1 text-xs font-medium text-emerald-700">{action} ›</p> : null}
    </>
  );

  // 卡片并排时等高（grid stretch），内容垂直居中避免矮卡下方留白（2026-10-05 修复）
  if (!onClick)
    return (
      <section className="flex flex-col justify-center rounded-2xl bg-white p-4 shadow-sm">
        {content}
      </section>
    );

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col justify-center rounded-2xl bg-white p-4 text-left shadow-sm"
      data-testid={actionTestId ?? 'progress-card-action'}
    >
      {content}
    </button>
  );
}
