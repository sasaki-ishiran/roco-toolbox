import type { OwnedPet, SpeciesEntry } from '../domain/types';
import { speciesDisplayName } from '../domain/speciesName';
import { GenderMark } from './GenderMark';

/** 稀有度文字（2026-10-05 回退：图标 → 文字，统一放卡片右上角） */
const RARITY_TEXT: Record<string, string> = {
  shiny: '异色',
  colorful: '炫彩',
  'shiny-colorful': '异色炫彩',
  'shiny-bw': '异色黑白',
};
const RARITY_CLASS: Record<string, string> = {
  shiny: 'bg-teal-100 text-teal-700',
  colorful: 'bg-fuchsia-100 text-fuchsia-700',
  'shiny-colorful': 'bg-emerald-100 text-emerald-700',
  'shiny-bw': 'bg-slate-200 text-slate-600',
};

export interface PetCardProps {
  pet: OwnedPet;
  species?: SpeciesEntry;
  eggGroupNames: Record<number, string>;
}

/**
 * 精灵卡。移动端一行放两张，做成紧凑版。
 *
 * 2026-10-05 排版重做：改用**固定槽位**（标题行 → 性别+性格 → 声音/体型 两列 → 蛋组 → 位置），
 * 每张卡的槽位数量与顺序完全一致，配合 `truncate` 不再因标签换行而参差不齐、同排也能对齐。
 * 账号由上层 AccountSection 分组标题承担（卡内只在「位置」里带账号）；图鉴编号不展示。
 */
export function PetCard({ pet, species, eggGroupNames }: PetCardProps) {
  const displayName = speciesDisplayName(species, pet.name);
  const eggGroups = (species?.eggGroups ?? [])
    .filter((group) => group >= 2 && group <= 15)
    .map((group) => eggGroupNames[group] ?? `蛋组${group}`)
    .join(' × ');
  const position = pet.account
    ? pet.boxGroup
      ? `${pet.account} · ${pet.boxGroup}${pet.slotOrder != null ? ` · ${pet.slotOrder}` : ''}`
      : pet.account
    : '';
  // 稀有度：文字标签，统一在卡片右上角（2026-10-05 回退图标方案）
  const rarityKind = pet.isShiny && pet.isColorful ? 'shiny-colorful' : pet.isColorful ? 'colorful' : pet.isShiny ? 'shiny' : null;

  return (
    <article className="flex h-full flex-col rounded-xl bg-white p-2 shadow-sm">
      <div className="flex min-h-[22px] items-start justify-between gap-1">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight text-slate-900">
          {displayName}
        </h3>
        {rarityKind ? (
          <span
            className={`shrink-0 rounded px-1 py-0.5 text-[10px] leading-none font-medium ${RARITY_CLASS[rarityKind]}`}
          >
            {RARITY_TEXT[rarityKind]}
          </span>
        ) : null}
      </div>
      {/* 性别 + 性格（性别用 ♂/♀ 符号，2026-10-05 用户拍板） */}
      <p className="mt-0.5 truncate text-xs text-slate-700">
        <GenderMark gender={pet.gender} /> {pet.nature}
      </p>
      {/* 固定 4 个槽位（2 列）：所有卡等高、同排对齐。不写「声音/体型/蛋组/位置」前缀——
          值本身已经说明是什么，前缀是噪音（2026-10-05 用户要求）。体型带百分比。 */}
      <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] leading-tight text-slate-500">
        <span className="truncate">{pet.voiceDb}dB</span>
        {/* 体型：比例常驻；有体型牌就带上牌名（没牌只写比例） */}
        <span className="truncate">
          {[pet.medalBody, pet.weightPercent != null ? `${pet.weightPercent}%` : '']
            .filter(Boolean)
            .join(' ')}
        </span>
        <span className="col-span-2 truncate">{eggGroups || '—'}</span>
        <span className="col-span-2 truncate">{position || '—'}</span>
      </div>
    </article>
  );
}