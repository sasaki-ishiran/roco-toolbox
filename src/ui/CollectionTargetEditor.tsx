import { eggGroupNames, targetNaturePool } from '../data/catalog';
import { ALL_EGG_GROUP_IDS } from '../domain/coverageTargets';
import { DEFAULT_MOTHER_CRITERIA, motherVoicesForMode } from '../domain/motherCriteria';
import {
  resetCoverageFilter,
  setNatureMode,
  toggleAllCustomNatures,
  toggleCustomNature,
  toggleFilterGroup,
  useCoverageFilter,
} from './coverageFilterStore';
import { setMotherCriteria } from './motherCriteriaStore';
import { useTargetMode } from './targetModeStore';
import { Button } from './primitives/Button';
import { ModalSurface } from './primitives/ModalSurface';
import { ScopeSummary } from './primitives/ScopeSummary';
import { SegmentedControl } from './primitives/SegmentedControl';
import { MotherCriteriaMedals } from './MotherCriteriaMedals';

export type CollectionTargetSection = 'studs' | 'mothers';

export interface CollectionTargetEditorProps {
  open: boolean;
  section: CollectionTargetSection;
  onClose: () => void;
}

const CHIP = 'min-h-[28px] rounded-md border px-2 text-xs';
const CHIP_ON = 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700';
const CHIP_OFF = 'border-slate-200 bg-white text-slate-500';

/**
 * 种公目标与母本达标条件共用编辑表单，但由各自入口独立打开。
 *
 * - 种公目标：蛋组 / 性格模式（奖牌组合与目标模式在看板调整）
 * - 个人母本达标条件：体型 / 声音，空 = 该维度不限
 *
 * 读写原 store，不迁移键、不改领域算法；两个分区互不改对方条件。
 */
export function CollectionTargetEditor({ open, section, onClose }: CollectionTargetEditorProps) {
  const mode = useTargetMode();
  const filter = useCoverageFilter();

  const toggleNatureMode = (next: string) =>
    setNatureMode(next === 'custom' ? 'custom' : next === 'recommended' ? 'recommended' : 'eight');

  return (
    <ModalSurface
      open={open}
      title={section === 'studs' ? '调整目标' : '调整母本达标条件'}
      onClose={onClose}
      testId="target-editor"
      footer={<Button onClick={onClose}>完成</Button>}
    >
      <div className="space-y-3 p-4">
        {section === 'studs' ? (
          <div className="space-y-3" data-testid="editor-studs">
            <ScopeSummary
              scope="个人种公目标"
              criteria="影响看板、覆盖度、配窝与小组求蛋；不影响个人母本进度"
            />

            <div>
              <button
                type="button"
                aria-expanded={filter.groupIds.length > 0}
                onClick={() => {
                  if (filter.groupIds.length > 0) {
                    for (const groupId of [...filter.groupIds]) toggleFilterGroup(groupId);
                  } else {
                    for (const groupId of ALL_EGG_GROUP_IDS) toggleFilterGroup(groupId);
                  }
                }}
                className="min-h-[28px] text-xs font-medium text-emerald-700"
                data-testid="editor-groups-toggle"
              >
                蛋组（{filter.groupIds.length}/14）
              </button>
              <div className="flex flex-wrap gap-1.5">
                {ALL_EGG_GROUP_IDS.map((groupId) => (
                  <button
                    key={groupId}
                    type="button"
                    aria-pressed={filter.groupIds.includes(groupId)}
                    onClick={() => toggleFilterGroup(groupId)}
                    data-testid={`editor-group-${groupId}`}
                    className={`${CHIP} ${
                      filter.groupIds.includes(groupId) ? CHIP_ON : CHIP_OFF
                    }`}
                  >
                    {eggGroupNames[groupId] ?? `蛋组${groupId}`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">性格</p>
              <SegmentedControl
                label="性格模式"
                value={filter.natureMode}
                options={[
                  { value: 'recommended', label: '推荐性格' },
                  { value: 'eight', label: '八大性格' },
                  { value: 'custom', label: '自选性格' },
                ]}
                onValueChange={toggleNatureMode}
                optionTestId={(value) => `editor-nature-mode-${value}`}
              />
              {filter.natureMode === 'custom' ? (
                <div className="mt-2">
                  <div className="flex flex-wrap gap-1.5">
                    {targetNaturePool.map((entry) => (
                      <button
                        key={entry.name}
                        type="button"
                        aria-pressed={filter.customNatures.includes(entry.name)}
                        onClick={() => toggleCustomNature(entry.name)}
                        data-testid={`editor-custom-nature-${entry.name}`}
                        className={`${CHIP} ${
                          filter.customNatures.includes(entry.name) ? CHIP_ON : CHIP_OFF
                        }`}
                      >
                        {entry.name}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={toggleAllCustomNatures}
                    className="mt-1 min-h-[28px] text-xs text-slate-500"
                  >
                    {targetNaturePool.every((entry) => filter.customNatures.includes(entry.name))
                      ? '全部取消'
                      : '全选八大'}
                  </button>
                </div>
              ) : filter.natureMode === 'eight' ? (
                <p className="mt-1 text-xs text-slate-400">
                  八大性格全集（{targetNaturePool.length} 个）：所有蛋组都按同一组性格算。
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-400">每组用图鉴推荐的前 3 个性格；组内增减在覆盖度页。</p>
              )}
            </div>

            <button
              type="button"
              onClick={resetCoverageFilter}
              data-testid="editor-reset-studs"
              className="min-h-[28px] text-xs font-medium text-emerald-700"
            >
              恢复默认蛋组与性格
            </button>
          </div>
        ) : (
          <div className="space-y-3" data-testid="editor-mothers">
            <ScopeSummary
              scope="我的母本达标条件"
              criteria="影响个人母本进度与看板；不影响种公目标，也不改小组口径"
            />

            <MotherCriteriaMedals testIdPrefix="editor-mother" />

            <button
              type="button"
              onClick={() =>
                setMotherCriteria({
                  ...DEFAULT_MOTHER_CRITERIA,
                  voices: motherVoicesForMode(mode),
                })
              }
              data-testid="editor-reset-mothers"
              className="min-h-[28px] text-xs font-medium text-emerald-700"
            >
              恢复默认（大块头+小不点 × {mode === 'perfect' ? '+100/-100' : '婉转声/粗嗓门'}）
            </button>
          </div>
        )}
      </div>
    </ModalSurface>
  );
}
