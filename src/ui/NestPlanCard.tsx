import { eggGroupNames } from '../data/catalog';
import { NEST_SIZE } from '../domain/nestGeometry';
import { gradeLabel, type PetGrade } from '../domain/petFilters';
import type { NestPairing, NestPet, NestPlan, NestTier } from '../domain/nestPlan';
import { GenderMark } from './GenderMark';
import { useTargetMode } from './targetModeStore';

const TIER_NAME: Record<NestTier, string> = {
  academy: '学院',
  normal60: '普通',
  normal30: '普通',
};
/** 每档「单个目标性格」的遗传概率（学院遗传的是学院那只自己的性格） */
const CHANCE_BY_TIER: Record<NestTier, number> = {
  academy: 1,
  normal60: 0.6,
  normal30: 0.3,
};
const TIER_CLASS: Record<NestTier, string> = {
  academy: 'bg-emerald-600 text-white',
  normal60: 'bg-sky-600 text-white',
  normal30: 'bg-slate-400 text-white',
};
const CHIP = 'rounded bg-slate-100 px-1.5 py-0.5 text-[10px] leading-none text-slate-600';
const groupName = (groupId: number): string => eggGroupNames[groupId] ?? `蛋组${groupId}`;

/** 摆位图里每个小窝的边长（像素）。 */
const CELL = 11;
/** 坐标单位是「地板单元」、1 窝 = NEST_SIZE 单元，所以一个单元只有 CELL / NEST_SIZE 像素。 */
const UNIT = CELL / NEST_SIZE;

/** 窝块里只画得下 4 个字：先把形态名（下划线后的部分）去掉，再截断 */
const shortName = (name: string): string => name.split('_')[0].slice(0, 4);

/** 一条配对一种颜色（摆位图的线 + 下面对应的卡片用同一色，便于对号入座） */
const PAIRING_COLORS = [
  '#7c3aed',
  '#d97706',
  '#0d9488',
  '#65a30d',
  '#4f46e5',
  '#c026d3',
  '#e11d48',
  '#0891b2',
  '#b45309',
  '#1d4ed8',
  '#047857',
  '#a21caf',
];
/** 第 n 条配对的线色；超过一轮（12 条）时用**虚线/空心点**区分同色的两条 */
const pairingColor = (index: number): string => PAIRING_COLORS[index % PAIRING_COLORS.length];
const pairingDashed = (index: number): boolean => index >= PAIRING_COLORS.length;

interface PairingStyle {
  color: string;
  dashed: boolean;
}

/** 一条配对的展示键（同一对精灵补多个性格 → 同一行；同名同内容的两只精灵 key 不同，不会被并） */
const viewKeyOf = (pairing: NestPairing): string =>
  pairing.academyParent
    ? `academy|${pairing.academyParent.key}|${pairing.grade}`
    : `normal|${pairing.mother.key}|${pairing.father.key}|${pairing.grade}`;

/**
 * 摆位图：按坐标把窝画出来（绿块=学院小窝），线=会配对的边。
 * 图层顺序 = 窝块 → 连线 → 名字：线画在窝块**之上**（否则会被方块盖住），名字再压在线上（保证读得清）。
 */
function LayoutMap({ plan, styleByKey }: { plan: NestPlan; styleByKey: Map<string, PairingStyle> }) {
  if (plan.slots.length === 0) return null;
  const xs = plan.slots.map((slot) => slot.position.x);
  const ys = plan.slots.map((slot) => slot.position.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  // 图形本身 = 跨度 + 1 窝（最后一个窝自己占的宽/高），四周再各留 1 窝边距
  // （不留的话最外圈方块的描边会被 viewBox 裁掉）
  const width = Math.max(...xs) - minX + 3 * NEST_SIZE;
  const height = Math.max(...ys) - minY + 3 * NEST_SIZE;
  const px = (value: number, base: number): number => (value - base + NEST_SIZE) * UNIT;
  const position = (slot: { position: { x: number; y: number } }) => ({
    x: px(slot.position.x, minX),
    y: px(slot.position.y, minY),
  });
  return (
    <svg
      viewBox={`0 0 ${width * UNIT} ${height * UNIT}`}
      className="mt-1 max-h-36 w-full rounded-lg bg-slate-50"
      role="img"
      aria-label="小窝摆位图"
      data-testid="nest-layout"
    >
      {plan.slots.map((slot, index) => {
        const { x, y } = position(slot);
        return (
          <rect
            key={`nest-${index}`}
            x={x}
            y={y}
            width={CELL}
            height={CELL}
            rx={2}
            fill={slot.academy ? '#059669' : '#ffffff'}
            stroke={slot.academy ? '#047857' : '#cbd5e1'}
            strokeWidth={0.6}
          />
        );
      })}
      {plan.pairings.map((pairing, index) => (
        <line
          key={`line-${index}`}
          x1={px(pairing.fatherPosition.x, minX) + CELL / 2}
          y1={px(pairing.fatherPosition.y, minY) + CELL / 2}
          x2={px(pairing.motherPosition.x, minX) + CELL / 2}
          y2={px(pairing.motherPosition.y, minY) + CELL / 2}
          stroke={styleByKey.get(viewKeyOf(pairing))?.color ?? '#64748b'}
          strokeDasharray={styleByKey.get(viewKeyOf(pairing))?.dashed ? '2 1.6' : undefined}
          strokeWidth={0.7}
          strokeLinecap="round"
        />
      ))}
      {plan.slots.map((slot, index) => {
        const { x, y } = position(slot);
        const genderMark = slot.pet.gender === '公' ? '♂' : '♀';
        return (
          <g key={`label-${index}`}>
            <text
              x={x + CELL / 2}
              y={y + CELL / 2 - 0.5}
              textAnchor="middle"
              fontSize={2.3}
              fill={slot.academy ? '#ffffff' : '#334155'}
            >
              {shortName(slot.pet.name)}
            </text>
            <text
              x={x + CELL / 2}
              y={y + CELL / 2 + 2.8}
              textAnchor="middle"
              fontSize={2.4}
              fill={slot.academy ? '#a7f3d0' : slot.pet.gender === '公' ? '#0284c7' : '#db2777'}
            >
              {genderMark}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** 一条配对（同一对精灵能补多个性格 → 合并成一条；学院 1:2 也合并成一条） */
interface PairingView {
  key: string;
  tier: NestTier;
  groupIds: number[];
  /** 这一对能补的性格（普通窝「母 X × 公 Y」能同时出 X 和 Y） */
  natureNames: string[];
  grade: string;
  /** 左边那只：学院档 = 学院小窝那只，普通档 = 母本 */
  left: NestPet;
  /** 右边：普通档 1 只；学院那只挂 2 个配对方时并排写多只 */
  partners: NestPet[];
  academyParent: NestPet | null;
  expected: NestPairing['expected'];
  /** 这一条在摆位图里的线色（卡片也用同一色） */
  color: string;
  /** 颜色轮回到同一色时用虚线/空心点区分 */
  dashed: boolean;
}

/**
 * 这条建议**产出目标性格的总概率**。
 *
 * 同一对精灵常常能同时补两个性格（母带 A、公带 B）：两个性格各 30%，且**互斥**
 * （一颗蛋只会有一个性格）→ 合计 60%。所以卡片上的百分比按「合计」显示——
 * 只写单条线的 30% 会低估这条线的价值（2026-10-06 用户指出）。
 */
const viewChance = (view: Pick<PairingView, 'tier' | 'natureNames'>): number =>
  CHANCE_BY_TIER[view.tier] * view.natureNames.length;

const percentLabel = (chance: number): string => `${Math.round(chance * 100)}%`;

const mergePairings = (pairings: NestPairing[]): PairingView[] => {
  const views: PairingView[] = [];
  const byKey = new Map<string, PairingView>();
  for (const pairing of pairings) {
    // 键用个体身份 + 档位，**不含性格**：同一对精灵补多个性格要并成一行；
    // 同名同内容的两只精灵 key 不同，不会被并；学院那只挂 2 个配对方也只并到它自己这一行。
    const key = viewKeyOf(pairing);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.partners.some((partner) => partner.key === pairing.partner.key)) {
        existing.partners.push(pairing.partner);
      }
      for (const groupId of pairing.groupIds) {
        if (!existing.groupIds.includes(groupId)) existing.groupIds.push(groupId);
      }
      if (!existing.natureNames.includes(pairing.natureName)) {
        existing.natureNames.push(pairing.natureName);
      }
      continue;
    }
    const view: PairingView = {
      key,
      tier: pairing.tier,
      groupIds: [...pairing.groupIds],
      natureNames: [pairing.natureName],
      grade: pairing.grade,
      left: pairing.academyParent ?? pairing.mother,
      partners: [pairing.partner],
      academyParent: pairing.academyParent,
      expected: pairing.expected,
      color: pairingColor(views.length),
      dashed: pairingDashed(views.length),
    };
    byKey.set(key, view);
    views.push(view);
  }
  // 产出目标性格概率高的排前面（同率时按蛋组、性格稳定排序）
  views.sort(
    (a, b) =>
      viewChance(b) - viewChance(a) ||
      (a.groupIds[0] ?? 0) - (b.groupIds[0] ?? 0) ||
      (a.natureNames[0] ?? '').localeCompare(b.natureNames[0] ?? '') ||
      a.key.localeCompare(b.key),
  );
  return views;
};

/** 一行「概率 + 补哪个缺口」：概率 · 补 <蛋组> <性格> <档位> 种公 */
function PairingHead({
  tier,
  groupIds,
  natureNames,
  grade,
}: Pick<PairingView, 'tier' | 'groupIds' | 'natureNames' | 'grade'>) {
  const mode = useTargetMode();
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none font-medium ${TIER_CLASS[tier]}`}>
        {TIER_NAME[tier]} {percentLabel(CHANCE_BY_TIER[tier] * natureNames.length)}
      </span>
      <span className="text-[10px] leading-none text-slate-400">补</span>
      {groupIds.map((groupId) => (
        <span key={groupId} className={CHIP}>
          {groupName(groupId)}
        </span>
      ))}
      {natureNames.map((natureName) => (
        <span
          key={natureName}
          className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] leading-none font-medium text-amber-700"
        >
          {natureName}
        </span>
      ))}
      <span className={CHIP}>{gradeLabel(grade as PetGrade, mode)}</span>
      <span className="text-[10px] leading-none text-slate-400">种公</span>
    </div>
  );
}

/** 配对卡片：一条配窝建议（左侧色条 + 圆点 = 摆位图里那条线的颜色，便于对号入座） */
function PairingCard({ view, testId }: { view: PairingView; testId: string }) {
  return (
    <li
      className="rounded-xl border-l-4 bg-slate-50 px-2.5 py-2"
      style={{ borderLeftColor: view.color }}
      data-testid={testId}
    >
      <div className="flex items-start gap-1.5">
        <span
          className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
          style={
            view.dashed
              ? { border: `2px solid ${view.color}` } // 与虚线一一对应
              : { backgroundColor: view.color }
          }
          aria-hidden="true"
        />
        <PairingHead
          tier={view.tier}
          groupIds={view.groupIds}
          natureNames={view.natureNames}
          grade={view.grade}
        />
      </div>
      <p className="mt-1 text-[13px] text-slate-700">
        <span className="font-medium">{view.left.name}</span> <GenderMark gender={view.left.gender} />
        {view.academyParent ? (
          <span className="ml-1 text-[11px] font-medium text-emerald-600">学院小窝</span>
        ) : null}
        <span className="mx-1 text-slate-300">×</span>
        {view.partners.map((partner, index) => (
          <span key={`${partner.key}-${index}`}>
            <span className="font-medium">{partner.name}</span> <GenderMark gender={partner.gender} />
            {index < view.partners.length - 1 ? <span className="text-slate-400"> / </span> : null}
          </span>
        ))}
      </p>
      {/* 位置：去背包找这两只。账号已经写在分组标题里了，这里只写盒子/第几位 */}
      <p className="mt-0.5 text-[11px] text-slate-400">
        {view.left.box}
        <span className="mx-1 text-slate-300">×</span>
        {view.partners.map((partner, index) => (
          <span key={`box-${partner.key}-${index}`}>
            {partner.box}
            {index < view.partners.length - 1 ? <span className="text-slate-400"> / </span> : null}
          </span>
        ))}
      </p>
    </li>
  );
}

/**
 * 「一键配窝」卡片：按账号给出**哪只进哪个窝、和谁配、小窝怎么摆**。
 * 数据来自 `buildNestPlans`（第一期：可配建议）。候选配对默认收起，用户可自行替换。
 */
export function NestPlanCard({ plans }: { plans: NestPlan[] }) {
  const usable = plans.filter((plan) => plan.pairings.length > 0);
  if (usable.length === 0) {
    return (
      <p className="mt-1 text-sm text-slate-400" data-testid="breed-empty">
        当前没有能排的配窝方案——先到「覆盖度」挑要补的缺口，或缺的配对方/母本还没到位。
      </p>
    );
  }
  return (
    <div className="mt-1 space-y-4" data-testid="breed-list">
      {usable.map((plan) => {
        const views = mergePairings(plan.pairings);
        const styleByKey = new Map(views.map((view) => [view.key, { color: view.color, dashed: view.dashed }]));
        return (
          <div key={plan.account} data-testid="breed-account">
            <h3 className="mb-1 text-xs font-medium text-slate-400">
              {plan.account} · 用 {plan.nestsUsed}/{plan.nestsTotal} 个窝
            </h3>
            <LayoutMap plan={plan} styleByKey={styleByKey} />
            <ul className="mt-1.5 space-y-1.5">
              {views.map((view) => (
                <PairingCard key={view.key} view={view} testId="breed-suggestion" />
              ))}
            </ul>

            {plan.blockedLinks.length > 0 ? (
              <p className="mt-1 text-[11px] text-rose-600" data-testid="breed-blocked">
                注意：有 {plan.blockedLinks.length} 条连线会产出非目标蛋
              </p>
            ) : null}

          </div>
        );
      })}
    </div>
  );
}
