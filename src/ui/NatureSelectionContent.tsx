export interface NatureSelectionOption {
  id: string;
  label: string;
  count?: number;
}

export interface NatureSelectionGroups {
  target: NatureSelectionOption[];
  stats: Array<{ stat: string; options: NatureSelectionOption[] }>;
  other: NatureSelectionOption[];
}

export const NATURE_STAT_ORDER = ['物攻', '物防', '魔攻', '魔防', '速度', '生命'];

export function groupNatureOptions(
  options: NatureSelectionOption[],
  targetNames: readonly string[],
  naturePlusStats: ReadonlyMap<string, string>,
  catalogOrder: readonly string[],
): NatureSelectionGroups {
  const byName = new Map(options.map((option) => [option.label, option]));
  const target = targetNames
    .map((name) => byName.get(name))
    .filter((option): option is NatureSelectionOption => option !== undefined);
  const order = new Map(catalogOrder.map((name, index) => [name, index]));
  const orderedOptions = [...options].sort(
    (a, b) =>
      (order.get(a.label) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.label) ?? Number.MAX_SAFE_INTEGER) ||
      a.label.localeCompare(b.label),
  );
  const stats = NATURE_STAT_ORDER.map((stat) => ({
    stat,
    options: orderedOptions.filter((option) => naturePlusStats.get(option.label) === stat),
  })).filter((group) => group.options.length > 0);
  const groupedLabels = new Set(stats.flatMap((group) => group.options.map((option) => option.label)));

  return {
    target,
    stats,
    other: orderedOptions.filter((option) => !groupedLabels.has(option.label)),
  };
}

export function NatureSelectionContent({
  groups,
  selected,
  onToggle,
  onToggleGroup,
  onClear,
  showAll,
  onShowAllChange,
}: {
  groups: NatureSelectionGroups;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleGroup: (options: NatureSelectionOption[]) => void;
  onClear: () => void;
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
}) {
  const renderOption = (option: NatureSelectionOption, showCount = true) => {
    const on = selected.has(option.id);
    const countLabel = showCount && option.count !== undefined ? ` (${option.count})` : '';
    const countDescription =
      !showCount && option.count !== undefined ? `${option.label}，${option.count}只` : undefined;

    return (
      <button
        key={option.id}
        type="button"
        aria-pressed={on}
        aria-label={countDescription}
        title={countDescription}
        onClick={() => onToggle(option.id)}
        data-testid={`filter-opt-nature-${option.id}`}
        className={`flex min-h-[30px] w-full items-center justify-center rounded-md border px-1.5 py-1 text-xs transition ${
          on
            ? 'bg-emerald-500 font-semibold text-white shadow'
            : 'bg-slate-100 font-medium text-slate-500'
        }`}
      >
        {option.label}{countLabel}
      </button>
    );
  };

  return (
    <div className="space-y-1.5" data-testid="nature-filter-groups">
      {groups.target.length > 0 ? (
        <section data-testid="filter-nature-group-target">
          <div
            className="relative mb-1 flex w-full flex-nowrap items-center justify-center gap-1"
            data-testid="nature-group-controls"
          >
            <button
              type="button"
              aria-pressed={!showAll}
              onClick={() => onShowAllChange(false)}
              className={`rounded-md border px-2 py-0.5 text-[11px] transition ${
                !showAll
                  ? 'border-emerald-500 bg-emerald-500 font-semibold text-white'
                  : 'border-slate-200 bg-slate-50 font-medium text-slate-600'
              }`}
              data-testid="filter-nature-target-toggle"
            >
              八大性格
            </button>
            <button
              type="button"
              aria-pressed={showAll}
              onClick={() => onShowAllChange(true)}
              className={`rounded-md border px-2 py-0.5 text-[11px] transition ${
                showAll
                  ? 'border-emerald-500 bg-emerald-500 font-semibold text-white'
                  : 'border-slate-200 bg-white font-medium text-emerald-700'
              }`}
              data-testid="nature-show-all-toggle"
            >
              全部性格
            </button>
            <button
              type="button"
              onClick={onClear}
              className="absolute right-0 rounded px-1 text-[11px] font-medium text-emerald-600"
              data-testid="filter-clear-nature"
            >
              清除
            </button>
          </div>
          {!showAll ? (
            <div className="grid grid-cols-4 justify-items-center gap-1">
              {groups.target.map((option) => renderOption(option))}
            </div>
          ) : null}
        </section>
      ) : null}
      {showAll ? (
        <>
          {groups.stats.map(({ stat, options }) => {
            const allSelected = options.every((option) => selected.has(option.id));
            return (
              <section
                key={stat}
                className="max-w-full"
                data-testid={`filter-nature-group-${stat}`}
              >
                <div className="grid grid-cols-6 items-center gap-1">
                  <div className="flex items-center justify-center gap-0.5 whitespace-nowrap">
                    <button
                      type="button"
                      aria-pressed={allSelected}
                      onClick={() => onToggleGroup(options)}
                      className={`rounded-md border px-1.5 py-1 text-xs transition ${
                        allSelected
                          ? 'border-emerald-500 bg-emerald-500 font-semibold text-white'
                          : 'border-slate-200 bg-slate-50 font-medium text-slate-600'
                      }`}
                      data-testid={`filter-nature-stat-${stat}`}
                    >
                      {stat}
                    </button>
                    <span className="text-xs">:</span>
                  </div>
                  {options.map((option) => renderOption(option, false))}
                </div>
              </section>
            );
          })}
          {groups.other.length > 0 ? (
            <section className="max-w-full" data-testid="filter-nature-group-other">
              <div className="flex flex-nowrap items-center justify-center gap-0.5 whitespace-nowrap">
                <button
                  type="button"
                  aria-pressed={groups.other.every((option) => selected.has(option.id))}
                  onClick={() => onToggleGroup(groups.other)}
                  className="rounded-md border border-slate-200 bg-slate-50 px-0.5 py-0.5 text-[10px] font-medium text-slate-600 transition"
                  data-testid="filter-nature-stat-other"
                >
                  其他
                </button>
                <span className="text-[10px]">:</span>
                {groups.other.map((option) => renderOption(option, false))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
