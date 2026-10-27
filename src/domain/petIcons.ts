/**
 * 精灵卡片上的图标资源（取自蛋神助手客户端素材，已拷到 `public/ui/`）。
 *
 * 只做「名字 → 静态资源路径」的映射，不判断该不该显示；调用方传 null/空值时返回 null。
 */

/** 体型奖牌：大块头 / 小不点（游戏里的奖牌图标） */
export function bodyMedalIcon(medalBody: string | null | undefined): string | null {
  if (medalBody === '大块头') return '/ui/medals/1001.png';
  if (medalBody === '小不点') return '/ui/medals/1002.png';
  return null;
}

/** 声音奖牌：只有满分两端才显示（+100 婉转声 / -100 粗嗓门） */
export function voiceMedalIcon(voiceDb: number | null | undefined): string | null {
  if (voiceDb === 100) return '/ui/medals/1026.png';
  if (voiceDb === -100) return '/ui/medals/1025.png';
  return null;
}

/** 声音奖牌的名字，用于 title / alt */
export function voiceMedalName(voiceDb: number | null | undefined): string | null {
  if (voiceDb === 100) return '婉转声';
  if (voiceDb === -100) return '粗嗓门';
  return null;
}

/**
 * 需求/目标里的声音取图：同时认数值写法（`+100` / `-100`）和奖牌名（`婉转声` / `粗嗓门`）。
 * 空字符串、「不挑」等返回 null。
 */
export function voiceMedalIconByLabel(label: string | null | undefined): string | null {
  if (label === '+100' || label === '婉转声') return '/ui/medals/1026.png';
  if (label === '-100' || label === '粗嗓门') return '/ui/medals/1025.png';
  return null;
}

/** 体型目标取图：直接复用奖牌名字映射（`大块头` / `小不点`） */
export const bodyMedalIconByLabel = bodyMedalIcon;

/** 声音目标的名字（`+100` → 婉转声、`-100` → 粗嗓门），用于 title / alt */
export function voiceMedalLabel(label: string | null | undefined): string {
  if (label === '+100' || label === '婉转声') return '婉转声';
  if (label === '-100' || label === '粗嗓门') return '粗嗓门';
  return label ?? '';
}

/** 稀有度徽标：异色 / 炫彩 / 异色炫彩（`shiny-bw` 目前数据里不会产生，先不给图） */
export function rarityIcon(kind: string | null | undefined): string | null {
  if (kind === 'shiny') return '/ui/rarity/shiny.png';
  if (kind === 'colorful') return '/ui/rarity/colorful.png';
  if (kind === 'shiny-colorful') return '/ui/rarity/shiny-colorful.png';
  return null;
}
