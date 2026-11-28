import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { heightMetersOf, weightKgOf } from '../domain/petFilters';
import { petBodyMedalIcon, petVoiceMedalIcon, rarityIcon, voiceMedalName } from '../domain/petIcons';
import { speciesDisplayName } from '../domain/speciesName';
import { GenderMark } from './GenderMark';
import { PetAvatar } from './PetAvatar';
import { PetCardLayout } from './PetCardLayout';
import { formatPercent } from './formatPercent';
import { getMyPetsSizeUnit } from './myPetsFilterStore';

/** 稀有度名字：图标的 title / alt 用。 */
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

/** 精灵背包中的标准卡片。 */
export function PetCard({ pet, species, eggGroupNames }: PetCardProps) {
  const displayName = speciesDisplayName(species, pet.name);
  const avatarGameId = species?.gameId ?? pet.gameId;
  const rarityKind = pet.isShiny && pet.isColorful
    ? 'shiny-colorful'
    : pet.isColorful
      ? 'colorful'
      : pet.isShiny
        ? 'shiny'
        : null;
  const raritySrc = rarityIcon(rarityKind);
  const rarityName = rarityKind ? RARITY_TEXT[rarityKind] : null;
  const eggGroups = (species?.eggGroups ?? [])
    .filter((group) => group >= 2 && group <= 15)
    .map((group) => eggGroupNames[group] ?? `蛋组${group}`);
  /** 账号与背包位置分两行（2026-11-21 用户口径），放不下时各自截断。 */
  const accountLine = pet.account ?? '—';
  const boxLine = pet.boxGroup
    ? `${pet.boxGroup}${pet.slotOrder != null ? `-${pet.slotOrder}` : ''}`
    : '';
  const position = boxLine ? `${accountLine}·${boxLine}` : accountLine;
  const bodyIcon = petBodyMedalIcon(pet.medalBody, pet.weightPercent);
  const voiceIcon = petVoiceMedalIcon(pet.voiceDb);
  const voiceName = voiceMedalName(pet.voiceDb);

  // 筛选区的显示开关：身高和体重一起换成「数值」（米 / 公斤），缺图鉴区间时退回百分位
  const sizeValue = getMyPetsSizeUnit() === 'value';
  const meters = heightMetersOf(species?.heightSize, pet.heightPercent);
  const kilograms = weightKgOf(species?.bodySize, pet.weightPercent);
  const heightText =
    sizeValue && meters !== null ? `${meters.toFixed(2)}m` : formatPercent(pet.heightPercent);
  const weightText =
    sizeValue && kilograms !== null ? `${kilograms.toFixed(1)}kg` : formatPercent(pet.weightPercent);

  return (
    <PetCardLayout
      className="pet-card-inventory"
      name={displayName}
      size="tall"
      gender={pet.gender}
      number={species?.number}
      eggGroups={eggGroups}
      natures={pet.nature ? [pet.nature] : []}
      naturePrefix={
        <span className="shrink-0" data-testid="pet-card-gender">
          <GenderMark gender={pet.gender} />
        </span>
      }
      // 奖牌块：mr-0.5 + min-w-max，两枚奖牌比右侧网格列宽，留 2px 才不会被 header 的 overflow 裁掉右缘
      natureAdornment={
        <span className="mr-0.5 flex translate-x-0.5 flex-col items-end gap-px" data-testid="pet-card-medals">
          <span className="flex min-w-max flex-row items-center gap-px">
            {bodyIcon ? (
              <img
                src={bodyIcon}
                alt={pet.medalBody}
                title={pet.medalBody}
                className="h-3 w-3 drop-shadow-sm"
              />
            ) : null}
            {voiceIcon ? (
              <img
                src={voiceIcon}
                alt={voiceName ?? ''}
                title={voiceName ?? ''}
                className="h-3 w-3 drop-shadow-sm"
              />
            ) : null}
          </span>
          <span
            className="whitespace-nowrap text-[6px] leading-[7px] text-slate-500"
            data-testid="pet-card-voice"
            title={`声音 ${pet.voiceDb}dB`}
          >
            {pet.voiceDb}dB
          </span>
        </span>
      }
      badge={
        raritySrc ? (
          <img
            src={raritySrc}
            alt={rarityName ?? ''}
            title={rarityName ?? ''}
            className="h-3 w-3 drop-shadow-sm"
            data-testid="pet-card-rarity"
          />
        ) : null
      }
      avatar={
        <span className="relative inline-flex h-12 w-12 items-center justify-center">
          <PetAvatar
            gameId={avatarGameId}
            name={displayName}
            shiny={Boolean(pet.isShiny)}
            size={48}
          />
        </span>
      }
      details={
        <div className="flex min-w-0 items-center justify-center gap-px whitespace-nowrap text-[8px] leading-[10px] text-slate-600">
          <span className="min-w-0 truncate" data-testid="pet-card-sizes">
            高{heightText} · 重{weightText}
          </span>
        </div>
      }
      footer={
        <span
          className="w-full text-center text-[7px] leading-[9px] text-slate-400"
          title={position}
          data-testid="pet-card-position"
        >
          <span className="block truncate">{accountLine}</span>
          {boxLine ? <span className="block truncate">{boxLine}</span> : null}
        </span>
      }
    />
  );
}

