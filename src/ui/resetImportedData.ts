import { clearAllSnapshots } from '../storage/snapshots';
import { refreshSnapshots } from '../storage/snapshotStore';
import { clearLastImportHistory, clearLastImportResult } from '../storage/lastImportStore';
import { clearAccountFilter } from './accountFilterStore';
import { clearDemandPicks } from './demandPickStore';
import { resetImportOutcome } from './importOutcomeStore';
import { setImportMessage } from './importMessageStore';
import { resetListViews } from './listViewStore';
import { clearMyPetsFilters } from './myPetsFilterStore';
import { clearMotherPlan } from './motherPlanStore';
import { clearSuggestionCard } from './suggestionCardStore';
import { clearSyncFeedback } from './syncNoticeStore';

/**
 * 重置本机导入数据（2026-10-25）。
 *
 * 清空 IndexedDB 里的账号快照，同时清掉**所有由这批数据派生的页面状态**：
 * 导入历史/本次新增、账号筛选、清单筛选、母本计划、「已换到」标记、导入反馈。
 * 只保留目标档位、母本达标条件等「设置」，以及工具箱身份与已发布的小组资源。
 */
export async function resetImportedData(): Promise<void> {
  await clearAllSnapshots();
  await refreshSnapshots();
  clearLastImportResult();
  clearLastImportHistory();
  clearSyncFeedback();
  resetImportOutcome();
  setImportMessage(null);
  clearSuggestionCard();
  clearMotherPlan();
  clearAccountFilter();
  clearDemandPicks();
  clearMyPetsFilters();
  resetListViews();
}
