import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { bodyMedalIcon, rarityIcon, voiceMedalIcon, voiceMedalName } from '../domain/petIcons';
import { speciesDisplayName } from '../domain/speciesName';
import { GenderMark } from './GenderMark';
import { PetAvatar } from './PetAvatar';

/** 稀有度名字：图标的 title / alt 用（界面本身不再写文字标签） */
const RARITY_TEXT: Record<string, string> = {
  shiny: '异色',
  colorful: '炫彩',
  'shiny-colorful': '异色炫彩',
};

export interface PetCardProps {
  pet: OwnedPet;
  species?: SpeciesEntry;
  eggGroupNames: Record<number, string>;
}

/**
 * 精灵卡。**一行四张**的紧凑卡，头像是主体（56px，约占卡宽 2/3），文字只保留必要信息。
 *
 * 2026-10-27 重做（用户要求）：头像放大为主体；稀有度从文字标签改成图标（叠在头像右上角）；
 * 体型/声音在满分时显示游戏奖牌图标；名称最多两行，其余行全部单行截断，保证同排等高。
 * 账号仍由上层 AccountSection 分组标题承担，卡内「位置」只在有账号时带上账号名。
 */
export function PetCard({ pet, species, eggGroupNames }: PetCardProps) {
  const displayName = speciesDisplayName(species, pet.name);
  // 头像按形态 gameId 取；只有异色 / 异色炫彩用异色图。炫彩是游戏内染色、官方没有炫彩立绘，
  // 套异色图会把「原色 + 炫彩」的精灵显示成异色（2026-10-29 用户反馈：伊贝儿 / 云梦豚）。
  const avatarGameId = species?.gameId ?? pet.gameId;
  const shinyAvatar = Boolean(pet.isShiny);
  const eggGroups = (species?.eggGroups ?? [])
    .filter((group) => group >= 2 && group <= 15)
    .map((group) => eggGroupNames[group] ?? `蛋组${group}`)
    .join('×');
  const position = pet.account
    ? pet.boxGroup
      ? `${pet.account}·${pet.boxGroup}${pet.slotOrder != null ? `·${pet.slotOrder}` : ''}`
      : pet.account
    : '';
  const rarityKind = pet.isShiny && pet.isColorful ? 'shiny-colorful' : pet.isColorful ? 'colorful' : pet.isShiny ? 'shiny' : null;
  const raritySrc = rarityIcon(rarityKind);
  const rarityName = rarityKind ? RARITY_TEXT[rarityKind] : null;
  const bodyIcon = bodyMedalIcon(pet.medalBody);
  const voiceIcon = voiceMedalIcon(pet.voiceDb);
  const voiceName = voiceMedalName(pet.voiceDb);

  return (
    <article className="flex h-full flex-col items-center rounded-xl bg-white p-1.5 shadow-sm">
      <div className="relative">
        <PetAvatar gameId={avatarGameId} name={displayName} shiny={shinyAvatar} size={56} />
        {raritySrc ? (
          <img
            src={raritySrc}
            alt={rarityName ?? ''}
            title={rarityName ?? ''}
            className="absolute -right-1 -top-1 h-4 w-4 drop-shadow-sm"
          />
        ) : null}
      </div>

      <h3
        className="mt-1 line-clamp-2 w-full text-center text-[11px] font-semibold leading-tight text-slate-900"
        title={displayName}
        data-testid="pet-card-name"
      >
        {displayName}
      </h3>

      <p className="mt-0.5 truncate text-[10px] leading-tight text-slate-700">
        <GenderMark gender={pet.gender} /> {pet.nature}
      </p>

      {/* 体型 / 声音奖牌：只有「大块头 / 小不点」「±100」才有官方图标，其他情况留空保持等高 */}
      <div className="mt-0.5 flex h-4 items-center justify-center gap-0.5">
        {bodyIcon ? <img src={bodyIcon} alt={pet.medalBody} title={pet.medalBody} className="h-4 w-4" /> : null}
        {voiceIcon ? (
          <img src={voiceIcon} alt={voiceName ?? ''} title={voiceName ?? ''} className="h-4 w-4" />
        ) : null}
      </div>

      <p className="truncate text-[10px] leading-tight text-slate-500">
        {pet.weightPercent != null ? `${pet.weightPercent.toFixed(2)}%` : '—'} · {pet.voiceDb}dB
      </p>
      <p className="mt-0.5 w-full truncate text-center text-[10px] leading-tight text-slate-500">
        {eggGroups || '—'}
      </p>
      <p
        className="mt-auto w-full truncate pt-0.5 text-center text-[10px] leading-tight text-slate-400"
        title={position || undefined}
      >
        {position || '—'}
      </p>
    </article>
  );
}
