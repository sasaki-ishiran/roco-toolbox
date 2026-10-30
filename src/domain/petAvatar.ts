/** 腾讯官方素材 CDN（资源清单取自蛋神助手 1.2.8 的 official-resources manifest） */
const OFFICIAL_CDN_ROOT = 'https://game.gtimg.cn/images/rocom/rocodata';

/** 头像档位：普通 / 异色（炫彩是游戏内染色，官方素材里没有单独的炫彩立绘） */
export type PetAvatarVariant = 'normal' | 'shiny';

/**
 * 精灵头像地址：官方 CDN 的 256×256 透明 PNG。
 *
 * 路径按**形态**（SpeciesEntry.gameId）拼，不是按蛋物种拼 —— 雪绒鸟春/夏/秋/本来
 * 四个形态各有自己的头像文件。`gameId` 缺失或非法时返回 `null`，调用方退化为首字占位。
 *
 * 异色档的文件名是 `icon_yise.png`；官方尚未收录异色图的新精灵会 404，
 * 调用方应先退回普通头像，再失败才用首字占位。
 */
export function petAvatarUrl(
  gameId: number | null | undefined,
  variant: PetAvatarVariant = 'normal',
): string | null {
  if (gameId == null || !Number.isInteger(gameId) || gameId <= 0) return null;
  const file = variant === 'shiny' ? 'icon_yise.png' : 'icon.png';
  return `${OFFICIAL_CDN_ROOT}/jingling/${gameId}/${file}`;
}
