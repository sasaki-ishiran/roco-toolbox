import { useEffect, useState } from 'react';
import { eggGroupNames, targetNaturePool } from '../data/catalog';
import { ALL_EGG_GROUP_IDS, ALL_GRADES } from '../domain/coverageTargets';
import {
  DEFAULT_MOTHER_CRITERIA,
  motherVoicesForMode,
  type MotherBody,
} from '../domain/motherCriteria';
import { gradeLabel, TARGET_MODE_LABELS, type TargetMode } from '../domain/petFilters';
import {
  resetCoverageFilter,
  setNatureMode,
  toggleAllCustomNatures,
  toggleCustomNature,
  toggleFilterGrade,
  toggleFilterGroup,
  useCoverageFilter,
} from './coverageFilterStore';
import { getMotherCriteria, setMotherCriteria, useMotherCriteria } from './motherCriteriaStore';
import { setTargetMode, useTargetMode } from './targetModeStore';
import { Button } from './primitives/Button';
import { ModalSurface } from './primitives/ModalSurface';
import { ScopeSummary } from './primitives/ScopeSummary';
import { SegmentedControl } from './primitives/SegmentedControl';

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
 * 唯一的目标编辑入口（2026-10-24 重构任务 5）。
 *
 * - 种公目标：模式 / 档位 / 蛋组 / 性格模式（每组推荐性格仍在覆盖度里细化）
 * - 个人母本达标条件：体型 / 声音，空 = 该维度不限
 *
 * 读写原 store，不迁移键、不改领域算法；两个分区互不改对方条件。
 */
export function CollectionTargetEditor({ open, section, onClose }: CollectionTargetEditorProps) {
  const [active, setActive] = useState<CollectionTargetSection>(section);
  useEffect(() => {
    if (open) setActive(section);
  }, [open, section]);

  const mode = useTargetMode();
  const filter = useCoverageFilter();
  const criteria = useMotherCriteria();
  const visibleGrades = ALL_GRADES;

  const toggleNatureMode = (next: string) =>
    setNatureMode(next === 'custom' ? 'custom' : 'recommended');

  return (
    <ModalSurface
      open={open}
      title="调整目标"
      onClose={onClose}
      testId="target-editor"
      footer={<Button onClick={onClose}>完成</Button>}
    >
      <div className="space-y-3 p-4">
        <SegmentedControl
          label="编辑分区"
          value={active}
          options={[
            { value: 'studs', label: '种公目标' },
            { value: 'mothers', label: '母本达标条件' },
          ]}
          onValueChange={(next) => setActive(next as CollectionTargetSection)}
          optionTestId={(value) => `editor-section-${value}`}
        />

        {active === 'studs' ? (
          <div className="space-y-3" data-testid="editor-studs">
            <ScopeSummary
              scope="个人种公目标"
              criteria="影响看板、覆盖度、配窝与换什么；不影响个人母本进度"
            />

            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">目标模式</p>
              <SegmentedControl
                label="目标模式"
                value={mode}
                options={(['perfect', 'medal'] as TargetMode[]).map((value) => ({
                  value,
                  label: TARGET_MODE_LABELS[value],
                }))}
                onValueChange={(next) => setTargetMode(next as TargetMode)}
                optionTestId={(value) => `editor-target-mode-${value}`}
              />
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">目标档位</p>
              <div className="flex flex-wrap gap-1.5">
                {visibleGrades.map((grade) => (
                  <button
                    key={grade}
                    type="button"
                    aria-pressed={filter.grades.includes(grade)}
                    onClick={() => toggleFilterGrade(grade)}
                    data-testid={`editor-target-grade-${grade}`}
                    className={`${CHIP} ${
                      filter.grades.includes(grade) ? CHIP_ON : CHIP_OFF
                    }`}
                  >
                    {gradeLabel(grade, mode)}
                  </button>
                ))}
              </div>
              {filter.grades.length === 0 ? (
                <p className="mt-1 text-xs text-amber-700">未选档位 = 没有种公目标槽位。</p>
              ) : null}
            </div>

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
                    {filter.customNatures.length === targetNaturePool.length ? '全部取消' : '全选'}
                  </button>
                </div>
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
              恢复默认蛋组与性格（档位保留）
            </button>
          </div>
        ) : (
          <div className="space-y-3" data-testid="editor-mothers">
            <ScopeSummary
              scope="我的母本达标条件"
              criteria="影响个人母本进度与看板；不影响种公目标，也不改小组口径"
            />

            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">体型（空 = 不限）</p>
              <div className="flex flex-wrap gap-1.5">
                {(['大块头', '小不点'] as MotherBody[]).map((body) => (
                  <button
                    key={body}
                    type="button"
                    aria-pressed={criteria.bodies.includes(body)}
                    onClick={() => {
                      const current = getMotherCriteria();
                      setMotherCriteria({
                        ...current,
                        bodies: current.bodies.includes(body)
                          ? current.bodies.filter((item) => item !== body)
                          : [...current.bodies, body],
                      });
                    }}
                    data-testid={`editor-mother-body-${body}`}
                    className={`${CHIP} ${criteria.bodies.includes(body) ? CHIP_ON : CHIP_OFF}`}
                  >
                    {body}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">声音（空 = 不限）</p>
              <div className="flex flex-wrap gap-1.5">
                {motherVoicesForMode(mode).map((voice) => (
                  <button
                    key={voice}
                    type="button"
                    aria-pressed={criteria.voices.includes(voice)}
                    onClick={() => {
                      const current = getMotherCriteria();
                      setMotherCriteria({
                        ...current,
                        voices: current.voices.includes(voice)
                          ? current.voices.filter((item) => item !== voice)
                          : [...current.voices, voice],
                      });
                    }}
                    data-testid={`editor-mother-voice-${voice}`}
                    className={`${CHIP} ${criteria.voices.includes(voice) ? CHIP_ON : CHIP_OFF}`}
                  >
                    {voice}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                追满分模式只列 +100 / -100；切到追双牌会列婉转声 / 粗嗓门。
              </p>
            </div>

            <button
              type="button"
              onClick={() => setMotherCriteria({ ...DEFAULT_MOTHER_CRITERIA })}
              data-testid="editor-reset-mothers"
              className="min-h-[28px] text-xs font-medium text-emerald-700"
            >
              恢复默认（大块头+小不点 × +100/-100）
            </button>
          </div>
        )}
      </div>
    </ModalSurface>
  );
}
