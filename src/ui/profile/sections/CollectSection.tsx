import type { MouseEvent } from 'react';
import { Card } from '../../kit';
import { ImportOutcomeNotice } from '../../ImportOutcomeNotice';
import { NativeCollectorPanel } from '../../NativeCollectorPanel';
import { useCollectCompletion } from '../useCollectCompletion';
import type { SectionProps } from '../types';

/** 成功 / 失败时盖住面板自带标题行与状态行，卡头由本区块统一画（chip 与标题同一行）。 */
const HIDE_PANEL_HEADER =
  '[&_h2]:hidden [&_[data-testid=native-collector-status]]:hidden [&_[data-testid=native-collector-help]]:hidden';

/**
 * 本机采集卡（2026-11-28 UX1 方案 A）。
 *
 * 卡面只留：标题 + `?`、一行状态、一个动作、一行文件数；
 * 说明与设置收进 `?`（不用 tooltip，手机没有 hover）。
 * 边界与错误（没有采集桥 / 系统过低 / 桥报错）由面板自己始终展示，不藏在 `?` 里。
 *
 * 2026-11-28 追加一次性完成态（AV2 移植到两卡版）：
 * 自动导入结束后卡头 chip 变「已导入」，卡内一条 `role="status"` 成功条；
 * 点 × / 再点开始采集 / 离开「我的」后不再出现。失败换成琥珀条 + 重试，
 * 手动停止（没有 completion）不显示任何完成条。
 */
export function CollectSection({ ctx }: SectionProps) {
  const completion = useCollectCompletion();
  const suffix = [completion.at, completion.detail].filter(Boolean).join(' · ');

  /** 完成态还挂着时点面板里的「采集并导入」：先消费掉这次的完成条，再让面板起采集。 */
  const consumeOnStart = (event: MouseEvent<HTMLDivElement>) => {
    if (!completion.show) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-testid="native-collector-start"]')) completion.consume();
  };

  return (
    <div
      data-section="collect"
      data-testid="profile-collect"
      data-tour="profile-sync"
      className="scroll-mt-24 space-y-s3"
    >
      <ImportOutcomeNotice onOpenGroups={ctx.onOpenGroups} />
      <Card
        testId="profile-collect-card"
        title={completion.show ? '本机采集' : undefined}
        action={
          completion.show ? (
            <span
              data-testid="profile-collect-state"
              className={
                completion.success
                  ? 'rounded-chip border border-accent-line bg-accent-soft px-s2 py-s1 text-meta font-medium text-accent-strong'
                  : 'rounded-chip border border-warn-line bg-warn-soft px-s2 py-s1 text-meta font-medium text-warn'
              }
            >
              {completion.success ? '已导入' : '导入失败'}
            </span>
          ) : undefined
        }
      >
        {completion.success ? (
          <div
            role="status"
            data-testid="profile-collect-complete"
            className="flex flex-wrap items-center gap-x-s2 gap-y-s1 rounded-tile border border-accent-line bg-accent-soft px-s3 py-s2"
          >
            <span className="min-w-0 flex-1 whitespace-nowrap text-caption font-semibold text-accent-strong">
              {'✓ 已采集并导入'}
              {suffix ? ` · ${suffix}` : ''}
            </span>
            <button
              type="button"
              onClick={ctx.onGoDashboard}
              data-testid="profile-collect-complete-dashboard"
              className="min-h-8 shrink-0 rounded-tile px-s2 text-meta font-medium text-accent-strong transition-colors active:bg-surface-sunken"
            >
              看看板
            </button>
            <button
              type="button"
              aria-label="关闭完成提示"
              onClick={completion.dismiss}
              data-testid="profile-collect-complete-dismiss"
              className="flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-full text-meta text-ink-muted transition-colors active:bg-surface-sunken"
            >
              ×
            </button>
          </div>
        ) : null}
        {completion.failed ? (
          <div
            role="status"
            data-testid="profile-collect-import-failed"
            className="flex flex-wrap items-center gap-x-s2 gap-y-s1 rounded-tile border border-warn-line bg-warn-soft px-s3 py-s2"
          >
            <span className="min-w-0 flex-1 text-caption font-medium text-warn">
              {'已停止，但导入失败'}
              {completion.error ? ` · ${completion.error}` : ''}
            </span>
            <button
              type="button"
              onClick={completion.retry}
              data-testid="profile-collect-retry"
              className="min-h-8 shrink-0 rounded-tile px-s2 text-meta font-medium text-warn transition-colors active:bg-surface-sunken"
            >
              重试
            </button>
            <button
              type="button"
              aria-label="关闭导入失败提示"
              onClick={completion.dismiss}
              data-testid="profile-collect-failed-dismiss"
              className="flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-full text-meta text-warn transition-colors active:bg-surface-sunken"
            >
              ×
            </button>
          </div>
        ) : null}
        <div
          onClickCapture={consumeOnStart}
          className={completion.show ? HIDE_PANEL_HEADER : undefined}
        >
          <NativeCollectorPanel compact />
        </div>
      </Card>
    </div>
  );
}
