import { eggGroupNames } from '../data/catalog';
import { isBreedableGroup } from '../domain/eggs';
import { petBodyMedalIcon, petVoiceMedalIcon, rarityIcon, voiceMedalName } from '../domain/petIcons';
import { GenderMark } from './GenderMark';
import { PetAvatar } from './PetAvatar';
import { PetCardLayout } from './PetCardLayout';
import { formatPercent } from './formatPercent';

export interface PetCompactCardProps {
  gameId?: number | null;
  name: string;
  number?: string;
  gender: '公' | '母' | '未知';
  nature: string;
  medalBody?: string;
  voiceDb?: number;
  heightPercent?: number | null;
  weightPercent?: number | null;
  eggGroups?: number[];
  isShiny?: boolean;
  isColorful?: boolean;
  /** 底部一行：家园写小窝位置，需求中心写账号 · 盒位 */
  footer?: string;
  footerTestId?: string;
  /** 角色标签：母本 / 种公 */
  roleLabel?: string;
  /** 学院小窝标记 */
  academy?: boolean;
  /** home 不显示位置；demand 显示角色与账号盒位 */
  variant?: 'home' | 'demand';
  testId?: string;
}

export function PetCompactCard({
  gameId,
  name,
  number,
  gender,
  nature,
  medalBody,
  voiceDb,
  heightPercent,
  weightPercent,
  eggGroups = [],
  isShiny,
  isColorful,
  footer,
  footerTestId,
  roleLabel,
  academy,
  variant = 'home',
  testId = 'pet-compact-card',
}: PetCompactCardProps) {
  const rarityKind = isShiny && isColorful
    ? 'shiny-colorful'
    : isColorful
      ? 'colorful'
      : isShiny
        ? 'shiny'
        : null;
  const raritySrc = rarityIcon(rarityKind);
  const bodyIcon = petBodyMedalIcon(medalBody, weightPercent);
  const voiceIcon = petVoiceMedalIcon(voiceDb);
  const voiceName = voiceMedalName(voiceDb);
  const groups = eggGroups
    .filter(isBreedableGroup)
    .map((groupId) => eggGroupNames[groupId] ?? `蛋组${groupId}`);
  const displayName = name.split('_')[0] || name;
  const showFooter = variant === 'demand' && (footer || roleLabel);

  return (
    <PetCardLayout
      name={displayName}
      number={number}
      eggGroups={groups}
      natures={[nature || '未知']}
      className="w-[160px] shrink-0"
      testId={testId}
      academy={academy}
      title={name}
      avatar={
        <span className="relative inline-flex h-11 w-11 items-center justify-center">
          <PetAvatar gameId={gameId} name={name} shiny={isShiny} size={44} />
          {raritySrc ? (
            <img src={raritySrc} alt="" className="absolute -right-1 -top-1 h-3 w-3 drop-shadow-sm" />
          ) : null}
        </span>
      }
      details={
        <div className="flex min-w-0 items-center justify-center gap-px whitespace-nowrap text-[6px] leading-[8px] text-slate-600">
          <span className="flex shrink-0 items-center gap-px">
            <GenderMark gender={gender} />
            {bodyIcon ? (
              <img src={bodyIcon} alt={medalBody ?? ''} title={medalBody ?? ''} className="h-2.5 w-2.5" />
            ) : null}
            {voiceIcon ? (
              <img src={voiceIcon} alt={voiceName ?? ''} title={voiceName ?? ''} className="h-2.5 w-2.5" />
            ) : null}
          </span>
          <span className="min-w-0 truncate">
            {voiceDb != null ? `${voiceDb}dB` : '—'} · {formatPercent(heightPercent)} · {formatPercent(weightPercent)}
          </span>
        </div>
      }
      footer={
        showFooter ? (
          <span
            className="w-full truncate text-center text-[6px] leading-[8px] text-slate-400"
            title={`${roleLabel ? `${roleLabel} · ` : ''}${footer ?? ''}`}
            data-testid={footerTestId}
          >
            {roleLabel ? `${roleLabel} · ` : ''}
            {footer}
          </span>
        ) : null
      }
    />
  );
}
