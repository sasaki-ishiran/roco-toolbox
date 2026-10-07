import { eggGroupNames, species } from '../data/catalog';
import { analyzeImport } from '../domain/importDiff';
import type { AccountSnapshot } from '../domain/parseBackup';
import { setLastImportResult } from '../storage/lastImportStore';
import { listSnapshots } from '../storage/snapshots';
import { countOf } from './ImportResultCard';
import { getTargetMode } from './targetModeStore';

/**
 * 云同步（含分享导入后的自动同步）合并进来的精灵，也要进看板「本次新增」卡。
 *
 * 2026-10-07 用户要求：不然点完同步只看到「已同步」，不知道到底同步进来了什么。
 *
 * - 口径与导入完全一致：复用同一个 `analyzeImport`，把「同步前的本机快照」与同步后的比一遍；
 * - 没有任何够格新增就不动卡片（别用一张空卡盖掉上一次的导入结果）；
 * - **不写导入历史**——同步不是导入，别污染「导入历史（N 次）」。
 *
 * @param previous 同步**之前**的本机快照（调用方在点同步前取，见 AccountPanel / ImportPanel）
 */
export async function recordSyncedPets(previous: AccountSnapshot[]): Promise<void> {
  const results = analyzeImport({
    previous,
    imported: await listSnapshots(),
    species,
    eggGroupNames,
    mode: getTargetMode(),
  });
  const total = results.reduce((sum, account) => sum + countOf(account), 0);
  if (total === 0) return;
  setLastImportResult(results, { history: false });
}
