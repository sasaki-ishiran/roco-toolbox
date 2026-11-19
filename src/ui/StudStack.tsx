import { useState, type ReactNode } from 'react';
import { eggGroupNames } from '../data/catalog';
import { petBodyMedalIcon, petVoiceMedalIcon } from '../domain/petIcons';
import type { StudCandidate } from '../domain/studCandidates';
import { PetAvatar } from './PetAvatar';

/**
 * 种公候选的堆叠卡（2026-11-19 用户口径）。
 *
 * 默认展示权重最高的一只（本号能配 > 跨号能传 > 只能求助，再看真实蛋组数与手里公的只数）；
 * 点一下向上抽走、下方展开该蛋组全部公（依次进场），点某只即选中并收起。
 * 性格由格子上方锁定，卡片不写性格、也不拿性格当权重。
 */
const TIER_BORDER = {
  many: 'border-rose-400',
  ok: 'border-violet-300',
  single: 'border-sky-300',
  few: 'border-emerald-300',
} as const;

type Tier = keyof typeof TIER_BORDER;

export function studTier(candidate: Pick<StudCandidate, 'groupIds' | 'males'>): Tier {
  if (candidate.groupIds.length >= 2) return candidate.males >= 2 ? 'many' : 'ok';
  return candidate.males >= 2 ? 'single' : 'few';
}

const routeLabel = (candidate: StudCandidate): string =>
  candidate.route === 'self'
    ? '本号可配'
    : candidate.route === 'transfer'
      ? `跨号 · ${candidate.sourceAccount ?? '别的号'}`
      : '只能求助';

const routeClass = (candidate: StudCandidate): string =>
  candidate.route === 'self'
    ? 'bg-emerald-100 text-emerald-700'
    : candidate.route === 'transfer'
      ? 'bg-sky-100 text-sky-700'
      : 'bg-slate-100 text-slate-500';

export interface StudStackProps {
  candidates: readonly StudCandidate[];
  /** 当前选中（默认第一只） */
  selectedGameId?: number | null;
  onSelect?: (candidate: StudCandidate) => void;
  /** 收起态放在右侧的小组求助卡 */
  aside?: ReactNode;
}

function CandidateCard({
  candidate,
  index,
  testId,
}: {
  candidate: StudCandidate;
  index?: number;
  testId: string;
}) {
  const bodyIcon = petBodyMedalIcon(candidate.medalBody, candidate.weightPercent);
  const voiceIcon = petVoiceMedalIcon(candidate.voiceDb);
  const groups = candidate.groupIds.map((id) => eggGroupNames[id] ?? `蛋组${id}`);
  return (
    <article
      className={`relative h-[96px] w-full overflow-hidden rounded-xl border-[1.5px] bg-gradient-to-b from-sky-50 to-white p-0 text-left ${TIER_BORDER[studTier(candidate)]}`}
      style={index != null ? { animationDelay: `${index * 45}ms` } : undefined}
      data-testid={testId}
      data-game-id={candidate.gameId}
    >
      <span className="absolute left-1.5 top-1 text-[8.5px] font-semibold text-slate-500">
        No.{candidate.gameId % 1000}
      </span>
      <span className="absolute right-1.5 top-1 flex items-center gap-0.5" data-testid="stud-card-medals">
        {bodyIcon ? <img src={bodyIcon} alt={candidate.medalBody ?? ''} className="h-3 w-3" /> : null}
        {voiceIcon ? (
          <img src={voiceIcon} alt="" title={`声音 ${candidate.voiceDb}dB`} className="h-3 w-3" />
        ) : null}
      </span>
      <div className="absolute left-2 top-[18px] flex h-[42px] w-[42px] items-center justify-center">
        <PetAvatar gameId={candidate.gameId} name={candidate.name} size={44} />
      </div>
      <p className="absolute left-[58px] right-1.5 top-[18px] truncate text-[12px] font-bold text-slate-900">
        {candidate.name} <span className="text-[9px] text-slate-400">♂</span>
      </p>
      <p className="absolute left-[58px] right-1.5 top-[36px] truncate text-[9.5px] text-slate-500">
        {candidate.voiceDb != null ? `${candidate.voiceDb}dB` : '—'}
      </p>
      <p className="absolute left-[58px] right-1.5 top-[52px] flex flex-wrap gap-0.5 overflow-hidden">
        {groups.map((label) => (
          <span key={label} className="rounded bg-sky-100 px-[3px] text-[8.5px] leading-[11px] text-sky-800">
            {label}
          </span>
        ))}
      </p>
      <span
        className={`absolute bottom-[7px] right-1.5 rounded-full px-1.5 text-[8.5px] font-bold leading-[13px] ${routeClass(candidate)}`}
        data-testid="stud-card-route"
      >
        {routeLabel(candidate)}
      </span>
    </article>
  );
}

export function StudStack({ candidates, selectedGameId, onSelect, aside }: StudStackProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(selectedGameId ?? null);
  if (candidates.length === 0) return null;

  const selected = candidates.find((item) => item.gameId === picked) ?? candidates[0];
  const pick = (candidate: StudCandidate) => {
    setPicked(candidate.gameId);
    setOpen(false);
    onSelect?.(candidate);
  };
  const groupLabel =
    selected.groupIds
      .map((id) => eggGroupNames[id] ?? `蛋组${id}`)
      .slice(0, 1)
      .join('') || '这一组';

  return (
    <div className="min-w-0" data-testid="stud-stack" data-open={open ? 'true' : 'false'}>
      <div className="grid grid-cols-[minmax(0,1fr)_112px] items-start gap-2">
        <div className="relative min-w-0">
          {open ? (
            <div className="flex flex-col gap-1" data-testid="stud-stack-selected">
              <CandidateCard candidate={selected} testId="stud-stack-selected-card" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                data-testid="stud-stack-collapse"
                className="min-h-[24px] self-start rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-600"
              >
                收起 ▲
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={false}
              aria-label={`展开 ${groupLabel} 全部种公`}
              data-testid="stud-stack-open"
              className="relative block h-[128px] w-full"
            >
              <span className="absolute inset-x-1 top-[20px] h-[96px] rounded-xl border border-slate-200 bg-white" aria-hidden />
              <span className="absolute inset-x-[3px] top-[10px] h-[96px] rounded-xl border border-slate-200 bg-white" aria-hidden />
              <span className="absolute inset-x-0 top-0 block">
                <CandidateCard candidate={selected} testId="stud-stack-card" />
              </span>
              <span className="absolute inset-x-0 top-[120px] text-center text-[10.5px] text-slate-600" data-testid="stud-stack-caption">
                {groupLabel} {candidates.length} 只公 · 点卡片换一只
              </span>
            </button>
          )}
        </div>
        {aside}
      </div>

      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-300 ${
          open ? 'mt-1.5 max-h-[520px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="grid grid-cols-2 gap-1.5" data-testid="stud-stack-list">
          {candidates.map((candidate, index) => (
            <button
              key={candidate.gameId}
              type="button"
              onClick={() => pick(candidate)}
              aria-label={`选 ${candidate.name} 当种公，${routeLabel(candidate)}`}
              className="min-w-0 text-left"
            >
              <CandidateCard candidate={candidate} index={index} testId="stud-stack-item" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
