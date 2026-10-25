import { useMemo, useState } from 'react';
import { allNatureNames, species } from '../data/catalog';
import { defaultEggNatures, eggNatures } from '../domain/recommendedNatures';
import { NATURE_OVERRIDE_MAX_NATURES } from '../shared/collectionGroups';
import { setEggNatures, useNatureOverrides } from './natureOverrideStore';
import { ModalSurface } from './primitives/ModalSurface';
import { SearchField } from './primitives/SearchField';

export interface RecommendedNatureEditorProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 推荐性格（按蛋编辑，2026-10-25 用户拍板）。
 *
 * - 列表只有可孵蛋的「基础形态」：一颗蛋一行，改性格在蛋粒度；
 * - 没改过的蛋用图鉴的 PVP 推荐，图鉴没收录的按种族值兜底；
 * - 改完立即存本机、随云同步到自己的账号；**小组里由组长在「本组目标」保存后生效**
 *   （2026-10-25 用户拍板：手动更新口径，不自动推送）。
 */
export function RecommendedNatureEditor({ open, onClose }: RecommendedNatureEditorProps) {
  const overrides = useNatureOverrides();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<number | null>(null);

  const eggs = useMemo(
    () =>
      species
        .filter(
          (entry) =>
            entry.eggGameId === entry.gameId &&
            (entry.eggGroups ?? []).some((groupId) => groupId >= 2 && groupId <= 15),
        )
        .sort(
          (a, b) =>
            a.number.localeCompare(b.number) || a.name.localeCompare(b.name, 'zh-Hans-CN'),
        ),
    [],
  );

  const keyword = query.trim().toLowerCase();
  const filtered = keyword
    ? eggs.filter(
        (egg) =>
          egg.name.toLowerCase().includes(keyword) || egg.number.includes(keyword),
      )
    : eggs;

  const change = (eggGameId: number, natures: string[]) => {
    setEggNatures(eggGameId, natures);
  };

  const toggle = (eggGameId: number, current: readonly string[], nature: string) => {
    if (current.includes(nature)) {
      change(eggGameId, current.filter((item) => item !== nature));
      return;
    }
    if (current.length >= NATURE_OVERRIDE_MAX_NATURES) return;
    change(eggGameId, [...current, nature]);
  };

  return (
    <ModalSurface
      open={open}
      title="推荐性格"
      onClose={onClose}
      testId="nature-editor"
      closeTestId="nature-editor-close"
      backdropTestId="nature-editor-backdrop"
    >
      <div className="space-y-2 p-3">
        <p className="text-[11px] leading-snug text-slate-400">
          按蛋设置，最多 {NATURE_OVERRIDE_MAX_NATURES} 个。没改过的蛋用图鉴推荐；图鉴没收录的按种族值兜底。
          小组按组长这份表判定：改完请在「本组目标」里点一次保存，成员再重新发布。
        </p>
        <SearchField
          label="搜索蛋"
          value={query}
          onValueChange={setQuery}
          placeholder="搜蛋名 / 图鉴号"
          testId="nature-editor-search"
        />

        {filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">没有匹配的蛋。</p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((egg) => {
              const current = eggNatures(species, egg.gameId, overrides);
              const defaults = defaultEggNatures(species, egg.gameId);
              const customized = (overrides[String(egg.gameId)]?.length ?? 0) > 0;
              const expanded = editing === egg.gameId;
              return (
                <li
                  key={egg.gameId}
                  className="rounded-xl bg-slate-50 px-2.5 py-2"
                  data-testid="nature-editor-row"
                >
                  <button
                    type="button"
                    onClick={() => setEditing(expanded ? null : egg.gameId)}
                    data-testid={`nature-editor-toggle-${egg.gameId}`}
                    className="flex w-full items-baseline justify-between gap-2 text-left"
                  >
                    <span className="text-sm text-slate-700">{egg.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">
                      {current.join(' / ') || '无推荐'}
                      {customized ? ' · 已改' : ''}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="mt-1.5 space-y-1.5 border-t border-slate-200 pt-1.5">
                      <div className="flex flex-wrap gap-1">
                        {allNatureNames.map((nature) => {
                          const on = current.includes(nature);
                          return (
                            <button
                              key={nature}
                              type="button"
                              aria-pressed={on}
                              onClick={() => toggle(egg.gameId, current, nature)}
                              data-testid={`nature-option-${egg.gameId}-${nature}`}
                              className={`min-h-[28px] rounded-md border px-2 text-xs ${
                                on
                                  ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700'
                                  : 'border-slate-200 bg-white text-slate-500'
                              }`}
                            >
                              {nature}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-slate-400">
                          默认：{defaults.join(' / ') || '无'}
                        </p>
                        <button
                          type="button"
                          disabled={!customized}
                          onClick={() => change(egg.gameId, [])}
                          data-testid={`nature-editor-reset-${egg.gameId}`}
                          className="min-h-[28px] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-500 disabled:opacity-40"
                        >
                          恢复默认
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ModalSurface>
  );
}
