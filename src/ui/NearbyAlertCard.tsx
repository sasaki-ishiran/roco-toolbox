import { useCallback } from 'react';
import { toggleRareAlert, useRareAlert } from '../collector/rareAlertStore';
import { isBattleTargetEmpty, useBattleTarget } from '../collector/battleTargetStore';
import { isLastEnabledNearbyOverlayPanel, setNearbyOverlayPanel, useNearbyOverlayPanels } from '../nearby/overlayPanels';
import { useNearbyTargets } from '../nearby/nearbyTargetStore';
import { hasNearbyOverlayShell } from '../nearby/overlayBridge';

/**
 * 「附近」详情顶部的强提醒卡（2026-11-28 UX1 方案 A）。
 *
 * 四个开关全部来自现有 store：稀有提醒 / 蹲守名单 / 战斗目标 / 悬浮球显示。
 * 不新建状态、不加模式枚举；点「管理」只做滚动定位，判定逻辑不动。
 */
function scrollToTestId(testId: string) {
  document.querySelector(`[data-testid="${testId}"]`)?.scrollIntoView({ block: 'center' });
}

function RowButton({ children, onClick, testId }: { children: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="min-h-8 shrink-0 rounded-chip px-s2 text-meta font-medium text-accent-strong transition-colors active:bg-surface-sunken"
    >
      {children} ›
    </button>
  );
}

export function NearbyAlertCard() {
  const rareAlert = useRareAlert();
  const targets = useNearbyTargets();
  const battleTarget = useBattleTarget();
  const panels = useNearbyOverlayPanels();
  const shellSupported = hasNearbyOverlayShell();

  const battleSet = !isBattleTargetEmpty(battleTarget);
  const manageTargets = useCallback(() => {
    scrollToTestId('nearby-target-row');
    (document.querySelector('[data-testid="nearby-target-edit"]') as HTMLButtonElement | null)?.click();
  }, []);
  const manageBattle = useCallback(() => scrollToTestId('battle-target-editor'), []);

  return (
    <section className="rounded-card border border-line bg-surface p-s3 shadow-card" data-testid="nearby-alert-card">
      <h2 className="text-title font-semibold text-ink-strong">强提醒</h2>
      <div className="mt-s2 divide-y divide-line">
        <div className="flex items-center justify-between gap-s2 py-s2">
          <div className="min-w-0">
            <p className="text-body text-ink">稀有提醒</p>
            <p className="text-caption text-ink-muted">稀有精灵出现时弹通知、震动</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={rareAlert}
            aria-label="稀有提醒"
            data-testid="nearby-alert-rare"
            onClick={() => toggleRareAlert()}
            className={`min-h-8 shrink-0 rounded-chip border px-s2 text-meta font-medium ${
              rareAlert ? 'border-accent-line bg-accent-soft text-accent-strong' : 'border-line text-ink-muted'
            }`}
          >
            {rareAlert ? '已开启' : '已关闭'}
          </button>
        </div>

        <div className="flex items-center justify-between gap-s2 py-s2">
          <div className="min-w-0">
            <p className="text-body text-ink">蹲守名单</p>
            <p className="text-caption text-ink-muted">{targets.length > 0 ? `已选 ${targets.length} 只` : '还没选目标'}</p>
          </div>
          <RowButton testId="nearby-alert-targets" onClick={manageTargets}>管理</RowButton>
        </div>

        <div className="flex items-center justify-between gap-s2 py-s2">
          <div className="min-w-0">
            <p className="text-body text-ink">战斗目标</p>
            <p className="text-caption text-ink-muted">{battleSet ? '已设条件，命中会变色' : '还没设条件'}</p>
          </div>
          <RowButton testId="nearby-alert-battle" onClick={manageBattle}>设置</RowButton>
        </div>

        {shellSupported ? (
        <div className="flex items-center justify-between gap-s2 py-s2">
          <div className="min-w-0">
            <p className="text-body text-ink">悬浮球显示</p>
            <p className="text-caption text-ink-muted">展开后显示哪几块，至少留一项</p>
          </div>
          <div className="flex shrink-0 items-center gap-s1" data-testid="nearby-alert-panels">
            {(['battle', 'nearby'] as const).map((key) => {
              const on = panels[key];
              const locked = isLastEnabledNearbyOverlayPanel(panels, key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  disabled={locked}
                  data-testid={`nearby-alert-panel-${key}`}
                  onClick={() => setNearbyOverlayPanel(key, !on)}
                  className={`min-h-8 rounded-chip border px-s2 text-meta font-medium ${
                    on ? 'border-accent-line bg-accent-soft text-accent-strong' : 'border-line text-ink-muted'
                  } disabled:opacity-60`}
                >
                  {key === 'battle' ? '战斗' : '跑图'}
                </button>
              );
            })}
          </div>
        </div>
        ) : null}
      </div>
    </section>
  );
}
