import { useEffect, useRef, useState } from 'react';
import type { SpeciesEntry } from '../../domain/types';
import type { WorkflowEgg } from '../../shared/eggWorkflow';
import { canCirculateEgg, type EggParentInfo } from '../../shared/eggMatching';
import { eggWeightOf } from '../../domain/eggWeight';
import { DEMAND_NATURE_MAX, type DemandBody, type DemandVoice } from '../../shared/collectionGroups';
import { BODY_LABELS, PICKABLE_BODIES, PICKABLE_VOICES, VOICE_LABELS } from '../DemandPublishSheet';
import { formatEggObtainedAtFull } from './eggTime';
import { ModalSurface } from '../primitives/ModalSurface';
import { PairingPetCard, type PairCardPet } from '../NestPlanCard';
import { useLandscape } from '../useWideLandscape';
import './eggDetail.css';
import { Button } from '../primitives/Button';
import { allNatureNames, eggGroupNames, targetNatureNames } from '../../data/catalog';
import {
  EggArt,
  EggMedals,
  formatEggNature,
  eggNatureNames,
  formatEggHeight,
  formatEggWeight,
  GREEN_NEST_ICON,
  eggStatus,
} from './eggArt';

export interface EggDetailModalProps {
  egg: WorkflowEgg;
  species: readonly SpeciesEntry[];
  busy: boolean;
  mutate: (action: unknown) => Promise<unknown>;
  onClose: () => void;
}

/**
 * 蛋详情（2026-11-22 重写，从 EggStockPanel 抽出）：
 * 横屏两栏（概览 + 数值 / 实际父母），竖屏单列；标注编辑器点「标注此蛋」展开。
 * 实际父母复用配窝精灵卡，固定卡宽、auto-fill，不随栏宽拉伸。
 */
export function EggDetailModal({ egg, species, busy, mutate, onClose }: EggDetailModalProps) {
  const landscape = useLandscape();
  const [labeling, setLabeling] = useState(false);
  const [natures, setNatures] = useState<string[]>([]);
  const [moreNatures, setMoreNatures] = useState(false);
  const [body, setBody] = useState<DemandBody>('大块头');
  const [voice, setVoice] = useState<DemandVoice>('婉转声');
  const [greenNest, setGreenNest] = useState(false);
  const [error, setError] = useState('');
  const labelEditorRef = useRef<HTMLDivElement>(null);

  const name = (id: number) => species.find((s) => s.gameId === id)?.name ?? '未收录精灵';
  const NO_GROUPS = new Set<number>();
  const pairCardOf = (p: EggParentInfo, gender: '母' | '公'): PairCardPet => ({
    key: `${gender}-${p.id}`,
    gameId: p.gameId,
    name: p.name || name(p.gameId),
    gender,
    nature: p.nature,
    medalBody: p.body === '满体重' ? '大块头' : p.body === '零体重' ? '小不点' : p.body,
    voiceDb: p.voice === '+100' ? 100 : p.voice === '-100' ? -100 : p.voice === '婉转声' ? 96 : p.voice === '粗嗓门' ? -96 : null,
    weightPercent: p.body === '满体重' ? 100 : p.body === '零体重' ? 0 : null,
    // 学院小窝 100% 传性格：文字补回卡底，不能只靠绿框暗示
    box: `${p.nestName || '窝未知'}${p.academy ? ' · 100%性格' : ''}`,
  });
  const parentNatures = (e: WorkflowEgg) => [...new Set([e.parents?.mother?.nature, ...(e.parents?.fathers ?? []).map((f) => f.nature)].filter((n): n is string => !!n))];
  const fullness = (e: WorkflowEgg) => {
    if (e.location !== 'home' || e.body !== '大块头') return '';
    const entry = eggWeightOf(name(e.eggGameId));
    if (!entry || typeof entry.big !== 'number') return '';
    const total = Math.round(entry.max * 1000) - Math.round(entry.big * 1000) + 1;
    return total > 0 && total < 1000 ? `约 1/${total}` : '';
  };
  const selectedExtraNatures = natures.filter((value) => !targetNatureNames.includes(value));
  const visibleNatures = moreNatures ? allNatureNames : targetNatureNames;
  const moreNatureCount = allNatureNames.length - targetNatureNames.length;
  const toggleNature = (value: string) => setNatures((current) => current.includes(value)
    ? current.filter((item) => item !== value)
    : current.length >= DEMAND_NATURE_MAX ? current : [...current, value]);
  const optionRow = <T extends string>(
    label: string,
    values: readonly T[],
    current: T,
    labels: Record<T, string>,
    onPick: (value: T) => void,
    testPrefix: string,
  ) => <div className="flex flex-wrap items-center gap-0.5">
    <span className="w-7 shrink-0 text-[9px] text-slate-400">{label}</span>
    {values.map((value) => <button key={`${testPrefix}:${value}`} type="button" aria-pressed={current === value} onClick={() => onPick(value)} data-testid={`${testPrefix}-${value}`} className={`min-h-[26px] rounded border px-1 text-[10px] ${current === value ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}`}>{labels[value]}</button>)}
  </div>;
  useEffect(() => {
    if (labeling) requestAnimationFrame(() => labelEditorRef.current?.scrollIntoView({ block: 'nearest' }));
  }, [labeling]);
  const run = (action: unknown, done?: () => void) => {
    setError('');
    void mutate(action).then(done).catch((e) => setError(e instanceof Error ? e.message : '操作失败'));
  };
  const beginLabeling = (target: WorkflowEgg) => {
    setNatures(eggNatureNames(target.nature));
    setMoreNatures(false);
    setBody(target.body === 'unknown' || !target.body ? '大块头' : target.body);
    setVoice(target.voice === 'unknown' || !target.voice ? '婉转声' : target.voice);
    setGreenNest(target.greenNest === true);
    setLabeling(true);
  };
  const labelValues = (target: WorkflowEgg) => labeling
    ? { nature: natures.join(' / '), body, voice, greenNest }
    : {
        nature: formatEggNature(target.nature),
        body: (target.body === 'unknown' || !target.body ? '大块头' : target.body),
        voice: (target.voice === 'unknown' || !target.voice ? '婉转声' : target.voice),
        greenNest: target.greenNest === true,
      };

  return <ModalSurface open title="蛋详情" size="xl" onClose={onClose} footer={<div className="w-full">{canCirculateEgg(egg) ? <>
    <div className="grid grid-cols-3 gap-2">
      <Button variant="secondary" size="sm" busy={busy} onClick={() => labeling ? run({ type: 'label', id: egg.id, ...labelValues(egg) }, () => setLabeling(false)) : beginLabeling(egg)}>标注此蛋</Button>
      <Button variant="secondary" size="sm" busy={busy} onClick={() => run({ type: 'label-many', eggGameId: egg.eggGameId, ...labelValues(egg) }, () => setLabeling(false))}>标注所有同类蛋</Button>
      <Button size="sm" busy={busy} disabled={egg.location === 'home'} title={egg.location === 'home' ? '收进背包后才能挂出' : undefined} onClick={() => run({ type: 'list', id: egg.id, listed: !egg.listed })}>{egg.listed ? '取消挂出' : '挂出'}</Button>
    </div>{egg.location === 'home' ? <p className="mt-1 text-center text-[11px] text-slate-500">在地家园，收进背包后才能挂出</p> : null}
  </> : <span className="text-sm text-slate-500">{eggStatus(egg)}</span>}</div>}>
    <div className={`grid gap-1.5 p-2.5 text-sm ${landscape ? 'grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-start' : 'grid-cols-1'}`}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {/* 概览压成三行：名称 / 性格+奖牌 / 账号+来源 */}
        <div className="flex items-center gap-2">
          <EggArt eggGameId={egg.eggGameId} name={name(egg.eggGameId)} size={40} kind={egg.kind} itemConfId={egg.itemConfId}/>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
              <strong className="truncate text-sm leading-5">{name(egg.eggGameId)}的蛋</strong>
              {egg.greenNest ? <img src={GREEN_NEST_ICON} alt="绿窝" className="size-3.5 shrink-0 object-contain"/> : null}
              {eggStatus(egg) ? <span className="ml-auto shrink-0 rounded bg-slate-100 px-1 text-[9px] leading-4 text-slate-500">{eggStatus(egg)}</span> : null}
            </div>
            <div className="flex min-w-0 items-center gap-1 text-[11px] leading-4 text-slate-600">
              <span className="truncate">{formatEggNature(egg.nature) || '性格未标注'}</span>
              <EggMedals body={egg.body} voice={egg.voice}/>
            </div>
            <div className="truncate text-[10px] leading-4 text-slate-400">
              {egg.accountName || egg.gameAccountKey} · {egg.provenance === 'self-bred' ? '自产' : egg.provenance === 'external' ? '外部' : '来源未知'}
            </div>
          </div>
        </div>

        {/* 关键数值；横屏左栏两列，竖屏三列；时间保留完整值，长文本截断但悬停可看全 */}
        <div className={`grid ${landscape ? 'grid-cols-2' : 'grid-cols-3'} gap-x-2 gap-y-1 rounded-lg bg-slate-50 px-2 py-1.5`}>
          <div className="col-span-2 min-w-0">
            <span className="block text-[9px] leading-3 text-slate-400">获得时间</span>
            <span className="block truncate text-[11px] leading-4 tabular-nums text-slate-700" title={formatEggObtainedAtFull(egg.obtainedAt) || '采集数据里没有获得时间'} data-testid="detail-obtained-at">{formatEggObtainedAtFull(egg.obtainedAt) || '采集数据里没有获得时间'}</span>
          </div>
          {egg.location === 'home' ? <div className="min-w-0">
            <span className="block text-[9px] leading-3 text-slate-400">最后确认</span>
            <span className="block truncate text-[11px] leading-4 tabular-nums text-slate-700" title={egg.lastConfirmedAt ? formatEggObtainedAtFull(new Date(egg.lastConfirmedAt).toISOString()) : '暂无'} data-testid="detail-confirmed-at">{egg.lastConfirmedAt ? formatEggObtainedAtFull(new Date(egg.lastConfirmedAt).toISOString()) : '暂无'}</span>
          </div> : null}
          <div className="min-w-0">
            <span className="block text-[9px] leading-3 text-slate-400">蛋高</span>
            <span className="block truncate text-[11px] leading-4 tabular-nums text-slate-700" data-testid="detail-egg-height">{formatEggHeight(egg.heightCm)}</span>
          </div>
          <div className="min-w-0">
            <span className="block text-[9px] leading-3 text-slate-400">蛋重</span>
            <span className="block truncate text-[11px] leading-4 tabular-nums text-slate-700" data-testid="detail-egg-weight">{formatEggWeight(egg.weightGrams)}</span>
          </div>
          <div className="min-w-0">
            <span className="block text-[9px] leading-3 text-slate-400">蛋组</span>
            <span className="block truncate text-[11px] leading-4 text-slate-700" title={species.find((s) => s.gameId === egg.eggGameId)?.eggGroups.map((g) => eggGroupNames[g] ?? String(g)).join(' / ') || '暂无记录'}>{species.find((s) => s.gameId === egg.eggGameId)?.eggGroups.map((g) => eggGroupNames[g] ?? String(g)).join(' / ') || '暂无记录'}</span>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        {/* 亲本固定卡宽，不随栏宽拉伸；可能性格 / 满重只占一行小字 */}
        <div className="rounded-lg bg-slate-50 px-2 py-1.5" data-testid="stock-parents">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h4 className="text-[11px] font-semibold leading-4 text-slate-700">实际父母</h4>
            {egg.parents ? <span className="shrink-0 text-[9px] text-slate-400">{egg.parents.stale ? '采集期间有精灵进出，配对可能已经过期' : '按采集时配对推算'}</span> : null}
          </div>
          {egg.parents ? <>
            <div className="egg-parent-grid">
              {[egg.parents.mother, ...(egg.parents.fathers ?? [])].filter((parent): parent is EggParentInfo => Boolean(parent))
                .map((parent) => <PairingPetCard key={pairCardOf(parent, parent === egg.parents?.mother ? '母' : '公').key} pet={pairCardOf(parent, parent === egg.parents?.mother ? '母' : '公')} collectedGroupIds={NO_GROUPS} academy={parent.academy} hideMeasurements />)}
            </div>
            {!egg.nature && parentNatures(egg).length ? <p className="mt-1 text-[10px] leading-4 text-slate-500">可能性格：{parentNatures(egg).join(' / ')}（各 30%，其余随机）</p> : null}
            {fullness(egg) ? <p className="mt-0.5 text-[10px] leading-4 text-slate-500">满重 {fullness(egg)}（收进背包后确定）</p> : null}
          </> : <p className="text-[10px] text-slate-400">暂无亲本记录</p>}
        </div>
      </div>

      {/* 原来父母卡下面那句说明不能省：游戏未确认亲子关系，以实物为准 */}
      <p className={`text-[9px] leading-3 text-slate-400 ${landscape ? 'col-span-2' : ''}`}>按采集时的当前配对与父母属性推算；游戏未确认亲子关系，收进背包后以实物为准。</p>

      {/* 标注编辑器：四列性格、两行体型 / 声音，尽量少占高度 */}
      {labeling ? <div ref={labelEditorRef} data-testid="egg-label-editor" className={`flex flex-col gap-1 rounded-lg bg-slate-50 p-2 ${landscape ? 'col-span-2' : ''}`}>
        <div className="flex items-center justify-between text-[10px] text-slate-500"><span>性格</span><span>最多选 {DEMAND_NATURE_MAX} 个</span></div>
        <div className="grid grid-cols-4 gap-0.5" data-testid="egg-label-natures">
          {visibleNatures.map((value) => <button key={value} type="button" aria-pressed={natures.includes(value)} onClick={() => toggleNature(value)} className={`min-h-[26px] rounded border px-0.5 text-[10px] leading-tight ${natures.includes(value) ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}`}>{value}</button>)}
          {moreNatureCount > 0 ? <button type="button" aria-label={`更多 +${moreNatureCount}`} aria-pressed={selectedExtraNatures.length > 0 || moreNatures} aria-expanded={moreNatures} onClick={() => setMoreNatures((value) => !value)} className={`min-h-[26px] rounded border border-dashed px-0.5 text-[10px] ${selectedExtraNatures.length > 0 || moreNatures ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-700' : 'border-slate-300 bg-white text-slate-500'}`}>{moreNatures ? `收起 +${moreNatureCount} ▴` : `更多 +${moreNatureCount}`}</button> : null}
        </div>
        <div className="flex flex-col gap-0.5">
          {optionRow('体型', PICKABLE_BODIES, body, BODY_LABELS, setBody, 'egg-label-body')}
          {optionRow('声音', PICKABLE_VOICES, voice, VOICE_LABELS, setVoice, 'egg-label-voice')}
        </div>
        <label className="flex min-h-[24px] items-center gap-1.5 text-[11px] text-slate-500"><input type="checkbox" checked={greenNest} onChange={(e) => setGreenNest(e.target.checked)} className="size-3.5 accent-emerald-600"/>绿窝蛋</label>
      </div> : null}
      {error ? <p role="alert" className={`text-xs text-rose-600 ${landscape ? 'col-span-2' : ''}`}>{error}</p> : null}
    </div>
  </ModalSurface>;
}
