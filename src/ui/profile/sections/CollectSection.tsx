import { Card } from '../../kit';
import { ImportOutcomeNotice } from '../../ImportOutcomeNotice';
import { NativeCollectorPanel } from '../../NativeCollectorPanel';
import type { SectionProps } from '../types';

/**
 * 本机采集卡（2026-11-28 UX1 方案 A）。
 *
 * 卡面只留：标题 + `?`、一行状态、一个动作、一行文件数；
 * 说明与设置收进 `?`（不用 tooltip，手机没有 hover）。
 * 边界与错误（没有采集桥 / 系统过低 / 桥报错）由面板自己始终展示，不藏在 `?` 里。
 */
export function CollectSection({ ctx }: SectionProps) {
  return (
    <div data-section="collect" data-testid="profile-collect" className="scroll-mt-24 space-y-s3">
      <ImportOutcomeNotice onOpenGroups={ctx.onOpenGroups} />
      <Card testId="profile-collect-card">
        <NativeCollectorPanel compact />
      </Card>
    </div>
  );
}
