import { Card } from '../../kit';
import { ImportOutcomeNotice } from '../../ImportOutcomeNotice';
import { NativeCollectorPanel } from '../../NativeCollectorPanel';
import { setCaptureFocus, useCaptureFocus } from '../../../collector/captureFocusStore';
import { useNearbyCardStats } from '../useNearbyCardStats';
import type { SectionProps } from '../types';

/**
 * 采集卡（2026-11-28 UX1 第三版定稿）。
 *
 * 一张卡同时管「附近看」与「本机导入」：只读结果块（战斗 / 跑图只看显示哪一类）、
 * 采集目标分段、上下两个启动入口（开始采集=只看，采集并导入=入库）、文件与详情。
 */
export function CollectSection({ ctx }: SectionProps) {
  const stats = useNearbyCardStats();
  const focus = useCaptureFocus();

  return (
    <div data-section="collect" data-testid="profile-collect" className="scroll-mt-24 space-y-s3">
      <ImportOutcomeNotice onOpenGroups={ctx.onOpenGroups} />
      <Card testId="profile-collect-card">
        <NativeCollectorPanel
          compact
          nearby={{
            pets: stats.pets,
            rare: stats.rare,
            targets: stats.targets,
            encounter: stats.encounter ? { guardName: stats.encounter.guardName, level: stats.encounter.level } : null,
            hit: stats.hit,
            updatedAt: stats.updatedAt,
          }}
          focus={focus}
          onFocusChange={setCaptureFocus}
          onOpenNearby={ctx.onGoNearby}
          onOpenDashboard={ctx.onGoDashboard}
        />
      </Card>
    </div>
  );
}
