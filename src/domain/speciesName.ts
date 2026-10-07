import type { SpeciesEntry } from './types';

/**
 * 物种的显示名。
 *
 * 有**官方名**（游戏自己的写法，形如 `雪绒鸟_夏天的样子`，由数据管线从蛋配置里取）就用官方名；
 * 没有则自己拼 `名字_形态`（分隔符与官方保持一致）；无形态时就是物种名。
 * 查不到图鉴条目时退回 `fallback`（通常是抓包里的 `pet.name`）。
 *
 * 为什么不自己拼就够：实测有出入 —— 图鉴里写 `地鼠_储水时**的**样子`，官方是
 * `地鼠_储水**期**的样子`；而 `护主犬` 这种只有一个形态的，官方名干脆不带后缀。
 */
export function speciesDisplayName(
  entry: Pick<SpeciesEntry, 'name' | 'form' | 'officialName'> | undefined,
  fallback: string,
): string {
  if (!entry) return fallback;
  if (entry.officialName) return entry.officialName;
  return entry.form ? `${entry.name}_${entry.form}` : entry.name;
}