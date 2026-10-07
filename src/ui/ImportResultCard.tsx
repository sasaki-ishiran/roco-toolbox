import { useState } from 'react';
import { gradeLabel, type PetGrade } from '../domain/petFilters';
import type { AccountImportResult, QualifiedPetRow } from '../domain/importDiff';
import { useTargetMode } from './targetModeStore';
import { useLastImportHistory } from './useLastImportResult';
import { GenderMark } from './GenderMark';

/** 一次导入新增里「够格进看板分类」的精灵数（种公 + 母本）。 */
export const countOf = (account: AccountImportResult): number =>
  account.studs.reduce((sum, group) => sum + group.pets.length, 0) +
  account.mothers.reduce((sum, group) => sum + group.pets.length, 0);

export function PetRow({ pet, testId }: { pet: QualifiedPetRow; testId: string }) {
  return (
    <li
      data-testid={testId}
      className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700"
    >
      {pet.label} <GenderMark gender={pet.gender} /> · {pet.nature}
      {pet.groupLabels && pet.groupLabels.length > 0 ? ` · ${pet.groupLabels.join('/')}` : ''} ·{' '}
      {pet.voiceDb}dB · {pet.box}
    </li>
  );
}

export function AccountBlock({ account }: { account: AccountImportResult }) {
  const mode = useTargetMode();
  const total = countOf(account);

  return (
    <div data-testid="import-result-account">
      <h3 className="text-sm font-medium text-slate-900">
        {account.accountName}
        {account.isFirstImport ? (
          <span className="ml-1 text-xs font-normal text-slate-400">首次导入</span>
        ) : null}
      </h3>

      {total === 0 ? (
        <p className="mt-1 text-xs text-slate-400">没有新增符合要求的精灵。</p>
      ) : null}

      {account.studs.map((group) => (
        <div key={group.studClass} className="mt-1.5">
          <p className="text-xs text-slate-400">
            新增{gradeLabel(group.studClass, mode)}种公 {group.pets.length}
          </p>
          <ul className="mt-1 space-y-1">
            {group.pets.map((pet, index) => (
              <PetRow
                key={`stud-${group.studClass}-${pet.label}-${pet.box}-${index}`}
                pet={pet}
                testId="import-result-stud"
              />
            ))}
          </ul>
        </div>
      ))}

      {account.mothers.map((group) => (
        <div key={group.motherClass} className="mt-1.5">
          <p className="text-xs text-slate-400">
            新增{gradeLabel(group.motherClass as PetGrade, mode)}母本 {group.pets.length}
          </p>
          <ul className="mt-1 space-y-1">
            {group.pets.map((pet, index) => (
              <PetRow
                key={`mother-${group.motherClass}-${pet.label}-${pet.box}-${index}`}
                pet={pet}
                testId="import-result-mother"
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * 导入历史入口：最近几次导入记录都在这里，点开某次看明细。
 *
 * 2026-10-05（用户拍板）：「本次新增」明细移到看板（ImportAdditionCard），
 * 导入数据页只剩历史入口——只要有历史就渲染（重启后入口仍在）。
 */
export function ImportResultCard() {
  const history = useLastImportHistory();
  // 展开查看的那条历史（点同一行再点收起来）
  const [expandedAt, setExpandedAt] = useState<string | null>(null);

  return (
    <section data-testid="import-result" className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="text-sm font-medium text-slate-500">导入历史（{history.length} 次）</h2>
      {history.length > 0 ? (
        <div className="mt-2 border-t border-slate-100 pt-2" data-testid="import-result-history">
          <p className="text-xs font-medium text-slate-400">最近 {history.length} 次导入，点开看明细</p>
          <ul className="mt-1 space-y-0.5">
            {history.map((entry) => {
              const shown = expandedAt === entry.at;
              return (
                <li key={entry.at}>
                  <button
                    type="button"
                    data-testid="import-result-entry"
                    aria-expanded={shown}
                    onClick={() => setExpandedAt(shown ? null : entry.at)}
                    className="flex w-full items-baseline justify-between gap-2 rounded-md px-1 py-1 text-left text-xs text-slate-500 hover:bg-slate-50"
                  >
                    <span className="shrink-0">{formatTime(entry.at)}</span>
                    <span className="truncate text-slate-400">
                      {entry.results
                        .map(
                          (account) =>
                            `${account.accountName}（${
                              account.studs.reduce((sum, g) => sum + g.pets.length, 0) +
                              account.mothers.reduce((sum, g) => sum + g.pets.length, 0)
                            }）`,
                        )
                        .join('、')}
                    </span>
                    <span className="shrink-0">{shown ? '收起' : '查看'}</span>
                  </button>
                  {shown ? (
                    <div
                      data-testid="import-result-history-detail"
                      className="mt-1 space-y-3 rounded-lg bg-slate-50/60 p-2"
                    >
                      {entry.results.map((account) => (
                        // 老历史条目没有 accountKey（该字段是后加的），退回名字兜底
                        <AccountBlock
                          key={`${entry.at}-${account.accountKey ?? account.accountName}`}
                          account={account}
                        />
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-400" data-testid="import-result-empty">
          还没有导入过数据。
        </p>
      )}
    </section>
  );
}

/** 导入时间转可读格式（本地时区、24 小时制）。 */
const formatTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
};
