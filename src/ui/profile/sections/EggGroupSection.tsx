import type { SectionProps } from '../types';

/**
 * 蛋仓 / 小组两张小卡（2026-11-28 UX1 方案 A）。
 *
 * 待办数字折进角标：蛋仓「待认领 N」、小组「待确认 N」；N=0 不显示角标。
 * 两张并排，只做入口；具体内容在各页。
 */
function MiniCard({
  testId,
  label,
  badge,
  onClick,
}: {
  testId: string;
  label: string;
  badge: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex min-h-16 flex-col items-start justify-between gap-s1 rounded-card border border-line bg-surface p-s3 text-left shadow-card transition-colors active:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="text-title font-semibold text-ink-strong">{label}</span>
      {badge > 0 ? (
        <span
          className="inline-flex min-h-6 items-center rounded-chip border border-warn-line bg-warn-soft px-s2 text-meta font-medium text-warn"
          data-testid={`${testId}-badge`}
        >
          {label === '我的蛋仓' ? '待认领' : '待确认'} {badge}
        </span>
      ) : (
        <span className="text-caption text-ink-muted">暂无待处理</span>
      )}
    </button>
  );
}

export function EggGroupSection({ ctx }: SectionProps) {
  return (
    <div className="grid grid-cols-2 gap-s2" data-section="egg-group">
      <MiniCard
        testId="profile-egg-card"
        label="我的蛋仓"
        badge={ctx.todos.claims ?? 0}
        onClick={ctx.onGoEggStock}
      />
      <MiniCard
        testId="profile-group-card"
        label="我的小组"
        badge={ctx.todos.confirm ?? 0}
        onClick={ctx.onGoGroups}
      />
    </div>
  );
}
