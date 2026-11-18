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

/**
 * 精灵本体的体型 / 声音奖牌（2026-11-01 用户口径：满体重 / 满声音要用带 MAX / MIN 缎带的版本）。
 *
 * - 体型：`大块头` 且体重正好 100% → `1001-max`；`小不点` 且体重正好 0% → `1002-min`；
 *   其余仍是普通奖牌（98% / 2% 的档位）。
 * - 声音：±100 才显示奖牌，换成带 MAX 缎带的图。
 */
export function petBodyMedalIcon(
  medalBody: string | null | undefined,
  weightPercent: number | null | undefined,
): string | null {
  const percent = typeof weightPercent === 'number' && Number.isFinite(weightPercent)
    ? weightPercent
    : null;
  if (medalBody === '大块头') return percent != null && percent >= 100 ? '/ui/medals/1001-max.png' : '/ui/medals/1001.png';
  if (medalBody === '小不点') return percent != null && percent <= 0 ? '/ui/medals/1002-min.png' : '/ui/medals/1002.png';
  return null;
}

/**
 * 声音奖牌：满分 ±100 用带 MAX 缎带的图；双牌档（≥96 / ≤-96）用普通奖牌图。
 * 2026-11-17 用户口径：-96dB 以下、+96dB 及以上都算有奖牌，之前只认 ±100 所以「缺图」。
 */
export function petVoiceMedalIcon(voiceDb: number | null | undefined): string | null {
  if (typeof voiceDb !== 'number' || !Number.isFinite(voiceDb)) return null;
  if (voiceDb >= 100) return '/ui/medals/1026-max.png';
  if (voiceDb <= -100) return '/ui/medals/1025-max.png';
  if (voiceDb >= 96) return '/ui/medals/1026.png';
  if (voiceDb <= -96) return '/ui/medals/1025.png';
  return null;
}

/** 声音奖牌的名字，用于 title / alt（双牌档同样有名字） */
export function voiceMedalName(voiceDb: number | null | undefined): string | null {
  if (typeof voiceDb !== 'number' || !Number.isFinite(voiceDb)) return null;
  if (voiceDb >= 96) return '婉转声';
  if (voiceDb <= -96) return '粗嗓门';
  return null;
}

/**
 * 需求 / 目标里的声音取图（2026-11-01 用户口径：满分档换带 MAX 缎带的图）：
 * - `+100` / `-100` = 满声音 / 满粗嗓门 → 带 MAX 缎带的图；
 * - `婉转声` / `粗嗓门` = 双牌档（≥96 / ≤-96，不保证满分）→ 普通奖牌图。
 * 空字符串、「不挑」等返回 null。
 */
export function voiceMedalIconByLabel(label: string | null | undefined): string | null {
  if (label === '+100') return '/ui/medals/1026-max.png';
  if (label === '-100') return '/ui/medals/1025-max.png';
  if (label === '婉转声') return '/ui/medals/1026.png';
  if (label === '粗嗓门') return '/ui/medals/1025.png';
  return null;
}

/**
 * 体型目标取图（2026-11-01 用户口径：体重正好 100% / 0% 才换 MAX / MIN 图标）。
 * `满体重` / `零体重` 是新增的极端档；`大块头` / `小不点` 仍是普通奖牌。
 */
export function bodyMedalIconByLabel(label: string | null | undefined): string | null {
  if (label === '满体重') return '/ui/medals/1001-max.png';
  if (label === '零体重') return '/ui/medals/1002-min.png';
  return bodyMedalIcon(label);
}

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

/**
 * 绿窝（学院小窝）图标（2026-11-01 用户自绘）：需求卡片、需求详情、发需求勾选框、
 * 接单上窝的「进学院小窝」标识共用同一张图（原图裁掉空白并抠成透明底，128px 宽）。
 */
export const GREEN_NEST_ICON = '/ui/nest/green-nest.png';
