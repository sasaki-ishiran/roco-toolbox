import { Card } from '../../kit';
import { startCollectorCapture } from '../../../collector/nativeCollector';
import { markCaptureOrigin } from '../../../collector/captureOriginStore';
import { isLastEnabledNearbyOverlayPanel, setNearbyOverlayPanel, useNearbyOverlayPanels } from '../../../nearby/overlayPanels';
import { useNearbyCardStats } from '../useNearbyCardStats';
import type { SectionProps } from '../types';

/**
 * 附近精灵入口卡（2026-11-28 UX1 方案 A）。
 *
 * 状态行（几只 / 稀有 / 更新时间）→ 开始采集 → 战斗 / 跑图两个独立开关 →
 * 实时后果一行 → 完整附近与强提醒。
 * 开关就是悬浮球的两块面板（`overlayPanels`），不新建状态；至少留一项。
 */
function timeText(ms: number | null): string {
  if (!ms) return '还没采集';
  return new Date(ms).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NearbySection({ ctx }: SectionProps) {
  const { pets, rare, targets, hits, updatedAt } = useNearbyCardStats();
  const panels = useNearbyOverlayPanels();

  const start = () => {
    markCaptureOrigin('nearby');
    void startCollectorCapture('full').catch(() => {
      // 起不来时交给「附近」详情的错误态；卡片不吞掉入口
      ctx.onGoNearby();
    });
  };

  return (
    <Card testId="profile-nearby-card" className="space-y-s2">
      <div className="flex items-baseline justify-between gap-s2">
        <h2 className="text-title font-semibold text-ink-strong">附近精灵</h2>
        <button
          type="button"
          onClick={ctx.onGoNearby}
          className="min-h-8 shrink-0 rounded-tile px-s2 text-meta font-medium text-accent-strong transition-colors active:bg-surface-sunken"
          data-testid="profile-nearby-detail"
        >
          完整附近与强提醒 ›
        </button>
      </div>

      <div className="rounded-tile bg-surface-sunken p-s3" data-testid="profile-nearby-status">
        <p className="text-hero font-semibold tabular-nums text-ink-strong">{pets} 只</p>
        <p className="mt-s1 text-caption text-ink-muted">
          稀有 {rare} 只{targets > 0 ? ` · 蹲守 ${targets}` : ''} · 更新于 {timeText(updatedAt)}
        </p>
      </div>

      <button
        type="button"
        onClick={start}
        data-testid="profile-nearby-start"
        className="min-h-11 w-full rounded-card bg-accent px-s3 text-body font-semibold text-white transition-colors active:bg-accent-strong"
      >
        开始采集
      </button>

      <div className="flex items-center gap-s2" data-testid="profile-nearby-panels">
        <span className="text-meta text-ink-muted">悬浮球展开显示</span>
        {(['battle', 'nearby'] as const).map((key) => {
          const on = panels[key];
          const locked = isLastEnabledNearbyOverlayPanel(panels, key);
          const label = key === 'battle' ? '战斗' : '跑图';
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              disabled={locked}
              onClick={() => setNearbyOverlayPanel(key, !on)}
              data-testid={`profile-nearby-panel-${key}`}
              className={`min-h-9 rounded-chip border px-s2 text-meta font-medium transition-colors active:bg-surface-sunken ${
                on
                  ? 'border-accent-line bg-accent-soft text-accent-strong'
                  : 'border-line bg-surface text-ink-muted'
              } disabled:opacity-60`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-caption text-ink-muted" data-testid="profile-nearby-effect">
        展开后：命中 {hits} · 附近 {pets} 只
      </p>
    </Card>
  );
}
