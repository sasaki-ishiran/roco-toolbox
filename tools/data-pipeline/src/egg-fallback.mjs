/**
 * 图鉴兜底：物种不在蛋归属表（蛋神助手导出）里时，用 wiki 自己的蛋信息推断它属于哪颗蛋。
 *
 * 为什么需要（2026-10-25）：赛季更新会先更新 wiki 图鉴，蛋神助手（第三方）往往滞后。
 * `刷新数据.cmd` 只重抓 wiki，不会重建 `vendor/egg-map.json` —— 新精灵因此拿到
 * `eggGameId: null`，在母本 / 换蛋里等于不存在（云梦豚就踩了这个坑）。
 *
 * 规则与蛋神助手一致：
 * - 只有「带自己的蛋」的形态参与（`image.has_egg` 或 `ecology.eggs`）；
 * - 蛋归**同一进化链里 stage 最小的形态**（长江豚 → 云梦豚的蛋）；
 * - 蛋物种本身必须可孵蛋（蛋组 2~15），否则不算。
 */
export function wikiEggBaseOf(pet, allPets) {
  const hasEgg = (p) => p?.image?.has_egg === true || (p?.ecology?.eggs?.length ?? 0) > 0;
  if (!hasEgg(pet)) return null;
  const chain = pet.evolution_id
    ? allPets.filter((item) => item.evolution_id === pet.evolution_id)
    : [pet];
  const candidates = chain.filter(hasEgg);
  const base = [...candidates].sort((a, b) => (a.stage ?? 99) - (b.stage ?? 99))[0];
  if (!base) return null;
  const breedable = (base.egg_group ?? []).some((group) => group >= 2 && group <= 15);
  return breedable ? base.game_id ?? null : null;
}
