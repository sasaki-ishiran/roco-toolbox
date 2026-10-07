// 从 Module:Pets/data/TrainingReference 的 pvp.nature 里提取「PVP 推荐性格」，
// 并按蛋组统计推荐热度。

/**
 * 每个精灵取候选性格，保留**全量排序候选**（2026-10-04：推荐算法专项要用「前两个」，
 * 所以不再只保留热度最高一条）。
 * @returns {Record<string, {natureId:number, count:number, total:number, candidateCount:number, candidates:Array<{natureId:number,count:number}>}>}
 */
export function extractPvpNatureRecommendations(trainingReference) {
  const pets = trainingReference?.pets ?? {};
  const result = {};
  for (const [gameId, entry] of Object.entries(pets)) {
    const candidates = entry?.pvp?.nature;
    if (!Array.isArray(candidates) || candidates.length === 0) continue;
    const pairs = candidates
      .filter((pair) => Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number')
      .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    if (pairs.length === 0) continue;
    const [natureId, count] = pairs[0];
    const total = pairs.reduce((sum, pair) => sum + pair[1], 0);
    result[gameId] = {
      natureId,
      count,
      total,
      candidateCount: pairs.length,
      candidates: pairs.map(([id, c]) => ({ natureId: id, count: c })),
    };
  }
  return result;
}

/**
 * 从蛋组排名里取每个蛋组的前 N 个性格，作为该蛋组的"目标性格"。
 * 数量相同时按性格 id 排序（与 data/natures.json 的固定顺序一致）。
 *
 * @param {Record<number, Array<{natureId:number,count:number}>>} ranking rankNaturesByEggGroup 的结果
 * @param {number} count 每个蛋组取几个
 * @returns {Record<number, number[]>} 蛋组 id → 性格 id 列表
 */
export function pickTargetNatures(ranking, count = 3) {
  const result = {};
  for (const [groupId, list] of Object.entries(ranking ?? {})) {
    const ordered = [...(list ?? [])]
      .sort((a, b) => b.count - a.count || a.natureId - b.natureId)
      .slice(0, count)
      .map((item) => item.natureId);
    if (ordered.length > 0) result[groupId] = ordered;
  }
  return result;
}

/**
 * 判定某物种的「推荐性格」（2026-10-05 用户拍板）。
 *
 * 不再固定取 top2，而是按候选性格的**占比**决定取几个：
 * - 阈值 = `max(绝对下限 10%, 最高占比 / 3)`：既要占比够高，也要相对最高占比足够集中；
 * - 从高到低，占比 ≥ 阈值的才算推荐，最多 `cap`（默认 3）个；
 * - 保底 top1：分布很平、谁都不够阈值时也至少给一个（下拉不空）。
 *
 * 实测例：火神 固执 55.08% / 开朗 23.49% / 第3名 1.4%… → [固执, 开朗]；
 *         一枝独秀 88% / 2% / 1%… → [固执]。
 *
 * @param {{natureId?:number,count?:number,total?:number,candidates?:Array<{natureId:number,count:number}>}} item
 * @param {{absFloor?:number, ratio?:number, cap?:number}} [options]
 * @returns {Array<{natureId:number,count:number}>} 命中的候选（按热度降序）
 */
export function pickRecommendedNatures(item, { absFloor = 0.1, ratio = 1 / 3, cap = 3 } = {}) {
  const raw =
    Array.isArray(item?.candidates) && item.candidates.length > 0
      ? item.candidates
      : item?.natureId != null
        ? [{ natureId: item.natureId, count: item.count }]
        : [];
  const candidates = raw
    .filter((candidate) => candidate && Number.isFinite(candidate.count))
    .sort((a, b) => b.count - a.count || (a.natureId ?? 0) - (b.natureId ?? 0));
  if (candidates.length === 0) return [];

  const total =
    Number.isFinite(item?.total) && item.total > 0
      ? item.total
      : candidates.reduce((sum, candidate) => sum + candidate.count, 0);
  if (!(total > 0)) return [];

  const floor = Math.max(absFloor, (candidates[0].count / total) * ratio);
  const picked = [];
  for (const candidate of candidates) {
    if (candidate.count / total < floor) break;
    picked.push(candidate);
    if (picked.length >= cap) break;
  }
  return picked.length > 0 ? picked : [candidates[0]];
}

/**
 * 按蛋组统计推荐性格。
 *
 * 计数单位是「一条进化链」（`evolution_id`），而不是图鉴条目：
 * - 同一形态的不同进化阶段（伊雷龙→伊兰亚龙→伊兰龙）只算一票，取阶级最高那条的推荐；
 *   同级有多个分支最终形态时取热度最高的那条。
 * - 不同形态（鸭吉吉的六种样子）`evolution_id` 各不相同、种族值也不同，因此各算一票，不合并。
 * - 一个精灵属于几个蛋组，就给这几个蛋组各记一次。
 * - 只有「未发现(1)」组的不可孵蛋精灵不参与统计。
 *
 * @param {Array<{game_id:number,name:string,egg_group:number[],evolution_id?:string,stage?:number}>} pets
 * @param {Record<string, {natureId:number, count:number}>} recommendations
 * @param {Record<number,string>} natureNames
 * @returns {Record<number, Array<{natureId:number,name:string,count:number,pets:string[]}>>}
 */
export function rankNaturesByEggGroup(pets, recommendations, natureNames = {}) {
  const families = new Map();
  for (const pet of pets) {
    const key = pet.evolution_id ?? `solo:${pet.key ?? pet.game_id}`;
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(pet);
  }

  /** @type {Map<number, Map<number, {count:number, pets:string[]}>>} */
  const byGroup = new Map();

  for (const members of families.values()) {
    const withRecommendation = members.filter((pet) => recommendations[pet.game_id]);
    if (withRecommendation.length === 0) continue;

    const maxStage = Math.max(...withRecommendation.map((pet) => pet.stage ?? 0));
    const finals = withRecommendation.filter((pet) => (pet.stage ?? 0) === maxStage);
    const chosen = finals.reduce(
      (best, current) => (recommendations[current.game_id].count > recommendations[best.game_id].count ? current : best),
      finals[0],
    );
    const natureId = recommendations[chosen.game_id].natureId;

    const groups = new Set();
    for (const pet of members) for (const id of pet.egg_group ?? []) if (id !== 1) groups.add(id);

    for (const groupId of groups) {
      if (!byGroup.has(groupId)) byGroup.set(groupId, new Map());
      const natures = byGroup.get(groupId);
      const current = natures.get(natureId) ?? { count: 0, pets: [] };
      current.count += 1;
      current.pets.push(chosen.name);
      natures.set(natureId, current);
    }
  }

  const result = {};
  for (const [groupId, natures] of byGroup) {
    result[groupId] = [...natures.entries()]
      .map(([natureId, value]) => ({
        natureId,
        name: natureNames[natureId] ?? String(natureId),
        count: value.count,
        pets: value.pets,
      }))
      .sort((a, b) => b.count - a.count || a.natureId - b.natureId);
  }
  return result;
}
