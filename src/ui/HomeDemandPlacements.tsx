import { useEffect, useMemo, useState } from 'react';
import { eggGroupNames, species } from '../data/catalog';
import { boxLabel } from '../domain/coverageDetail';
import {
  buildDemandPlacements,
  type DemandPlacement,
  type DemandPlacementDemand,
  type DemandPlacementParent,
  type DemandPlacementSkip,
} from '../domain/demandPlacement';
import { accountKeyOf, type AccountSnapshot } from '../domain/parseBackup';
import {
  placementRowKey,
  readCollapsedAccounts,
  readPlacementMarks,
  togglePlacementMark,
  writeCollapsedAccounts,
  type PlacementMarks,
} from './demandPlacementStore';
import { PetAvatar } from './PetAvatar';
import { PetCompactCard } from './PetCompactCard';
import { CARD, HINT, TITLE } from './primitives/styles';
import { useClaimedDemands } from './useClaimedDemands';

/**
 * 家园 · 接单上窝（需求中心二期）。
 *
 * 把需求中心里「我接的、未完成」的单跨小组汇总，按账号给出一份上窝名单：
 * 母本 + 种公 + 账号盒位，已在家园的标绿，可本机勾「已上窝」。
 */
export interface HomeDemandPlacementsProps {
  snapshots: readonly AccountSnapshot[];
  labelOf: (snapshot: AccountSnapshot) => string;
  loaded: boolean;
}

const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));

const instanceIdOf = (pet: { captureId?: string }): string | null => {
  if (!pet.captureId) return null;
  const index = pet.captureId.lastIndexOf('_');
  return index < 0 ? null : pet.captureId.slice(index + 1);
};

const eggNameOf = (eggGameId: number): string => {
  if (eggGameId < 0) {
    const groupId = -eggGameId;
    const name = eggGroupNames[groupId];
    return name ? `${name.replace(/组$/, '')}组 · 种公需求` : '种公需求';
  }
  return speciesByGameId.get(eggGameId)?.name ?? '未知的蛋';
};

const conditionTags = (demand: DemandPlacementDemand): Array<{ text: string; className: string }> => {
  const tags: Array<{ text: string; className: string }> = [];
  if (demand.nature) tags.push({ text: demand.nature, className: 'bg-violet-50 text-violet-700' });
  if (demand.gender) tags.push({ text: demand.gender, className: 'bg-pink-50 text-pink-700' });
  if (demand.body) tags.push({ text: demand.body, className: 'bg-emerald-50 text-emerald-700' });
  if (demand.voice) tags.push({ text: demand.voice, className: 'bg-sky-50 text-sky-700' });
  return tags;
};

function ParentCard({
  role,
  parent,
  accountLabel,
  inHome,
  academyNest,
}: {
  role: '母本' | '种公';
  parent: DemandPlacementParent;
  accountLabel: string;
  inHome: boolean;
  /** 学院方案时：这一只要放进学院小窝（另一只放普通窝）。 */
  academyNest: boolean;
}) {
  const pet = parent.pet;
  const entry = speciesByGameId.get(pet.gameId);
  const box = boxLabel(pet);
  return (
    <div className="relative shrink-0" style={{ width: 153, height: 115 }}>
      {academyNest ? (
        <span className="absolute -top-2 left-1 z-20 rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white">
          进学院小窝
        </span>
      ) : null}
      {inHome ? (
        <span className="absolute -top-2 right-1 z-20 rounded-full bg-emerald-100 px-1 text-[9px] font-bold text-emerald-700">
          已在家园
        </span>
      ) : null}
      <div className="origin-top-left" style={{ transform: 'scale(0.94)' }}>
        <PetCompactCard
          variant="demand"
          roleLabel={role}
          footer={`${accountLabel} · ${box || '位置未知'}`}
          gameId={pet.gameId}
          name={pet.name}
          gender={pet.gender}
          nature={pet.nature}
          medalBody={pet.medalBody}
          voiceDb={pet.voiceDb}
          heightPercent={pet.heightPercent}
          weightPercent={pet.weightPercent}
          eggGroups={entry?.eggGroups ?? []}
          isShiny={pet.isShiny}
          isColorful={pet.isColorful}
          testId="home-demand-parent"
        />
      </div>
      {/*
        「已在家园」的绿描边单独画一层、盖在卡片上面：卡片本身带 border + shadow-sm，
        无论 ring 还是底衬都会被它压住一部分（2026-10-30 用户两次反馈）。
        尺寸 = 卡片缩放后的 150.4×112.8，向外各扩 2px，描边刚好贴着卡片外沿。
      */}
      {inHome ? (
        <div
          className="pointer-events-none absolute -left-0.5 -top-0.5 z-10 rounded-xl border-2 border-emerald-300"
          style={{ width: 154, height: 117 }}
          data-testid="home-demand-parent-frame"
        />
      ) : null}
    </div>
  );
}

export function HomeDemandPlacements({ snapshots, labelOf, loaded }: HomeDemandPlacementsProps) {
  const { accountId, items, loading, error, reload } = useClaimedDemands();
  const [collapsedAccounts, setCollapsedAccounts] = useState<string[]>(() => readCollapsedAccounts());
  const [selectedOptions, setSelectedOptions] = useState<Record<string, number>>({});
  const [marks, setMarks] = useState<PlacementMarks>(() => readPlacementMarks(accountId));
  const [openOptions, setOpenOptions] = useState<string[]>([]);

  useEffect(() => {
    setMarks(readPlacementMarks(accountId));
  }, [accountId]);

  const labelByAccountKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const snapshot of snapshots) map.set(accountKeyOf(snapshot), labelOf(snapshot));
    return map;
  }, [snapshots, labelOf]);

  const homeInstanceIds = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const snapshot of snapshots) {
      map.set(
        accountKeyOf(snapshot),
        new Set((snapshot.home?.residents ?? []).map((resident) => resident.instanceId)),
      );
    }
    return map;
  }, [snapshots]);

  const demands = useMemo(
    () =>
      items.map((item) => ({
        groupId: item.groupId,
        groupName: item.groupName,
        demanderAccountId: item.demanderAccountId,
        eggGameId: item.eggGameId,
        nature: item.nature,
        gender: item.gender,
        body: item.body,
        voice: item.voice,
        claimedAt: item.updatedAt,
        version: item.version,
      })),
    [items],
  );

  const result = useMemo(
    () => buildDemandPlacements({ demands, snapshots, species }),
    [demands, snapshots],
  );

  const placedRows = useMemo(
    () => result.accounts.flatMap((account) => account.placements),
    [result],
  );

  const rowKeyOf = (placement: DemandPlacement): string =>
    placementRowKey({
      groupId: placement.demand.groupId,
      demanderAccountId: placement.demand.demanderAccountId,
      eggGameId: placement.demand.eggGameId,
      nature: placement.demand.nature,
      gender: placement.demand.gender,
      body: placement.demand.body,
      voice: placement.demand.voice,
      version: placement.demand.version,
    });

  const markedCount = placedRows.filter((placement) => marks[rowKeyOf(placement)]).length;
  const petCount = new Set(
    placedRows.flatMap((placement) => [
      `${placement.mother.accountKey}#${placement.mother.pet.captureId ?? placement.mother.pet.name}`,
      `${placement.father.accountKey}#${placement.father.pet.captureId ?? placement.father.pet.name}`,
    ]),
  ).size;
  const withPlacements = result.accounts.filter((account) => account.placements.length > 0);

  const isInHome = (parent: DemandPlacementParent): boolean => {
    const instanceId = instanceIdOf(parent.pet);
    if (!instanceId) return false;
    return homeInstanceIds.get(parent.accountKey)?.has(instanceId) ?? false;
  };

  const toggleOptions = (rowKey: string) =>
    setOpenOptions((current) =>
      current.includes(rowKey) ? current.filter((key) => key !== rowKey) : [...current, rowKey],
    );

  /** 一个号上完窝后把它收起来，另一个号更好找；状态写本机。 */
  const toggleAccountCollapsed = (accountKey: string) => {
    const next = collapsedAccounts.includes(accountKey)
      ? collapsedAccounts.filter((key) => key !== accountKey)
      : [...collapsedAccounts, accountKey];
    setCollapsedAccounts(next);
    writeCollapsedAccounts(next);
  };

  const toggleMark = (placement: DemandPlacement) => {
    if (!accountId) return;
    const rowKey = rowKeyOf(placement);
    setMarks(togglePlacementMark(accountId, rowKey, !marks[rowKey]));
  };

  const renderRow = (placement: DemandPlacement) => {
    const rowKey = rowKeyOf(placement);
    const tags = conditionTags(placement.demand);
    const accountLabel = labelByAccountKey.get(placement.accountKey) ?? placement.accountKey;
    const open = openOptions.includes(rowKey);
    const optionIndex = Math.min(selectedOptions[rowKey] ?? 0, placement.options.length - 1);
    const active = placement.options[optionIndex] ?? placement;
    /**
     * 这对亲本大概能孵出多少符合要求的蛋（用户 2026-10-30 口径）：
     * 性格概率（学院 100% / 双亲同性格 60% / 单方 30%，不挑性格算 100%）× 性别概率（挑性别 50%）。
     * 50% 绿、30% 黄、15% 红。
     */
    const chance =
      (placement.demand.nature ? active.natureChance : 1) * (placement.demand.gender ? 0.5 : 1);
    const chancePercent = Math.round(chance * 100);
    const chanceTone =
      chance >= 0.5 ? 'text-emerald-700' : chance >= 0.3 ? 'text-amber-600' : 'text-rose-600';
    return (
      <article
        key={rowKey}
        className="rounded-xl border border-slate-200 p-2"
        data-testid="home-demand-row"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <PetAvatar gameId={placement.demand.eggGameId} name={eggNameOf(placement.demand.eggGameId)} size={24} />
              <span className="truncate text-sm font-medium text-slate-900">
                {eggNameOf(placement.demand.eggGameId)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]" data-testid="home-demand-tags">
              {tags.length > 0 ? (
                tags.map((tag) => (
                  <span key={tag.text} className={`rounded px-1 py-0.5 ${tag.className}`}>
                    {tag.text}
                  </span>
                ))
              ) : (
                <span className="rounded bg-slate-100 px-1 py-0.5 text-slate-500">不挑</span>
              )}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">来自「{placement.demand.groupName ?? '收集小组'}」</p>
            <p
              className={`mt-0.5 text-[10px] font-medium ${chanceTone}`}
              data-testid="home-demand-chance"
            >
              约 {chancePercent}% 概率孵出满足需求的蛋
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {placement.options.length > 1 ? (
              <button
                type="button"
                onClick={() => toggleOptions(rowKey)}
                aria-expanded={open}
                title="查看其他候选配对"
                className="flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-bold text-white"
                data-testid="home-demand-badge"
              >
                {placement.options.length}
              </button>
            ) : null}
            <label className="flex min-h-[28px] cursor-pointer items-center gap-1 rounded-lg border border-slate-200 px-1.5 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={Boolean(marks[rowKey])}
                onChange={() => toggleMark(placement)}
                data-testid="home-demand-placed"
              />
              已上窝
            </label>
          </div>
        </div>

        {/* 横向滚动容器会裁剪溢出的内容，顶部留出徽标与描边的位置，否则「已在家园」被切掉。 */}
        <div className="mt-0.5 flex gap-2 overflow-x-auto pb-1.5 pt-2.5">
          <ParentCard
            role="母本"
            parent={active.mother}
            accountLabel={accountLabel}
            inHome={isInHome(active.mother)}
            academyNest={active.tier === 'academy' && active.academyResident === 'mother'}
          />
          <ParentCard
            role="种公"
            parent={active.father}
            accountLabel={accountLabel}
            inHome={isInHome(active.father)}
            academyNest={active.tier === 'academy' && active.academyResident === 'father'}
          />
        </div>

        {open && placement.options.length > 1 ? (
          <div className="mt-1 space-y-0.5 rounded-lg bg-slate-50 p-1.5 text-[10px] text-slate-600" data-testid="home-demand-options">
            {placement.options.map((option, index) => (
              <button
                key={`${option.mother.pet.captureId}-${option.father.pet.captureId}-${index}`}
                type="button"
                onClick={() => {
                  setSelectedOptions((current) => ({ ...current, [rowKey]: index }));
                  setOpenOptions((current) => current.filter((key) => key !== rowKey));
                }}
                className={`block w-full rounded px-1 py-0.5 text-left ${
                  index === optionIndex ? 'bg-emerald-100 font-bold text-emerald-800' : ''
                }`}
                data-testid={`home-demand-option-${index}`}
              >
                {index === optionIndex ? '当前' : `候选 ${index + 1}`}：{option.mother.pet.name} × {option.father.pet.name}
              </button>
            ))}
          </div>
        ) : null}
      </article>
    );
  };

  const renderSkip = (skip: DemandPlacementSkip) => (
    <div
      key={`${skip.demand.groupId}|${skip.demand.demanderAccountId}|${skip.demand.eggGameId}|${skip.demand.nature}|${skip.demand.gender}|${skip.demand.body}|${skip.demand.voice}`}
      className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800"
      data-testid="home-demand-skip"
    >
      <span className="font-medium">{eggNameOf(skip.demand.eggGameId)}</span>
      {skip.demand.nature ? ` · ${skip.demand.nature}` : ''}
      {'：'}
      {skip.message}
    </div>
  );

  const summary = !accountId
    ? '登录后显示接的单'
    : loading && items.length === 0
      ? '正在读取接单…'
      : items.length === 0
        ? '暂无接单'
        : `${withPlacements.length} 个账号 · ${result.placedCount} 单待上窝${
            markedCount > 0 ? `（已标记 ${markedCount}）` : ''
          } · ${petCount} 只精灵`;

  return (
    <section className={`${CARD} space-y-2`} data-testid="home-demand-placements">
      <div className="min-w-0">
        <h2 className={TITLE}>接单上窝</h2>
        <p className={`${HINT} mt-0.5`} data-testid="home-demand-summary">
          {summary}
        </p>
      </div>

      {!accountId ? (
        <p className={`${HINT} rounded-xl bg-slate-50 p-3`} data-testid="home-demand-signed-out">
          开启云同步并加入收集小组后，你在需求中心接的单会汇总到这里。
        </p>
      ) : !loaded ? (
        <p className={HINT}>正在读取本地数据…</p>
      ) : loading && items.length === 0 ? (
        <p className={HINT} data-testid="home-demand-loading">
          正在读取接单…
        </p>
      ) : error && items.length === 0 ? (
        <div className="space-y-1.5 rounded-xl bg-amber-50 p-3" data-testid="home-demand-error">
          <p className="text-xs text-amber-800">{error}</p>
          <button
            type="button"
            onClick={reload}
            className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] text-amber-800"
          >
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className={`${HINT} rounded-xl bg-slate-50 p-3`} data-testid="home-demand-empty">
          你还没有接单。去「小组 → 需求中心 → 我能接的」接一单，这里就会出现要上窝的母本和种公。
        </p>
      ) : (
        <>
          {error ? <p className="text-[11px] text-amber-700">{error}</p> : null}
          {withPlacements.length === 0 ? (
            <p className={`${HINT} rounded-xl bg-slate-50 p-3`} data-testid="home-demand-nothing-placeable">
              已接的单在本机都排不上配对，原因见下方。
            </p>
          ) : (
            <div className="space-y-2">
              {withPlacements.map((account) => {
                const collapsed = collapsedAccounts.includes(account.accountKey);
                return (
                  <div key={account.accountKey} className="space-y-1.5" data-testid="home-demand-account">
                    <button
                      type="button"
                      onClick={() => toggleAccountCollapsed(account.accountKey)}
                      aria-expanded={!collapsed}
                      className="flex w-full items-baseline justify-between rounded-lg px-1 py-0.5 text-left hover:bg-slate-50"
                      data-testid="home-demand-account-toggle"
                    >
                      <span className="text-[11px] font-bold text-slate-700">
                        {labelByAccountKey.get(account.accountKey) ?? account.accountKey}
                        <span className="ml-1 font-normal text-slate-400">· {account.placements.length} 单</span>
                      </span>
                      <span className="text-[10px] text-slate-400">
                        已用 {account.nestsUsed}/{account.nestsTotal} 窝 · {collapsed ? '展开 ˅' : '收起 ˄'}
                      </span>
                    </button>
                    {collapsed ? null : (
                      <div className="space-y-1.5">{account.placements.map(renderRow)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {result.unassigned.length > 0 ? (
            <div className="space-y-1" data-testid="home-demand-unassigned">
              <p className="text-[11px] font-bold text-amber-700">排不上 {result.unassigned.length} 单</p>
              {result.unassigned.map(renderSkip)}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
