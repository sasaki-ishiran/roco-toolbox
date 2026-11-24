import { useState } from 'react';
import type { SpeciesEntry } from '../../domain/types';
import type { WorkflowEgg } from '../../shared/eggWorkflow';
import { useLandscape } from '../useWideLandscape';
import { RailLayout, RailAside, useRailCollapsed } from '../primitives/RailLayout';
import { SearchField } from '../primitives/SearchField';
import { EggCharacterSelect } from './EggCharacterSelect';
import type { EggCharacter } from './eggCharacter';
import { formatEggObtainedAt } from './eggTime';
import { EggArt, EggMedals, formatEggNature, GREEN_NEST_ICON, isSpecialEgg, eggStatus } from './eggArt';
import { EggDetailModal } from './EggDetailModal';
export { EggArt, EggMedals, formatEggNature } from './eggArt';

const EGG_RAIL_KEY='roco.eggStockRailCollapsed';
type StockFilter='全部'|'已标注'|'未标注'|'自产'|'不可交换';

export function EggStockPanel({ eggs, species, busy, mutate, collapsibleFilterRail=false, railBack, character, characters, onCharacterChange }: { eggs:readonly WorkflowEgg[];species:readonly SpeciesEntry[];busy:boolean;mutate:(action:unknown)=>Promise<unknown>;/** 横屏把搜索与条件收进右侧折叠栏（家园页蛋仓屏用） */collapsibleFilterRail?:boolean;/** 横屏标题栏里的返回动作（家园页「返回家园」、换蛋页「返回换蛋」） */railBack?:{label?:string;onClick:()=>void};/** 游戏角色筛选：'' = 全部角色（家园蛋仓屏传入，组内广场不传就不出这一项） */character?:string;characters?:readonly EggCharacter[];onCharacterChange?:(key:string)=>void }) {
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState<StockFilter>('全部');
  const [selected,setSelected]=useState<string|null>(null);
  /** 横屏右侧筛选栏：只有 opt-in 且确实横屏时出现，竖屏保持原来的上下排布。 */
  const landscape=useLandscape();
  const rail= collapsibleFilterRail && landscape;
  const railState=useRailCollapsed(EGG_RAIL_KEY);
  const railCollapsed=railState.collapsed;
  const toggleRail=railState.toggle;
  const name=(id:number)=>species.find(s=>s.gameId===id)?.name??'未收录精灵';
  const annotated=(e:WorkflowEgg)=>!!formatEggNature(e.nature)&&
    ['大块头','小不点','满体重','零体重'].includes(e.body)&&
    ['+100','-100','婉转声','粗嗓门'].includes(e.voice);
  const matchesFilter=(e:WorkflowEgg)=>filter==='不可交换'?isSpecialEgg(e):!isSpecialEgg(e)&&(
    filter==='全部'||filter==='已标注'&&annotated(e)||filter==='未标注'&&!annotated(e)||filter==='自产'&&e.provenance==='self-bred');
  const visible=eggs.filter(e=>e.status!=='transferred'&&(!character||e.gameAccountKey===character)&&(!query||name(e.eggGameId).includes(query))&&matchesFilter(e))
    .sort((a,b)=>Number(b.provenance==='self-bred')-Number(a.provenance==='self-bred')||Number(Boolean(b.greenNest))-Number(Boolean(a.greenNest)));
  const egg=eggs.find(e=>e.id===selected);
  const characterBlock=characters&&characters.length>1&&onCharacterChange
    ? <EggCharacterSelect compact testId="egg-stock-character-rail" value={character??''} characters={characters} onChange={onCharacterChange}/>
    : null;
  const searchBlock=<SearchField label="搜索蛋名" value={query} onValueChange={setQuery} placeholder="搜索蛋名" className="[&_input]:text-left"/>;
  const filterBlock=<div className="flex flex-wrap gap-1" data-testid="egg-stock-filter-chips">{(['全部','已标注','未标注','自产','不可交换'] as const).map(f=><button key={f} type="button" aria-pressed={filter===f} onClick={()=>setFilter(f)} className={'min-h-7 rounded-md px-2 text-[11px] '+(filter===f?'bg-emerald-50 font-semibold text-emerald-700':'text-slate-500')}>{f}</button>)}</div>;
  const cards=visible.length?<div className="egg-stock-grid grid grid-cols-4 gap-1.5" data-testid="egg-stock-grid">{visible.map(e=>{
      const border=e.greenNest?'border-emerald-500':'border-slate-200';
      return <button data-testid="stock-card" data-egg-id={e.id} key={e.id} type="button" onClick={()=>setSelected(e.id)} className={`relative flex min-w-0 flex-col items-center overflow-hidden rounded-lg border bg-white ${border}`}>
        <div data-testid="stock-card-labels" className="flex h-4 w-full shrink-0 items-center justify-between gap-1 px-1">
          <span className="flex min-w-0 items-center gap-0.5">
            {e.greenNest?<img data-testid="stock-green-nest" src={GREEN_NEST_ICON} alt="绿窝" className="size-3.5 shrink-0 object-contain"/>:null}
          </span>
          <span className="flex min-w-0 items-center justify-end">
            {e.provenance==='self-bred'?<span data-testid="stock-self-badge" className="truncate rounded bg-emerald-50 px-1 py-px text-[8.5px] font-semibold leading-none text-emerald-700">自产</span>:null}
          </span>
        </div>
        <div data-testid="stock-card-body" className="flex w-full min-w-0 flex-col items-center px-0.5 pb-0.5">
          <EggArt eggGameId={e.eggGameId} name={name(e.eggGameId)} kind={e.kind} itemConfId={e.itemConfId}/>
          <strong className="w-full truncate px-0.5 text-[10.5px]">{name(e.eggGameId)}</strong>
          <span className="min-h-4 text-[10px] leading-4 text-slate-500">{formatEggNature(e.nature)||'—'}</span>
          <span className="h-5"><EggMedals body={e.body} voice={e.voice}/></span>
          {e.location==='home'&&e.lastConfirmedAt?<span data-testid="stock-confirmed" className="text-[10px] leading-4 tabular-nums text-emerald-700">{formatEggObtainedAt(new Date(e.lastConfirmedAt).toISOString())}</span>:formatEggObtainedAt(e.obtainedAt)?<span data-testid="stock-time" className="text-[10px] leading-4 tabular-nums text-slate-400">{formatEggObtainedAt(e.obtainedAt)}</span>:null}
          {eggStatus(e)?<span className={'mt-0.5 w-full text-center text-[10px] leading-5 '+(isSpecialEgg(e)?'bg-slate-100 text-slate-500':e.provenance==='self-bred'?'bg-emerald-50 text-emerald-700':e.listed?'bg-emerald-50 text-emerald-700':'bg-slate-50 text-slate-500')}>{eggStatus(e)}</span>:null}
        </div>
      </button>;
    })}</div>:<div className="py-6 text-center text-xs text-slate-500">{eggs.length?'没有符合的蛋':'暂无已采集的蛋'}</div>;
  return <div
    className={'flex flex-col gap-2'+(rail?' rail-scope':'')}
    data-rail-collapsed={rail?(railCollapsed?'true':'false'):undefined}
    data-testid={rail?'egg-stock-scope':undefined}
  >
    {rail?<RailLayout
      collapsed={railCollapsed}
      filters={<>{characterBlock}{searchBlock}{filterBlock}</>}
      aside={<RailAside
        title="我的蛋仓"
        collapse={{collapsed:railCollapsed,toggle:toggleRail}}
        back={railBack?{label:railBack.label??'返回家园',onClick:railBack.onClick}:undefined}
        testIds={{aside:'egg-stock-rail',title:'egg-stock-rail-title',back:'egg-stock-rail-back',toggle:'egg-stock-rail-toggle'}}
      />}
      testIds={{main:'egg-stock-main',filters:'egg-stock-filters'}}
    >{cards}</RailLayout>:<>
      {searchBlock}
      {filterBlock}
      {cards}
    </>}
    {egg?<EggDetailModal
      key={egg.id}
      egg={egg}
      species={species}
      busy={busy}
      mutate={mutate}
      onClose={()=>setSelected(null)}
    />:null}
  </div>;
}
