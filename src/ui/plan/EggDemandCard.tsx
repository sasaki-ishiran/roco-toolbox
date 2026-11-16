import { bodyMedalIconByLabel, voiceMedalIconByLabel } from '../../domain/petIcons';
import type { EggDemand } from '../../shared/eggMatching';
import { PetAvatar } from '../PetAvatar';
import { GREEN_NEST_ICON } from '../../domain/petIcons';

export interface EggDemandCardProps {
  demand: EggDemand;
  name: string;
  ownerLabel?: string;
  statusLabel: string;
  onOpen: (demand: EggDemand) => void;
}

/** Approved prototype: portrait 56px, name 11px, metadata 10px, medals 16px. */
export function EggDemandCard({ demand, name, ownerLabel, statusLabel, onOpen }: EggDemandCardProps) {
  const bodyIcon = bodyMedalIconByLabel(demand.body);
  const voiceIcon = voiceMedalIconByLabel(demand.voice);

  return (
    <button
      type="button"
      onClick={() => onOpen(demand)}
      className="flex min-w-0 flex-col items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white text-center shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
      data-demand-id={demand.id}
    >
      <span className="flex items-center justify-center pb-0.5 pt-1.5">
        <PetAvatar gameId={demand.eggGameId} name={name} size={56} />
      </span>
      <span className="truncate px-1 text-[11px] font-semibold leading-[15px] text-slate-800">{name}</span>
      <span className="min-h-[15px] px-0.5 py-px text-[10px] leading-[14px] text-slate-600">
        {demand.natures.join(' / ') || '不挑性格'}
      </span>
      <span className="flex h-[19px] items-center justify-center gap-[3px]">
        {bodyIcon ? <img src={bodyIcon} alt={demand.body} className="size-4 object-contain" /> : null}
        {voiceIcon ? <img src={voiceIcon} alt={demand.voice} className="size-4 object-contain" /> : null}
        {demand.greenNest ? <img src={GREEN_NEST_ICON} alt="绿窝" className="size-4 object-contain"/> : null}
      </span>
      <span className="mb-[3px] px-1 text-[10px] leading-4 text-slate-500">
        {ownerLabel ? `${ownerLabel} · ` : ''}已收 {demand.fulfilled}/{demand.quantity}
      </span>
      <span className="mt-auto bg-emerald-50 px-1 text-[10px] leading-5 text-emerald-700">{statusLabel}</span>
    </button>
  );
}
