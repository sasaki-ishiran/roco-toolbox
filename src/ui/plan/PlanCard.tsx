import { useMemo } from 'react';
import type { CollectionPlanView } from '../../api/collectionGroups';
import { bodyMedalIconByLabel, voiceMedalIconByLabel } from '../../domain/petIcons';
import type { SpeciesEntry } from '../../domain/types';
import { PetAvatar } from '../PetAvatar';
import {
  demandForCard,
  planActionKind,
  planActionLabel,
  planBarSegments,
  planProgressText,
  planTone,
  shortFormLabel,
  type PlanActionKind,
  type PlanTone,
} from './planCardModel';

/**
 * 计划卡（我的收集 / 组内广场共用，2026-11-08）。
 *
 * 硬约束：同一个模块只允许一套卡型——两列网格、卡宽 375:171.5 / 390:179、
 * 间距 8、页边距 12。广场的差异只能用「分区、排序、角标、卡面动作」表达，
 * 不允许单列横卡或任何页内自造变体（见 docs/产品交互规范.md）。
 *
 * 展示规则（2026-11-08 用户口径）：
 * - 只画图标：体型、声音（官方奖牌，玩家一眼认）；
 * - 只写文字：性格、蛋名、形态、人、时间、状态；
 * - 同一条属性不重复表达：画了奖牌就不再写「大块头/+100」；
 * - 卡面顶部一条 4 段细进度条（2px）表达推进到哪，第二行只写「谁 + 卡在哪」，
 *   不再画五步点阵、不写历史轨迹，天数交给角标。
 */
const L = {
  avatar: { left: 9, top: 10, width: 44, height: 44 },
  bodyMedal: { left: 63, top: 40, width: 15, height: 15 },
  voiceMedal: { left: 84, top: 40, width: 15, height: 15 },
  nameRow: { left: 61, top: 21, right: 34 },
  natures: { left: 136, top: 12, right: 9 },
  reason: { left: 9, top: 62, right: 9 },
  pills: { left: 9, top: 78, right: 9 },
  action: { left: 9, top: 99, right: 9, height: 27 },
} as const;

const TONE: Record<PlanTone, { tone: string; soft: string; text: string }> = {
  amber: { tone: '#d97706', soft: '#fef3c7', text: '#b45309' },
  green: { tone: '#059669', soft: '#d1fae5', text: '#047857' },
  sky: { tone: '#0284c7', soft: '#e0f2fe', text: '#0284c7' },
  slate: { tone: '#94a3b8', soft: '#f1f5f9', text: '#64748b' },
};

const ACTION_STYLE: Record<PlanTone, { background: string; border: string; color: string }> = {
  amber: { background: '#d97706', border: '#d97706', color: '#fff' },
  green: { background: '#fff', border: '#a7f3d0', color: '#059669' },
  sky: { background: '#fff', border: '#bae6fd', color: '#0284c7' },
  slate: { background: '#fff', border: '#e2e8f0', color: '#64748b' },
};

/** 卡面主操作：我的收集按计划自身状态算，组内广场按分区覆盖。 */
export type PlanCardActionKind =
  | PlanActionKind
  | 'offer'
  | 'offered'
  | 'claim'
  | 'release'
  | 'place';

export interface PlanCardAction {
  label: string;
  kind: PlanCardActionKind;
  /** primary = 实心主色；outline = 描边；muted = 只读。默认按计划状态推导。 */
  variant?: 'primary' | 'outline' | 'muted';
}

export interface PlanPill {
  text: string;
  tone: PlanTone;
}

export interface PlanCardProps {
  plan: CollectionPlanView;
  species: readonly SpeciesEntry[];
  /** 本次需求对应的性格（只显示这一个，其余进详情）。 */
  natures: readonly string[];
  onOpen: (plan: CollectionPlanView) => void;
  onAction: (plan: CollectionPlanView, kind: PlanCardActionKind) => void;
  /** 覆盖卡面主操作（广场看别人的计划 / 接单后撤回时用）。 */
  action?: PlanCardAction;
  /** 覆盖第二行那句话（默认按计划状态生成）。 */
  reason?: string;
  /** 角标：N 人可提供、N 天没推进等。 */
  pills?: readonly PlanPill[];
  /** 置顶强调（组内广场「需要你处理」）：卡面描边，不改卡型。 */
  emphasis?: boolean;
}

export function PlanCard({
  plan,
  species,
  natures,
  onOpen,
  onAction,
  action,
  reason,
  pills,
  emphasis,
}: PlanCardProps) {
  const entry = useMemo(
    () => species.find((item) => item.gameId === plan.eggGameId),
    [species, plan.eggGameId],
  );
  const name = entry?.name ?? `#${plan.eggGameId}`;
  const formLabel = shortFormLabel(entry?.form);

  const demand = demandForCard(plan);
  const bodyIcon = demand ? bodyMedalIconByLabel(demand.body) : null;
  const voiceIcon = demand ? voiceMedalIconByLabel(demand.voice) : null;

  // 只显示本次需求对应的性格；多条需求时最多 1 行 + 「+N」
  const shown = natures.filter((item) => item.trim().length > 0);
  const more = Math.max(0, shown.length - 1);

  const tone = planTone(plan);
  const palette = TONE[tone];
  const actionLabel = action?.label ?? planActionLabel(plan);
  const resolvedKind = action?.kind ?? planActionKind(plan);
  const actionStyle = !action
    ? ACTION_STYLE[tone]
    : action.variant === 'primary'
      ? ACTION_STYLE.amber
      : action.variant === 'muted'
        ? ACTION_STYLE.slate
        : action.kind === 'offered' || action.kind === 'release'
          ? ACTION_STYLE.green
          : ACTION_STYLE.sky;
  const done = plan.status === 'done';
  const subline = reason ?? planProgressText(plan);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(plan)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(plan);
        }
      }}
      className="relative overflow-hidden rounded-xl bg-white text-left shadow-sm"
      style={{
        height: 135,
        touchAction: 'pan-y',
        ...(emphasis
          ? { boxShadow: '0 0 0 2px #f59e0b, 0 1px 2px rgba(15,23,42,0.08)' }
          : null),
      }}
      data-testid="plan-card"
      data-plan-id={plan.id}
      data-status={plan.status}
      data-progress-step={plan.progressStep}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 2,
          display: 'flex',
          gap: 1,
        }}
        data-testid="plan-card-bar"
      >
        {planBarSegments(plan).map((state, index) => (
          <span
            key={index}
            style={{
              flex: 1,
              background:
                state === 'done' ? '#10b981' : state === 'current' ? '#f59e0b' : '#e2e8f0',
            }}
          />
        ))}
      </div>

      <div style={{ position: 'absolute', ...L.avatar }}>
        <PetAvatar gameId={plan.eggGameId} name={name} size={44} />
      </div>

      {bodyIcon ? (
        <img src={bodyIcon} alt="体型" style={{ position: 'absolute', ...L.bodyMedal }} />
      ) : null}
      {voiceIcon ? (
        <img src={voiceIcon} alt="声音" style={{ position: 'absolute', ...L.voiceMedal }} />
      ) : null}

      <div
        style={{
          position: 'absolute',
          ...L.nameRow,
          display: 'flex',
          alignItems: 'baseline',
          gap: 3,
          minWidth: 0,
        }}
      >
        <span
          className="truncate font-bold text-slate-800"
          style={{ fontSize: 12.5, lineHeight: 1.2, minWidth: 0 }}
        >
          {name}
        </span>
        {demand && demand.gender ? (
          <span
            className="shrink-0"
            style={{
              fontSize: 10,
              lineHeight: 1,
              color: demand.gender === '公' ? '#0369a1' : '#db2777',
            }}
            data-testid="plan-card-gender"
          >
            {demand.gender === '公' ? '♂' : '♀'}
          </span>
        ) : null}
        {formLabel ? (
          <span
            className="shrink-0 text-slate-400"
            style={{ fontSize: 9.5, lineHeight: 1.2 }}
            data-testid="plan-card-form"
          >
            {formLabel}
          </span>
        ) : null}
      </div>

      {shown.length > 0 ? (
        <div
          style={{
            position: 'absolute',
            ...L.natures,
            textAlign: 'right',
            fontSize: 9.5,
            lineHeight: 1.35,
            zIndex: 3,
            whiteSpace: 'nowrap',
          }}
          data-testid="plan-card-natures"
        >
          <div
            className="font-bold"
            style={{ color: done ? '#047857' : '#b45309' }}
            data-active="true"
          >
            {shown[0]}
          </div>
          {more > 0 ? <div style={{ color: '#cbd5e1' }}>+{more}</div> : null}
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          ...L.reason,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 10,
          color: '#64748b',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
        data-testid="plan-card-progress"
      >
        <i
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: palette.tone,
            flexShrink: 0,
          }}
        />
        <span className="truncate">{subline}</span>
      </div>

      {pills && pills.length > 0 ? (
        <div
          style={{
            position: 'absolute',
            ...L.pills,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            overflow: 'hidden',
          }}
          data-testid="plan-card-pills"
        >
          {pills.map((pill) => (
            <span
              key={pill.text}
              style={{
                fontSize: 9,
                lineHeight: 1,
                padding: '2px 4px',
                borderRadius: 4,
                background: TONE[pill.tone].soft,
                color: TONE[pill.tone].text,
                whiteSpace: 'nowrap',
              }}
            >
              {pill.text}
            </span>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onAction(plan, resolvedKind);
        }}
        style={{
          position: 'absolute',
          ...L.action,
          borderRadius: 8,
          border: `1px solid ${actionStyle.border}`,
          background: actionStyle.background,
          color: actionStyle.color,
          fontSize: 11.5,
          fontWeight: 600,
          lineHeight: 1,
        }}
        data-testid="plan-card-action"
        data-action={resolvedKind}
      >
        {actionLabel}
      </button>
    </div>
  );
}
