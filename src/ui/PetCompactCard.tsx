import type { CSSProperties } from 'react';
import { eggGroupNames } from '../data/catalog';
import { isBreedableGroup } from '../domain/eggs';
import { bodyMedalIcon, rarityIcon, voiceMedalIcon, voiceMedalName } from '../domain/petIcons';
import { GenderMark } from './GenderMark';
import { PetAvatar } from './PetAvatar';

/**
 * 紧凑精灵卡（2026-10-29 用户手动调好的坐标）。
 *
 * 卡片 160 宽：头像、昵称、性别、奖牌、蛋组、性格、声音 / 身高 / 体重、位置
 * 全部绝对定位，元素之间的间距按用户给的 JSON 固定，不再由文档流自动排版。
 * 字号 / 字重 / 内边距必须与 `卡片布局编辑器.html` 的 CSS 完全一致，
 * 否则同一份 left / top 在编辑器里规整、到应用里就偏。
 *
 * 家园 160×115、不显示小窝位置；需求中心 160×120，footer 在 top=105，
 * 显示「母本 / 种公 · 账号 · 盒位」。卡片宽度固定，禁止在窄容器里被压缩。
 */
export interface PetCompactCardProps {
  gameId?: number | null;
  name: string;
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
  /** 左下角角色标签：母本 / 种公 */
  roleLabel?: string;
  /** 学院小窝整卡绿色 */
  academy?: boolean;
  /** home = 家园（115 高、不显示位置）；demand = 需求中心（120 高、显示盒位） */
  variant?: 'home' | 'demand';
  testId?: string;
}

/** 用户手调坐标：left / top（px）/ scale。 */
const L = {
  avatar: { left: 6, top: 10, scale: 1.35 },
  name: { left: 64, top: 17, scale: 0.75 },
  gender: { left: 67, top: 37, scale: 1 },
  medals: { left: 83, top: 37, scale: 0.9 },
  groups: { left: 65, top: 60, scale: 1.05 },
  // 性格在右上角（用户 JSON）；昵称只显示基础名，5 字以内不会碰到它。
  nature: { left: 125, top: 17, scale: 1.25 },
  sound: { left: 6, top: 80, scale: 1 },
  height: { left: 54, top: 80, scale: 1 },
  weight: { left: 107, top: 80, scale: 1 },
  footer: { left: 8, top: 105, scale: 1 },
} as const;

const at = (key: keyof typeof L): CSSProperties => ({
  left: L[key].left,
  top: L[key].top,
  transform: `scale(${L[key].scale})`,
  transformOrigin: 'top left',
});

const groupTag = (groupId: number): string =>
  (eggGroupNames[groupId] ?? '').replace(/组$/, '').slice(0, 2);

const percentText = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';

export function PetCompactCard({
  gameId,
  name,
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
  const demand = variant === 'demand';
  const rarityKind = isShiny && isColorful
    ? 'shiny-colorful'
    : isColorful
      ? 'colorful'
      : isShiny
        ? 'shiny'
        : null;
  const raritySrc = rarityIcon(rarityKind);
  const bodyIcon = bodyMedalIcon(medalBody);
  const voiceIcon = voiceMedalIcon(voiceDb);
  const voiceName = voiceMedalName(voiceDb);
  const groups = eggGroups.filter(isBreedableGroup).slice(0, 2);
  /**
   * 昵称只写名字，不写形态（2026-10-29 用户口径）；多形态靠头像区分，
   * 完整官方名放 title，方便悬停确认。
   */
  const displayName = name.split('_')[0] || name;

  return (
    <article
      className={`relative w-[160px] shrink-0 overflow-hidden rounded-xl border shadow-sm ${
        demand ? 'h-[120px]' : 'h-[115px]'
      } ${
        academy ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'
      }`}
      data-testid={testId}
      data-academy={academy ? 'true' : undefined}
    >
      <div className="absolute" style={at('avatar')}>
        <div className="relative h-10 w-10">
          <PetAvatar gameId={gameId} name={name} shiny={isShiny || isColorful} size={40} />
          {raritySrc ? (
            <img
              src={raritySrc}
              alt=""
              className="absolute -right-1 -top-1 h-4 w-4 drop-shadow-sm"
            />
          ) : null}
        </div>
      </div>

      <div className="absolute text-xs font-bold leading-[1.1]" style={at('gender')}>
        <GenderMark gender={gender} />
      </div>

      <div
        className="absolute whitespace-nowrap text-sm font-bold leading-[1.1] text-slate-900"
        style={at('name')}
        title={name}
      >
        {displayName}
      </div>

      <div
        className="absolute whitespace-nowrap rounded bg-violet-50 px-[3px] py-[1px] text-[8px] leading-[1.1] text-violet-700"
        style={at('nature')}
      >
        {nature || '未知'}
      </div>

      <div className="absolute flex gap-0.5" style={at('medals')} data-testid="pet-compact-medals">
        {bodyIcon ? (
          <img src={bodyIcon} alt={medalBody ?? ''} title={medalBody ?? ''} className="h-4 w-4" />
        ) : null}
        {voiceIcon ? (
          <img src={voiceIcon} alt={voiceName ?? ''} title={voiceName ?? ''} className="h-4 w-4" />
        ) : null}
      </div>

      <div className="absolute flex gap-0.5" style={at('groups')}>
        {groups.map((groupId) => (
          <span
            key={groupId}
            className="whitespace-nowrap rounded bg-slate-100 px-[3px] py-[1px] text-[8px] leading-[1.1] text-slate-600"
          >
            {groupTag(groupId)}
          </span>
        ))}
      </div>

      <div className="absolute w-[46px] text-center" style={at('sound')}>
        <div className="text-[8px] leading-[1.1] text-slate-500">声音</div>
        <div className="whitespace-nowrap text-[10px] font-bold leading-[1.1] text-slate-700">
          {voiceDb != null ? `${voiceDb}dB` : '—'}
        </div>
      </div>

      <div className="absolute w-[50px] text-center" style={at('height')}>
        <div className="text-[8px] leading-[1.1] text-slate-500">身高</div>
        <div className="whitespace-nowrap text-[10px] font-bold leading-[1.1] text-slate-700">
          {percentText(heightPercent)}
        </div>
      </div>

      <div className="absolute w-[50px] text-center" style={at('weight')}>
        <div className="text-[8px] leading-[1.1] text-slate-500">体重</div>
        <div className="whitespace-nowrap text-[10px] font-bold leading-[1.1] text-slate-700">
          {percentText(weightPercent)}
        </div>
      </div>

      {demand && (footer || roleLabel) ? (
        <p
          className="absolute w-[144px] truncate text-center text-[8px] leading-[1.1] text-slate-400"
          style={at('footer')}
          title={`${roleLabel ? `${roleLabel} · ` : ''}${footer ?? ''}`}
          data-testid={footerTestId}
        >
          {roleLabel ? `${roleLabel} · ` : ''}
          {footer}
        </p>
      ) : null}
    </article>
  );
}
