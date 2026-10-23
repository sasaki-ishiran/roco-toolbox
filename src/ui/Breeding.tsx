import type { NestPlan } from '../domain/nestPlan';
import { NestPlanCard } from './NestPlanCard';

/** 自己孵（配窝）：完整摆位与配对从看板迁到这里（2026-10-24）。 */
export function Breeding({ plans }: { plans: NestPlan[] }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="breeding">
      <h2 className="text-sm font-medium text-slate-500">配窝建议</h2>
      <p className="mt-1 text-xs text-slate-400">
        按账号给出哪只进哪个窝、和谁配、怎么摆；缺的资源到「覆盖矩阵」看怎么迭代，或到「求蛋」去弄。
      </p>
      <NestPlanCard plans={plans} />
    </section>
  );
}
