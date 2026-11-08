import { useEffect, useMemo, useState } from 'react';
import type { CollectionPlanView } from '../../api/collectionGroups';
import { bodyMedalIconByLabel, voiceMedalIconByLabel } from '../../domain/petIcons';
import type { SpeciesEntry } from '../../domain/types';
import { ModalSurface } from '../primitives/ModalSurface';
import { PLAN_STEP_LABELS, planProgressText, planStepIndex, planTone, shortFormLabel } from './planCardModel';

export interface PlanDetailSheetProps {
  plan: CollectionPlanView | null;
  species: readonly SpeciesEntry[];
  members: readonly { accountId: string; displayName: string }[];
  viewerAccountId: string;
  onClose: () => void;
  onStart: (plan: CollectionPlanView) => void;
  onComplete: (plan: CollectionPlanView) => void;
  onDelete: (plan: CollectionPlanView) => void;
  onSaveOffer: (plan: CollectionPlanView, note: string) => void;
  onWithdrawOffer: (plan: CollectionPlanView) => void;
  /** 交给现有的需求发布流程（发需求后计划自动进入「待接单」）。 */
  onPublishDemand: (plan: CollectionPlanView) => void;
  /** 我接的单：标记已上窝（打通第 4 步「待我确认」）。 */
  onPlaceDemand?: (plan: CollectionPlanView) => void;
}

const TONE_COLOR = {
  amber: { tone: '#d97706', soft: '#fef3c7', text: '#b45309' },
  green: { tone: '#059669', soft: '#d1fae5', text: '#047857' },
  sky: { tone: '#0284c7', soft: '#e0f2fe', text: '#0284c7' },
  slate: { tone: '#94a3b8', soft: '#f1f5f9', text: '#64748b' },
};

/**
 * 计划二级页（2026-11-08 减负）。
 *
 * 只放卡面放不下的内容：完整条件、承接人、备注、低频管理动作。
 * 不再重复画五步大进度（卡面第二行已经说了现在停在哪），
 * 自己的计划也不显示「我能提供」，删除 / 直接完成收进「…」。
 */
export function PlanDetailSheet({
  plan,
  species,
  members,
  viewerAccountId,
  onClose,
  onStart,
  onComplete,
  onDelete,
  onSaveOffer,
  onWithdrawOffer,
  onPublishDemand,
  onPlaceDemand,
}: PlanDetailSheetProps) {
  const [note, setNote] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const entry = useMemo(
    () => (plan ? species.find((item) => item.gameId === plan.eggGameId) : undefined),
    [plan, species],
  );
  const myOffer = plan?.offers.find((offer) => offer.offerAccountId === viewerAccountId);

  useEffect(() => {
    setNote(myOffer?.note ?? '');
  }, [plan?.id, myOffer?.note]);

  useEffect(() => {
    setMenuOpen(false);
  }, [plan?.id]);

  if (!plan) return null;

  const name = entry?.name ?? `#${plan.eggGameId}`;
  const formLabel = shortFormLabel(entry?.form);
  const tone = planTone(plan);
  const palette = TONE_COLOR[tone];
  const mine = plan.memberAccountId === viewerAccountId;
  const demand = plan.demands[0] ?? null;
  const bodyIcon = demand ? bodyMedalIconByLabel(demand.body) : null;
  const voiceIcon = demand ? voiceMedalIconByLabel(demand.voice) : null;
  const myDemand = plan.demands.find((item) => item.claimerAccountId === viewerAccountId);
  const canPlace = !mine && myDemand != null && myDemand.placedAt == null;

  const memberName = (accountId: string | null | undefined) =>
    members.find((member) => member.accountId === accountId)?.displayName ??
    (accountId === viewerAccountId ? '我' : '组员');

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes(),
    ).padStart(2, '0')}`;
  };

  // 详情才是放大看流程的地方：完整五步 + 能拿到的经手人 / 时间。
  const stepIndex = planStepIndex(plan);
  const claimer = demand?.claimerAccountId ? memberName(demand.claimerAccountId) : '';
  const stepDetails: string[] = [
    demand ? '已发布需求' : '先发需求',
    claimer ? `${claimer} 认领` : '还没人认领',
    demand?.placedAt ? `${claimer} 上窝 · ${formatTime(demand.placedAt)}` : '还没上窝',
    demand?.placedAt ? (mine ? '等你确认' : '等发布人确认') : '还没到这一步',
    plan.status === 'done' ? '已结单' : '还没完成',
  ];

  return (
    <ModalSurface
      open
      placement="sheet"
      title={`${name}${formLabel ? ` · ${formLabel}` : ''}`}
      onClose={onClose}
      testId="plan-detail-sheet"
      closeTestId="plan-detail-close"
      footer={
        <div className="flex items-center gap-2">
          {mine ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                className="min-h-[32px] rounded-lg border border-slate-200 px-3 text-xs text-slate-500"
                data-testid="plan-detail-more"
              >
                …
              </button>
              {menuOpen ? (
                <div className="absolute bottom-full left-0 z-10 mb-1 w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  {plan.status !== 'done' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        if (
                          window.confirm(
                            '直接完成会把这条计划下还没结单的需求一起撤回，确定吗？',
                          )
                        ) {
                          onComplete(plan);
                        }
                      }}
                      className="block w-full px-3 py-2 text-left text-xs text-slate-600"
                      data-testid="plan-detail-complete"
                    >
                      直接完成
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      if (
                        window.confirm(
                          '删除会同时撤回这颗蛋的需求和别人的认领，且不能恢复，确定删除吗？',
                        )
                      ) {
                        onDelete(plan);
                      }
                    }}
                    className="block w-full px-3 py-2 text-left text-xs text-rose-600"
                    data-testid="plan-detail-delete"
                  >
                    删除计划
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="ml-auto flex gap-2">
            {mine && plan.status === 'backlog' ? (
              <button
                type="button"
                onClick={() => onStart(plan)}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                data-testid="plan-detail-start"
              >
                开始
              </button>
            ) : null}
            {mine && plan.status === 'active' && !demand ? (
              <button
                type="button"
                onClick={() => onPublishDemand(plan)}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                data-testid="plan-detail-publish"
              >
                发需求
              </button>
            ) : null}
            {canPlace && onPlaceDemand ? (
              <button
                type="button"
                onClick={() => onPlaceDemand(plan)}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                data-testid="plan-detail-place"
              >
                标已上窝
              </button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-baseline gap-2">
          <span className="text-xs" style={{ color: palette.text }}>
            {planProgressText(plan)}
          </span>
          <span className="ml-auto text-[11px] text-slate-400">
            由 {memberName(plan.memberAccountId)} 发布
          </span>
        </div>

        <div data-testid="plan-detail-steps">
          <h3 className="mb-2 text-xs font-semibold text-slate-600">五步进度</h3>
          <ol className="flex flex-col gap-1">
            {PLAN_STEP_LABELS.map((label, index) => {
              const done = stepIndex > index;
              const current = stepIndex === index;
              return (
                <li
                  key={label}
                  className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs"
                  style={{
                    background: current ? '#fef3c7' : done ? '#ecfdf5' : '#f8fafc',
                    color: current ? '#b45309' : done ? '#047857' : '#94a3b8',
                  }}
                  data-state={done ? 'done' : current ? 'current' : 'todo'}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: current ? '#f59e0b' : done ? '#10b981' : '#cbd5e1',
                    }}
                  />
                  <span className="font-medium">{label}</span>
                  <span className="ml-auto text-[11px]">{stepDetails[index]}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-slate-600">本次需求</h3>
          {plan.demands.length === 0 ? (
            <p className="text-xs text-slate-400">还没有发需求</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {plan.demands.map((item, index) => (
                <li
                  key={`${item.nature}-${index}`}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600"
                >
                  {bodyIcon ? (
                    <img src={bodyMedalIconByLabel(item.body) ?? bodyIcon} alt={item.body} className="h-4 w-4" />
                  ) : null}
                  {voiceIcon ? (
                    <img src={voiceMedalIconByLabel(item.voice) ?? voiceIcon} alt={item.voice} className="h-4 w-4" />
                  ) : null}
                  <span className="font-medium">{item.nature}</span>
                  <span className="text-[11px] text-slate-400">{item.gender}</span>
                  <span className="ml-auto text-[11px]">
                    {item.status === 'claimed'
                      ? `已认领 · ${memberName(item.claimerAccountId)}${item.placedAt ? ' · 已上窝' : ''}`
                      : '待接单'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-slate-600">提供者备注</h3>
          {plan.offers.length === 0 ? (
            <p className="text-xs text-slate-400">还没有人提供</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {plan.offers.map((offer) => (
                <li
                  key={offer.offerAccountId}
                  className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600"
                >
                  <span className="font-medium">{offer.offerDisplayName}</span>
                  {offer.note ? <span className="ml-1 text-slate-500">{offer.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {mine ? null : (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-slate-600">我能提供</h3>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="备注（例如：这窝今晚出壳）"
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
              data-testid="plan-detail-note"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onSaveOffer(plan, note)}
                className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700"
                data-testid="plan-detail-offer"
              >
                {myOffer ? '保存备注' : '我能提供'}
              </button>
              {myOffer ? (
                <button
                  type="button"
                  onClick={() => onWithdrawOffer(plan)}
                  className="rounded-lg px-2 py-1.5 text-xs text-slate-400"
                  data-testid="plan-detail-withdraw"
                >
                  撤回
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </ModalSurface>
  );
}
