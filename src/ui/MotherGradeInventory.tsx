import { useMemo, useState, type ReactNode } from 'react';
import {
  MOTHER_CLASS_ORDER,
  classifyMother,
  gradeLabel,
  type MotherGroup,
  type MotherClass,
  type PetGrade,
  type TargetMode,
} from '../domain/petFilters';
import { boxLabel } from '../domain/coverageDetail';
import { speciesDisplayName } from '../domain/speciesName';
import { species } from '../data/catalog';
import type { OwnedPet } from '../domain/types';
import { AccountSection } from './AccountSection';
import { GenderMark } from './GenderMark';
import { PetAvatar } from './PetAvatar';
import { InlineSelect } from './primitives/InlineSelect';

export interface MotherGradeInventoryProps {
  motherGroups: MotherGroup[];
  owned: OwnedPet[];
  mode: TargetMode;
}

/**
 * 「按代表母本档位查看」库存（2026-10-24 重构任务 7）：从看板迁到收集 · 精灵库的次入口。
 *
 * 这里按**代表个体**的档位分类，和「个人母本已收集数」不是一回事，标题与说明必须写清。
 */
export function MotherGradeInventory({ motherGroups, owned, mode }: MotherGradeInventoryProps) {
  const [grade, setGrade] = useState<PetGrade>('大婉');
  const [listOpen, setListOpen] = useState(false);
  const speciesByGameId = useMemo(() => new Map(species.map((entry) => [entry.gameId, entry])), []);

  const counts = useMemo(() => {
    const map = new Map<MotherClass, number>();
    for (const group of motherGroups) {
      if (!group.motherClass) continue;
      map.set(group.motherClass, (map.get(group.motherClass) ?? 0) + 1);
    }
    return map;
  }, [motherGroups]);

  const filtered = useMemo(
    () => motherGroups.filter((group) => group.motherClass === grade),
    [motherGroups, grade],
  );

  const representativeOf = (group: MotherGroup): OwnedPet | undefined => {
    const index =
      group.memberIndexes.find((item) => classifyMother(owned[item], mode) === group.motherClass) ??
      group.memberIndexes.find((item) => owned[item].gender === '母');
    return index === undefined ? undefined : owned[index];
  };

  const grouped = useMemo(() => {
    const map = new Map<string, { group: MotherGroup; mother: OwnedPet | undefined }[]>();
    for (const group of filtered) {
      const account = representativeOf(group)?.account ?? '未知账号';
      const list = map.get(account) ?? [];
      list.push({ group, mother: representativeOf(group) });
      map.set(account, list);
    }
    return [...map.entries()].map(([account, chains]) => ({ account, chains }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, owned, mode]);

  const renderRow = ({
    group,
    mother,
  }: {
    group: MotherGroup;
    mother: OwnedPet | undefined;
  }): ReactNode => (
    <li
      key={group.chainKey}
      className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"
      data-testid="mother-filter-row"
    >
      {mother ? (
        <>
          <PetAvatar
            gameId={mother.gameId}
            name={speciesDisplayName(speciesByGameId.get(mother.gameId), mother.name)}
            size={20}
          />
          <span className="min-w-0 break-words">
            {speciesDisplayName(speciesByGameId.get(mother.gameId), mother.name)}{' '}
            <GenderMark gender={mother.gender} />（{boxLabel(mother)}）
          </span>
        </>
      ) : (
        group.formLabel || '未知精灵'
      )}
    </li>
  );

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" data-testid="mother-grade-inventory">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1 text-sm font-medium text-slate-500" data-testid="mother-filter-title">
          <span className="shrink-0">按代表档位查看 </span>
          <InlineSelect
            label="代表母本档位"
            value={grade}
            options={MOTHER_CLASS_ORDER.filter((motherClass) => motherClass !== '其他').map(
              (motherClass) => ({
                value: motherClass,
                label: `${gradeLabel(motherClass as PetGrade, mode)} (${counts.get(motherClass) ?? 0})`,
              }),
            )}
            onValueChange={(next) => {
              setGrade(next as PetGrade);
              setListOpen(true);
            }}
            testId="mother-grade-select"
            menuTestId="mother-grade-options"
            optionTestId={(value) => `mother-grade-option-${value}`}
            className="min-w-[96px]"
          />
        </h2>
        <button
          type="button"
          aria-expanded={listOpen}
          onClick={() => setListOpen((prev) => !prev)}
          className="min-h-[28px] shrink-0 text-xs text-slate-400"
          data-testid="mother-list-toggle"
        >
          {listOpen ? '收起' : '展开'}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        按代表个体的档位分类，不等于个人母本达标数（那在母本页）。
      </p>

      {listOpen ? (
        <div className="mt-2 space-y-2" data-testid="mother-filter-result">
          {grouped.length === 0 ? (
            <p className="text-xs text-slate-400">这个档位暂时没有合格的母本。</p>
          ) : (
            grouped.map(({ account, chains }) => (
              <AccountSection key={account} account={account}>
                <ul className="space-y-1">{chains.map(renderRow)}</ul>
              </AccountSection>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
