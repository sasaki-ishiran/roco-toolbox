import { useEffect, useMemo, useState } from 'react';
import { markCollectionDemandPlaced } from '../api/collectionGroups';
import { mutateEggMatching } from '../api/eggMatching';
import { EggLineSummary } from './plan/EggLineSummary';
import { MotherGroupsApiError } from '../api/motherGroups';
import { eggGroupNames, species } from '../data/catalog';
import { boxLabel } from '../domain/coverageDetail';
import { genderShareOf } from '../domain/genderRatio';
import {
  buildDemandPlacements,
  studPlacementOptions,
  type DemandPlacement,
  type DemandPlacementDemand,
  type DemandPlacementParent,
  type DemandPlacementSkip,
} from '../domain/demandPlacement';
import { accountKeyOf, type AccountSnapshot } from '../domain/parseBackup';
import { isBreedableGroup } from '../domain/eggs';
import {
  bodyMedalIconByLabel,
  GREEN_NEST_ICON,
  voiceMedalIconByLabel,
  voiceMedalLabel,
} from '../domain/petIcons';
import { speciesDisplayName } from '../domain/speciesName';
import { averageVoiceOf, groupName, PairingPetCard, type PairCardPet } from './NestPlanCard';
import { GenderMark } from './GenderMark';
import {
  placementRowKey,
  readCollapsedAccounts,
  readPlacementChoices,
  readPlacementMarks,
  togglePlacementMark,
  writeCollapsedAccounts,
  writePlacementChoice,
  type PlacementChoices,
  type PlacementMarks,
} from './demandPlacementStore';
import { demandPickKey, pickEggIdOf, readDemandPicks } from './demandPickStore';
import { useNatureOverrides } from './natureOverrideStore';
import { PetAvatar } from './PetAvatar';
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
}

const speciesByGameId = new Map(species.map((entry) => [entry.gameId, entry]));

/** 行键的唯一入口：接单单与「排不上」共用，避免两处拼出不同的键。 */
const rowKeyOfDemand = (
  demand: Pick<
    DemandPlacementDemand,
    'groupId' | 'demanderAccountId' | 'eggGameId' | 'nature' | 'gender' | 'body' | 'voice' | 'claimedAt'
  >,
): string => placementRowKey(demand);

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
  return speciesDisplayName(speciesByGameId.get(eggGameId), '未知的蛋');
};

/** 需求的目标蛋卡（2026-11-19 用户口径）：复用补全计划那张紧凑卡的结构，只放需求里有的字段。 */
function DemandEggCard({
  demand,
  demanderLabel,
}: {
  demand: DemandPlacementDemand;
  demanderLabel: string;
}) {
  const eggGameId = demand.eggGameId;
  const entry = eggGameId > 0 ? speciesByGameId.get(eggGameId) : undefined;
  const groups =
    eggGameId > 0 ? (entry?.eggGroups ?? []).filter(isBreedableGroup) : [-eggGameId];
  const bodyIcon = bodyMedalIconByLabel(demand.body);
  const voiceIcon = voiceMedalIconByLabel(demand.voice);
  const name = eggNameOf(eggGameId);
  const gender = demand.gender === '公' || demand.gender === '母' ? demand.gender : '未知';
  const tone =
    gender === '母'
      ? 'border-pink-200 bg-pink-50'
      : gender === '公'
        ? 'border-sky-200 bg-sky-50'
        : 'border-slate-200 bg-slate-50';
  return (
    <article
      className={`relative h-[86px] min-w-0 overflow-hidden rounded-xl border p-1.5 shadow-sm ${tone}`}
      data-testid="home-demand-target"
    >
      <header className="absolute inset-x-1.5 top-1.5 z-10 grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start gap-0.5 overflow-hidden">
        <div className="flex min-w-0 flex-col items-start gap-px">
          {groups.map((groupId) => (
            <span
              key={groupId}
              className="max-w-full truncate rounded bg-sky-100 px-1 py-px text-[9px] leading-3 text-sky-800"
              title={groupName(groupId)}
            >
              {groupName(groupId)}
            </span>
          ))}
          {bodyIcon || voiceIcon ? (
            <span className="mt-0.5 flex items-center gap-1" data-testid="home-demand-target-medals">
              {bodyIcon ? (
                <img
                  src={bodyIcon}
                  alt={demand.body ?? ''}
                  title={demand.body ?? undefined}
                  className="h-3.5 w-3.5 drop-shadow-sm"
                />
              ) : null}
              {voiceIcon ? (
                <img
                  src={voiceIcon}
                  alt=""
                  title={voiceMedalLabel(demand.voice)}
                  className="h-3.5 w-3.5 drop-shadow-sm"
                />
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col items-end gap-px text-[10px] leading-[13px] text-slate-500">
          <span className="flex min-w-0 items-center justify-end gap-0.5">
            {gender !== '未知' ? <GenderMark gender={gender} /> : null}
            {demand.nature ? (
              <span
                className="inline-flex max-w-full items-center truncate rounded bg-amber-100 px-1 text-[10px] leading-3 font-medium text-amber-900"
                title={demand.nature}
              >
                {demand.nature}
              </span>
            ) : null}
          </span>
        </div>
      </header>
      <div className="absolute left-1/2 top-[6px] flex h-11 w-11 -translate-x-1/2 items-center justify-center">
        {eggGameId > 0 ? (
          <PetAvatar gameId={eggGameId} name={name} size={44} />
        ) : (
          <span
            aria-hidden="true"
            data-testid="home-demand-group-badge"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-[11px] font-semibold text-emerald-700"
          >
            {name.slice(0, 1)}
          </span>
        )}
      </div>
      <h4
        className="absolute inset-x-1 top-[52px] truncate text-center text-[11px] leading-4 font-bold text-slate-900"
        title={name}
      >
        {name}
      </h4>
      <p
        className="absolute inset-x-1 top-[70px] truncate text-center text-[9px] leading-3 text-slate-400"
        data-testid="home-demand-source"
      >
        来自「{demand.groupName ?? '收集小组'}」 · {demanderLabel}
      </p>
    </article>
  );
}

/** 亲本卡：复用补全计划的紧凑精灵卡；接单特有的「进学院小窝 / 已在家园」标记画在外层。 */
function ParentCard({
  parent,
  accountLabel,
  inHome,
  academyNest,
}: {
  parent: DemandPlacementParent;
  accountLabel: string;
  inHome: boolean;
  /** 学院方案时：这一只要放进学院小窝（另一只放普通窝）。 */
  academyNest: boolean;
}) {
  const pet = parent.pet;
  const box = boxLabel(pet);
  const cardPet: PairCardPet = {
    key: pet.captureId ?? '?',
    gameId: pet.gameId,
    name: pet.name.split('_')[0] || pet.name,
    fullName: pet.name,
    gender: pet.gender,
    nature: pet.nature,
    voiceDb: pet.voiceDb,
    medalBody: pet.medalBody,
    heightPercent: pet.heightPercent,
    weightPercent: pet.weightPercent,
    box: `${accountLabel} · ${box || '位置未知'}`,
  };
  return (
    <div className="relative min-w-0">
      {academyNest ? (
        <span className="absolute -top-2 left-1 z-20 inline-flex items-center gap-[2px] rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white">
          <img src={GREEN_NEST_ICON} alt="" className="h-[11px] w-auto" />
          进学院小窝
        </span>
      ) : null}
      <PairingPetCard pet={cardPet} collectedGroupIds={new Set()} testId="home-demand-parent" />
      {/*
        「已在家园」的绿描边单独画一层、盖在卡片上面：卡片本身带 border + shadow-sm，
        无论 ring 还是底衬都会被它压住一部分（2026-10-30 用户两次反馈）。
      */}
      {inHome ? (
        <div
          className="pointer-events-none absolute -inset-0.5 z-10 rounded-xl border-2 border-emerald-300"
          data-testid="home-demand-parent-frame"
        />
      ) : null}
    </div>
  );
}

export function HomeDemandPlacements({ snapshots, labelOf }: HomeDemandPlacementsProps) {
  const { accountId, items, names, loading, error, reload } = useClaimedDemands();
  const [collapsedAccounts, setCollapsedAccounts] = useState<string[]>(() =>
    readCollapsedAccounts(accountId),
  );
  /** 手动挑的候选配对（按行键）。切换即重算整份方案，页头的窝数随之变化。 */
  const [preferredPairs, setPreferredPairs] = useState<PlacementChoices>(() =>
    readPlacementChoices(accountId),
  );
  const [marks, setMarks] = useState<PlacementMarks>(() => readPlacementMarks(accountId));
  const [placeNotice, setPlaceNotice] = useState('');
  const [openOptions, setOpenOptions] = useState<string[]>([]);
  /** 不挑性格的单按「推荐性格」配对时要认用户的按蛋覆盖（2026-11-03）。 */
  const natureOverrides = useNatureOverrides();

  useEffect(() => {
    setMarks(readPlacementMarks(accountId));
    setPreferredPairs(readPlacementChoices(accountId));
    setCollapsedAccounts(readCollapsedAccounts(accountId));
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

  /** 小组页里选的「用哪颗蛋接单」：键与小组页一致（R2-3-M02）。 */
  const picks = useMemo(() => readDemandPicks(), [items]);

  /** 接单明细：小组页 / 家园共用同一份字段，后面算选蛋偏好和整份方案都以它为准。 */
  const baseDemands = useMemo(
    () =>
      items.filter(item=>!(item.placementLine??item.workflowTask?.line)).map((item) => ({
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

  /**
   * 把小组页选的蛋映射成「母本 + 种公」偏好对；本机排不上时记一笔用于提示。
   *
   * 用小组页同一个 `studPlacementOptions` 找候选（2026-11-01 用户反馈）：母本可能是这颗蛋的
   * 进化形态（选「矮脚爬爬」、本机养的是「恶魔红钻」），不能再拿精灵 gameId 直接和蛋 id 比，
   * 也必须用同一份候选列表——否则小组页能选、家园却匹配不上，还会误报「排不上」。
   */
  const pickPreferences = useMemo(() => {
    const pairs: PlacementChoices = {};
    const fallback: Record<string, true> = {};
    for (const demand of baseDemands) {
      const pick = picks[demandPickKey(demand.groupId, demand)];
      if (pick == null) continue;
      const key = rowKeyOfDemand(demand);
      const alongside = baseDemands.filter((item) => item !== demand);
      const options = studPlacementOptions(snapshots, demand, species, alongside);
      // 小组页选的是「蛋」或「某一对亲本」：先按亲本精确匹配，再退回按蛋匹配
      const option =
        (typeof pick === 'object'
          ? options.find(
              (item) =>
                item.eggGameId === pick.eggGameId &&
                (!pick.motherCaptureId ||
                  item.motherPet.pet.captureId === pick.motherCaptureId) &&
                (!pick.fatherCaptureId ||
                  item.malePet.pet.captureId === pick.fatherCaptureId),
            )
          : undefined) ?? options.find((item) => item.eggGameId === pickEggIdOf(pick));
      const motherCaptureId = option?.motherPet.pet.captureId;
      const fatherCaptureId = option?.malePet.pet.captureId;
      if (!motherCaptureId || !fatherCaptureId) {
        fallback[key] = true;
        continue;
      }
      pairs[key] = { motherCaptureId, fatherCaptureId };
    }
    return { pairs, fallback };
  }, [baseDemands, picks, snapshots]);

  const demands = useMemo(
    () =>
      items.filter(item=>!(item.placementLine??item.workflowTask?.line)).map((item) => {
        const key = rowKeyOfDemand({ ...item, claimedAt: item.updatedAt });
        return {
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
          // 家园页手动挑的优先；没挑过就沿用小组页选的那颗蛋
          preferredPair: preferredPairs[key] ?? pickPreferences.pairs[key] ?? null,
        };
      }),
    [items, preferredPairs, pickPreferences],
  );

  const result = useMemo(
    () => buildDemandPlacements({ demands, snapshots, species, natureOverrides }),
    [demands, snapshots, natureOverrides],
  );

  const placedRows = useMemo(
    () => result.accounts.flatMap((account) => account.placements),
    [result],
  );

  const rowKeyOf = (placement: DemandPlacement): string => rowKeyOfDemand(placement.demand);

  const markedCount = placedRows.filter((placement) => marks[rowKeyOf(placement)]).length;
  // 有实例号的按实例号去重；没有时用对象本身兜底，同名精灵不会被算成一只（R2-2-L06）
  const petCount = new Set(
    placedRows.flatMap((placement) => [
      placement.mother.pet.captureId ?? placement.mother.pet,
      placement.father.pet.captureId ?? placement.father.pet,
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
    if (accountId) writeCollapsedAccounts(accountId, next);
  };

  /**
   * 勾「已上窝」：先记本机，同时把状态同步到服务端——
   * 只有服务端也有 placedAt，发布方才能走到第 4 步「待我确认」。
   * 旧服务端没有这个接口（404）时退回本机勾选，历史结单 / 归档不受影响。
   */
  const toggleMark = (placement: DemandPlacement) => {
    if (!accountId) return;
    const rowKey = rowKeyOf(placement);
    const next = !marks[rowKey];
    setMarks(togglePlacementMark(accountId, rowKey, next));
    if (!next) return;
    const demand = placement.demand;
    setPlaceNotice('');
    const workflow=items.find(item=>item.workflowTaskId&&item.groupId===demand.groupId&&item.demanderAccountId===demand.demanderAccountId&&item.eggGameId===demand.eggGameId&&item.createdAt===demand.claimedAt);
    if(workflow?.workflowTaskId&&workflow.workflowVersion!=null){
      void mutateEggMatching(workflow.groupId,workflow.workflowVersion,{type:'place',id:workflow.workflowTaskId}).then(()=>reload()).catch((failure:unknown)=>{
        setMarks(togglePlacementMark(accountId,rowKey,false));
        setPlaceNotice(failure instanceof Error?failure.message:'上窝同步失败');
        reload();
      });
      return;
    }
    void markCollectionDemandPlaced(demand.groupId, {
      demanderAccountId: demand.demanderAccountId,
      eggGameId: demand.eggGameId,
      nature: demand.nature,
      gender: demand.gender,
      body: demand.body,
      voice: demand.voice,
      accountKey: placement.accountKey ?? null,
    }).catch((failure: unknown) => {
      if (failure instanceof MotherGroupsApiError && failure.status === 404) {
        setPlaceNotice('当前服务端还不支持「已上窝」，已先记在本机');
        return;
      }
      setPlaceNotice(
        failure instanceof Error && failure.message
          ? failure.message
          : '「已上窝」同步失败，请稍后重试',
      );
    });
  };

  const renderRow = (placement: DemandPlacement) => {
    const rowKey = rowKeyOf(placement);
    const accountLabel = labelByAccountKey.get(placement.accountKey) ?? placement.accountKey;
    const open = openOptions.includes(rowKey);
    const preferred = preferredPairs[rowKey] ?? null;
    // 手动挑过的配对会被分配入口排到第一（方案已按它重算），所以这里始终看第一组。
    const active = placement.options[0] ?? placement;
    const prefHonored =
      !preferred ||
      (active.mother.pet.captureId === preferred.motherCaptureId &&
        active.father.pet.captureId === preferred.fatherCaptureId);
    // 概率头（2026-11-19 用户口径）：性格概率 × 性别比例，写法对齐补全计划卡头。
    const genderChance =
      placement.demand.gender === '公' || placement.demand.gender === '母'
        ? genderShareOf(speciesByGameId.get(active.mother.pet.gameId), placement.demand.gender)
        : 1;
    const chance = (placement.demand.nature ? active.natureChance : 1) * genderChance;
    const chancePercent = Math.round(chance * 100);
    const demandVoice = averageVoiceOf([
      { gender: active.mother.pet.gender, voiceDb: active.mother.pet.voiceDb },
      { gender: active.father.pet.gender, voiceDb: active.father.pet.voiceDb },
    ]);
    const demanderLabel = names.get(placement.demand.demanderAccountId) ?? '已退出成员';
    const motherInHome = isInHome(active.mother);
    const fatherInHome = isInHome(active.father);
    return (
      <article
        key={rowKey}
        className="rounded-xl border border-slate-200 p-2"
        data-testid="home-demand-row"
      >
        <div className="mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
          <DemandEggCard demand={placement.demand} demanderLabel={demanderLabel} />
          <div className="flex flex-col items-end justify-center gap-1.5">
            {placement.options.length > 1 ? (
              <button
                type="button"
                onClick={() => toggleOptions(rowKey)}
                aria-expanded={open}
                title="还有其他配对，点这里换一对母本 × 种公"
                className="inline-flex h-6 items-center gap-0.5 rounded-full bg-slate-900 px-2 text-[10px] font-bold text-white"
                data-testid="home-demand-badge"
              >
                换配对 {placement.options.length}
                <span
                  aria-hidden="true"
                  className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}
                >
                  ▾
                </span>
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
          <div className="flex flex-wrap items-center gap-1" data-testid="home-demand-chance">
            {placement.demand.nature || placement.demand.gender ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-amber-700">
                {chancePercent}%{placement.demand.nature}
                {placement.demand.gender ? <GenderMark gender={placement.demand.gender} /> : null}
              </span>
            ) : null}
            {demandVoice !== null ? (
              <span className="text-[10px] leading-none text-slate-500">{demandVoice}dB</span>
            ) : null}
          </div>
          <span aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1">
            <ParentCard
              parent={active.mother}
              accountLabel={accountLabel}
              inHome={motherInHome}
              academyNest={active.tier === 'academy' && active.academyResident === 'mother'}
            />
            {motherInHome ? (
              <span
                className="mx-auto rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700"
                data-testid="home-demand-inhome"
              >
                已在家园
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <ParentCard
              parent={active.father}
              accountLabel={accountLabel}
              inHome={fatherInHome}
              academyNest={active.tier === 'academy' && active.academyResident === 'father'}
            />
            {fatherInHome ? (
              <span
                className="mx-auto rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700"
                data-testid="home-demand-inhome"
              >
                已在家园
              </span>
            ) : null}
          </div>
        </div>

        {preferred && !prefHonored ? (
          <p className="mt-1 text-[10px] text-amber-700" data-testid="home-demand-pref-fallback">
            你选的这组这轮排不上（窝位或占用变了），已按第一组上窝。
          </p>
        ) : null}
        {!preferred && pickPreferences.fallback[rowKey] ? (
          <p className="mt-1 text-[10px] text-amber-700" data-testid="home-demand-pick-fallback">
            你在小组页选的那颗蛋本机排不上（窝位或占用变了），已按默认配对。
          </p>
        ) : null}

        {open && placement.options.length > 1 ? (
          <div className="mt-1 space-y-1 rounded-lg bg-slate-50 p-1.5 text-[11px] text-slate-600" data-testid="home-demand-options">
            {placement.options.map((option, index) => {
              const current = index === 0;
              const motherId = option.mother.pet.captureId;
              const fatherId = option.father.pet.captureId;
              const choose = () => {
                if (!motherId || !fatherId) return;
                // 换候选 = 换整份方案的偏好，分配入口会按这一对重算（页头窝数一起变）
                setPreferredPairs((currentPicks) => ({
                  ...currentPicks,
                  [rowKey]: { motherCaptureId: motherId, fatherCaptureId: fatherId },
                }));
                if (accountId) {
                  writePlacementChoice(accountId, rowKey, {
                    motherCaptureId: motherId,
                    fatherCaptureId: fatherId,
                  });
                }
                setOpenOptions((currentOpen) => currentOpen.filter((key) => key !== rowKey));
              };
              return (
                <div
                  key={`${motherId}-${fatherId}-${index}`}
                  className={`flex min-h-[34px] items-center justify-between gap-2 rounded-md px-2 py-1 ${
                    current ? 'bg-emerald-100 font-bold text-emerald-800' : 'bg-white'
                  }`}
                  data-testid={`home-demand-option-${index}`}
                >
                  <span className="min-w-0 truncate">
                    {current ? '当前：' : ''}
                    {option.mother.pet.name} × {option.father.pet.name}
                  </span>
                  {current ? (
                    <span className="shrink-0 text-[10px] font-medium text-emerald-700">正在用</span>
                  ) : (
                    <button
                      type="button"
                      onClick={choose}
                      className="min-h-[26px] shrink-0 rounded-md border border-emerald-500 bg-white px-2 text-[10px] font-medium text-emerald-700"
                      data-testid={`home-demand-use-option-${index}`}
                    >
                      用这对
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </article>
    );
  };

  const renderSkip = (skip: DemandPlacementSkip) => (
    <div
      key={placementRowKey({
        groupId: skip.demand.groupId,
        demanderAccountId: skip.demand.demanderAccountId,
        eggGameId: skip.demand.eggGameId,
        nature: skip.demand.nature,
        gender: skip.demand.gender,
        body: skip.demand.body,
        voice: skip.demand.voice,
        claimedAt: skip.demand.claimedAt,
      })}
      className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800"
      data-testid="home-demand-skip"
    >
      <span className="font-medium">{eggNameOf(skip.demand.eggGameId)}</span>
      {skip.demand.nature ? ` · ${skip.demand.nature}` : ''}
      {'：'}
      {skip.message}
    </div>
  );

  const fixedTasks=items.filter(item=>(item.placementLine??item.workflowTask?.line));
  const taskAccounts=new Set([...withPlacements.map(a=>a.accountKey),...fixedTasks.map(i=>(i.placementLine??i.workflowTask!.line!).gameAccountKey)]);
  const taskParents=new Set([...placedRows.flatMap(p=>[p.mother,p.father].map(parent=>JSON.stringify([parent.accountKey,parent.pet.captureId??parent.pet]))),...fixedTasks.flatMap(i=>[(i.placementLine??i.workflowTask!.line!).motherId,(i.placementLine??i.workflowTask!.line!).fatherId].map(id=>JSON.stringify([(i.placementLine??i.workflowTask!.line!).gameAccountKey,id])))]);
  const totalMarked=markedCount+fixedTasks.filter(i=>i.placedAt!=null).length;
  const summary = !accountId
    ? '登录后显示接的单'
    : loading && items.length === 0
      ? '正在读取接单…'
      : items.length === 0
        ? '暂无接单'
        : `${taskAccounts.size} 个账号 · ${result.placedCount+fixedTasks.length} 单待上窝${
            totalMarked > 0 ? `（已标记 ${totalMarked}）` : ''
          } · ${fixedTasks.length?taskParents.size:petCount} 只精灵`;

  /** 读取失败的统一入口：全部失败与「有一个组失败」都给重试，不再只剩一行黄字。 */
  const renderError = () => (
    <div className="space-y-1.5 rounded-xl bg-amber-50 p-3" data-testid="home-demand-error">
      <p className="text-xs text-amber-800">{error}</p>
      {items.length > 0 ? (
        <p className="text-[11px] text-amber-700">下面是上一次读到的单，重试可补齐。</p>
      ) : null}
      <button
        type="button"
        onClick={reload}
        className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] text-amber-800"
        data-testid="home-demand-retry"
      >
        重试
      </button>
    </div>
  );

  return (
    <section
      className={`${CARD} space-y-2`}
      data-testid="home-demand-placements"
      data-tour="home-placement"
    >
      <div className="min-w-0">
        <h2 className={TITLE}>接单上窝</h2>
        <p className={`${HINT} mt-0.5`} data-testid="home-demand-summary">
          {summary}
        </p>
        <p className={`${HINT} mt-0.5 text-slate-400`} data-testid="home-demand-scope">
          按全部 {snapshots.length} 个账号计算。
        </p>
      </div>

      {!accountId ? (
        <p className={`${HINT} rounded-xl bg-slate-50 p-3`} data-testid="home-demand-signed-out">
          开启云同步后查看现孵任务。
        </p>
      ) : loading && items.length === 0 ? (
        <p className={HINT} data-testid="home-demand-loading">
          正在读取接单…
        </p>
      ) : items.length === 0 ? (
        error ? (
          renderError()
        ) : (
          <p className={`${HINT} rounded-xl bg-slate-50 p-3`} data-testid="home-demand-empty">
            暂无现孵任务。
          </p>
        )
      ) : (
        <>
          {error ? renderError() : null}
          {placeNotice ? (
            <p className={`${HINT} rounded-xl bg-amber-50 p-2 text-amber-800`} data-testid="home-demand-place-notice">
              {placeNotice}
            </p>
          ) : null}
          {fixedTasks.map(item=><article key={item.workflowTaskId} className="space-y-1 rounded-xl border border-slate-200 p-2"><div className="flex items-center justify-between gap-2"><strong className="text-xs">{eggNameOf(item.eggGameId)}</strong><label className="flex min-h-7 items-center gap-1 text-[11px]"><input data-testid="home-demand-placed" type="checkbox" checked={!!item.placedAt} disabled={!!item.placedAt} onChange={()=>{setPlaceNotice('');void mutateEggMatching(item.groupId,item.workflowVersion!,{type:'place',id:item.workflowTaskId}).then(()=>reload()).catch(e=>{setPlaceNotice(e instanceof Error?e.message:'上窝同步失败');reload();});}}/>已上窝</label></div><EggLineSummary line={item.placementLine??item.workflowTask!.line!} snapshots={snapshots}/></article>)}
          {withPlacements.length === 0 && fixedTasks.length===0 ? (
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
