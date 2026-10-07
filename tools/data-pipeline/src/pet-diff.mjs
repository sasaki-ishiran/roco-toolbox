// 对比两份精灵图鉴，产出结构化差异与可读报告。

/** 参与对比的字段。顺序决定报告里的字段顺序。 */
const TRACKED_FIELDS = ['name', 'title', 'number', 'stage', 'types', 'egg_group', 'gender_ratio', 'egg_size', 'stats', 'class', 'image'];

/** 蛋组里只要有「未发现(1)」以外的组，就算可孵蛋。 */
export function isBreedable(pet) {
  const groups = Array.isArray(pet?.egg_group) ? pet.egg_group : [];
  return groups.some((id) => id !== 1);
}

function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function walk(prev, next, path, push) {
  const bothPlainObjects =
    prev && next && typeof prev === 'object' && typeof next === 'object' && !Array.isArray(prev) && !Array.isArray(next);
  if (!bothPlainObjects) {
    if (!sameValue(prev, next)) push(path, prev ?? null, next ?? null);
    return;
  }
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) walk(prev[key], next[key], path ? `${path}.${key}` : key, push);
}

/**
 * @param {Record<string, object>} oldPets 旧图鉴，键为 pet_000001 这类 id
 * @param {Record<string, object>} newPets 新图鉴
 */
export function diffCatalogs(oldPets, newPets) {
  const added = [];
  const removed = [];
  const changed = [];

  for (const key of Object.keys(newPets)) {
    if (oldPets[key]) continue;
    const pet = newPets[key];
    added.push({
      key,
      name: pet.name ?? pet.title ?? key,
      number: pet.number ?? '',
      eggGroups: Array.isArray(pet.egg_group) ? pet.egg_group : [],
      breedable: isBreedable(pet),
    });
  }

  for (const key of Object.keys(oldPets)) {
    if (!newPets[key]) removed.push({ key, name: oldPets[key].name ?? oldPets[key].title ?? key });
  }

  for (const key of Object.keys(oldPets)) {
    const pet = newPets[key];
    if (!pet) continue;
    const name = pet.name ?? pet.title ?? key;
    pushAll(oldPets[key], pet, name, key, changed);
  }

  const byKey = (a, b) => a.key.localeCompare(b.key);
  added.sort(byKey);
  removed.sort(byKey);
  return { added, removed, changed };
}

function pushAll(prev, next, name, key, changed) {
  const push = (field, from, to) => changed.push({ key, name, field, from, to });
  for (const field of TRACKED_FIELDS) walk(prev[field], next[field], field, push);
}

const GROUPS = {
  1: '未发现', 2: '巨灵组', 3: '两栖组', 4: '昆虫组', 5: '天空组',
  6: '动物组', 7: '妖精组', 8: '植物组', 9: '拟人组', 10: '软体组',
  11: '大地组', 12: '魔力组', 13: '海洋组', 14: '飞龙组', 15: '机械组',
};

const show = (value) => {
  if (Array.isArray(value)) return value.map((v) => (GROUPS[v] ? GROUPS[v] : v)).join('、') || '空';
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/** 渲染成 markdown 变更报告。 */
export function renderChangeReport(diff, meta) {
  const lines = [];
  lines.push(`# 上游数据变更报告`);
  lines.push('');
  lines.push(`- 抓取时间：${meta.fetchedAt}`);
  lines.push(`- 上游地址：${meta.sourceUrl}`);
  lines.push(`- 数据版本：${meta.version}`);
  lines.push(`- 解析到的精灵数：${meta.petCount}`);
  lines.push('');

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    lines.push('本次刷新与本地数据相比**没有变化**。');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`本次刷新：新增 ${diff.added.length}、数值变化 ${diff.changed.length}、移除 ${diff.removed.length}。`);
  lines.push('');

  lines.push(`## 新增精灵（${diff.added.length}）`);
  lines.push('');
  if (diff.added.length === 0) lines.push('无');
  for (const pet of diff.added) {
    const groups = pet.eggGroups.length ? pet.eggGroups.map((id) => GROUPS[id] ?? id).join('、') : '无蛋组';
    lines.push(`- ${pet.number} ${pet.name}（${pet.key}）｜蛋组：${groups}｜${pet.breedable ? '可孵蛋' : '**不可孵蛋**'}`);
  }
  lines.push('');

  lines.push(`## 数值变化（${diff.changed.length}）`);
  lines.push('');
  if (diff.changed.length === 0) lines.push('无');
  for (const change of diff.changed) {
    lines.push(`- ${change.name}（${change.key}）${change.field}：${show(change.from)} → ${show(change.to)}`);
  }
  lines.push('');

  lines.push(`## 移除条目（${diff.removed.length}）`);
  lines.push('');
  if (diff.removed.length === 0) lines.push('无');
  for (const pet of diff.removed) lines.push(`- ${pet.name}（${pet.key}）`);
  lines.push('');

  return lines.join('\n');
}
