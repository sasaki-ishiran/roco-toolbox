// 从 Module:Pets/data/TrainingReference 里抽出性格表。
// 每条形如：{ id: 23, name: '开朗', plus: '速度', minus: '魔攻', detail: '速度↑ / 魔攻↓' }

const NATURE_PATTERN = /^(.+?)↑\s*\/\s*(.+)↓$/;

export function extractNatures(trainingReference) {
  const natures = trainingReference?.labels?.nature ?? {};
  return Object.entries(natures)
    .map(([id, value]) => {
      const detail = value?.detail ?? '';
      const matched = NATURE_PATTERN.exec(detail);
      return {
        id: Number(id),
        name: value?.name ?? '',
        plus: matched ? matched[1].trim() : '',
        minus: matched ? matched[2].trim() : '',
        detail,
      };
    })
    .sort((a, b) => a.id - b.id);
}
