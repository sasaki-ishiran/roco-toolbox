import { useState } from 'react';
import type { SpeciesEntry } from '../../domain/types';
import type { WorkflowEgg } from '../../shared/eggWorkflow';
import { canCirculateEgg, type EggParentInfo } from '../../shared/eggMatching';
import { eggWeightOf } from '../../domain/eggWeight';
import { DEMAND_BODIES, DEMAND_VOICES, type DemandBody, type DemandVoice } from '../../shared/collectionGroups';
import { bodyMedalIconByLabel, voiceMedalIconByLabel } from '../../domain/petIcons';
import { BODY_LABELS, VOICE_LABELS } from '../DemandPublishSheet';
import { formatEggObtainedAt, formatEggObtainedAtFull } from './eggTime';
import { ModalSurface } from '../primitives/ModalSurface';
import { SearchField } from '../primitives/SearchField';
import { Button } from '../primitives/Button';
import eggIconUrls from '../../data/eggIconUrls.json';
import { eggGroupNames } from '../../data/catalog';

export function EggArt({ eggGameId, name, size=43 }: { eggGameId:number; name:string; size?:number }) {
  const [failed,setFailed]=useState<number|null>(null);
  const url=(eggIconUrls as Record<string,string>)[eggGameId];
  return url && failed!==eggGameId ? <img src={url} alt={name+'的蛋'} onError={()=>setFailed(eggGameId)} width={size} height={size} className="shrink-0 object-contain"/> : <span role="img" aria-label={name+'的蛋（暂无图片）'} style={{width:size,height:size}} className="inline-flex shrink-0 items-center justify-center text-[10px] text-slate-400">暂无蛋图</span>;
}
export function EggMedals({body,voice}:{body:string;voice:string}) {
  return <span className="inline-flex items-center justify-center gap-0.5">{[[body,bodyMedalIconByLabel(body)],[voice,voiceMedalIconByLabel(voice)]].map(([label,src],i)=>src?<img key={i} src={src} alt={label??''} className="size-4 object-contain"/>:null)}</span>;
}
export function EggStockPanel({ eggs, species, busy, mutate }: { eggs:readonly WorkflowEgg[];species:readonly SpeciesEntry[];busy:boolean;mutate:(action:unknown)=>Promise<unknown> }) {
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('全部');
  const [selected,setSelected]=useState<string|null>(null);
  const [labeling,setLabeling]=useState(false);
  const [nature,setNature]=useState('');
  const [body,setBody]=useState<DemandBody>('');
  const [voice,setVoice]=useState<DemandVoice>('');
  const [error,setError]=useState('');
  const name=(id:number)=>species.find(s=>s.gameId===id)?.name??'未收录精灵';
  const parentCard=(label:'母'|'父',p?:EggParentInfo,index=0)=>p?<div key={`${label}-${index}`} className="min-w-0 rounded-md border border-slate-200 bg-white p-1.5">
    <div className="text-[10px] text-slate-400">{label}本</div>
    <div className="truncate text-xs font-semibold">{p.name||name(p.gameId)}</div>
    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500"><span>{p.nature||'性格未采集'}</span><EggMedals body={p.body} voice={p.voice}/></div>
    <div className={'mt-0.5 text-[10px] '+(p.academy?'text-emerald-700':'text-slate-400')}>{p.nestName||'窝未知'}{p.academy?' · 100% 传性格':''}</div>
  </div>:<div key={`${label}-${index}`} className="flex min-h-14 items-center justify-center rounded-md border border-dashed border-slate-200 text-[11px] text-slate-400">{label}本暂无记录</div>;
  const parentNatures=(e:WorkflowEgg)=>[...new Set([e.parents?.mother?.nature,...(e.parents?.fathers??[]).map(f=>f.nature)].filter((n):n is string=>!!n))];
  const fullness=(e:WorkflowEgg)=>{ if(e.location!=='home'||e.body!=='大块头')return ''; const entry=eggWeightOf(name(e.eggGameId));
    if(!entry||typeof entry.big!=='number')return ''; const total=Math.round(entry.max*1000)-Math.round(entry.big*1000)+1;
    return total>0&&total<1000?`约 1/${total}`:''; };
  const special=(e:WorkflowEgg)=>e.kind==='special'||e.kind==='shiny';
  const status=(e:WorkflowEgg)=>special(e)?'不可交换':e.location==='home'?'在地家园':e.status==='reserved'?'换蛋中':e.listed?'已挂出':'未挂出';
  const visible=eggs.filter(e=>e.status!=='transferred'&&(!query||name(e.eggGameId).includes(query))&&(filter==='全部'||filter===status(e)))
    .sort((a,b)=>Number(special(a))-Number(special(b)));
  const egg=eggs.find(e=>e.id===selected);
  const run=(action:unknown,done?:()=>void)=>{setError('');void mutate(action).then(done).catch(e=>setError(e instanceof Error?e.message:'操作失败'));};
  return <div className="flex flex-col gap-2">
    <SearchField label="搜索蛋名" value={query} onValueChange={setQuery} placeholder="搜索蛋名" className="[&_input]:text-left"/>
    <div className="flex flex-wrap gap-1">{['全部','已挂出','未挂出','换蛋中','不可交换','在地家园'].map(f=><button key={f} type="button" aria-pressed={filter===f} onClick={()=>setFilter(f)} className={'min-h-7 rounded-md px-2 text-[11px] '+(filter===f?'bg-emerald-50 text-emerald-700':'text-slate-500')}>{f}</button>)}</div>
    {visible.length?<div className="grid grid-cols-4 gap-1.5">{visible.map(e=><button data-testid="stock-card" data-egg-id={e.id} key={e.id} type="button" onClick={()=>{setSelected(e.id);setLabeling(false);setError('');}} className="relative flex min-w-0 flex-col items-center overflow-hidden rounded-lg border border-slate-200 bg-white pt-1">
      {e.location==='home'?<span data-testid="stock-home-badge" className="absolute right-1 top-1 rounded bg-amber-50 px-1 py-px text-[9px] font-semibold leading-none text-amber-700">家园</span>:null}
      <EggArt eggGameId={e.eggGameId} name={name(e.eggGameId)}/><strong className="w-full truncate px-0.5 text-[10.5px]">{name(e.eggGameId)}</strong><span className="text-[10px] leading-4 text-slate-500">{e.nature||'待标注'}</span><span className="h-5"><EggMedals body={e.body} voice={e.voice}/></span>{e.location==='home'&&e.lastConfirmedAt?<span data-testid="stock-confirmed" className="text-[10px] leading-4 tabular-nums text-amber-700">{formatEggObtainedAt(new Date(e.lastConfirmedAt).toISOString())}</span>:formatEggObtainedAt(e.obtainedAt)?<span data-testid="stock-time" className="text-[10px] leading-4 tabular-nums text-slate-400">{formatEggObtainedAt(e.obtainedAt)}</span>:null}<span className={'w-full text-[10px] leading-5 '+(special(e)?'bg-slate-100 text-slate-400':e.location==='home'?'bg-amber-50 text-amber-700':e.listed?'bg-emerald-50 text-emerald-700':'bg-slate-50 text-slate-500')}>{status(e)}</span>
    </button>)}</div>:<div className="py-6 text-center text-xs text-slate-500">{eggs.length?'没有符合的蛋':'暂无已采集的蛋'}</div>}
    {egg?<ModalSurface open title="蛋详情" onClose={()=>setSelected(null)} footer={<div className="flex gap-2">{canCirculateEgg(egg)?<><Button variant="secondary" onClick={()=>{setNature(egg.nature);setBody(egg.body==='unknown'?'':egg.body);setVoice(egg.voice==='unknown'?'':egg.voice);setLabeling(v=>!v);}}>标注属性</Button>{egg.location==='home'?<span className="flex-1 self-center text-center text-[11px] text-slate-500">在地家园，收进背包后才能挂出</span>:<Button className="flex-1" busy={busy} onClick={()=>run({type:'list',id:egg.id,listed:!egg.listed})}>{egg.listed?'暂停挂出':'挂出'}</Button>}</>:<span className="text-xs text-slate-500">{status(egg)}</span>}</div>}>
      <div className="flex flex-col gap-2 p-3"><div className="flex items-center gap-2"><EggArt eggGameId={egg.eggGameId} name={name(egg.eggGameId)} size={48}/><div><strong className="text-sm">{name(egg.eggGameId)}的蛋</strong><div className="flex items-center gap-1 text-xs text-slate-500">{egg.nature||(egg.location==='home'?'性格待定':'性格未标注')}<EggMedals body={egg.body} voice={egg.voice}/></div><div className="text-[10px] text-slate-400">{egg.accountName||egg.gameAccountKey}</div></div></div>
      <div className="text-[11px] text-slate-500">{status(egg)}</div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500"><span>获得时间</span><span className="text-right tabular-nums" data-testid="detail-obtained-at">{formatEggObtainedAtFull(egg.obtainedAt)||'采集数据里没有获得时间'}</span></div>
      {egg.location==='home'?<div className="flex items-center justify-between gap-2 text-[11px] text-slate-500"><span>最后确认</span><span className="text-right tabular-nums" data-testid="detail-confirmed-at">{egg.lastConfirmedAt?formatEggObtainedAtFull(new Date(egg.lastConfirmedAt).toISOString()):'暂无'}</span></div>:null}
      <div className="flex items-center justify-between text-[11px] text-slate-500"><span>蛋组</span><span>{species.find(s=>s.gameId===egg.eggGameId)?.eggGroups.map(g=>eggGroupNames[g]??String(g)).join(' / ')||'暂无记录'}</span></div>
      <div className="rounded-lg bg-slate-50 p-2" data-testid="stock-parents"><h4 className="mb-1 text-xs font-semibold">实际父母</h4>{egg.parents?<>
        <p className="mb-1 text-[10px] text-slate-500">按采集时的当前配对与父母属性推算；游戏未确认亲子关系，收进背包后以实物为准。</p>
        <div className="grid grid-cols-2 gap-1.5">{parentCard('母',egg.parents.mother)}{(egg.parents.fathers??[]).map((father,index)=>parentCard('父',father,index))}</div>
        {!egg.nature&&parentNatures(egg).length?<p className="mt-1 text-[10px] text-slate-500">可能性格：{parentNatures(egg).join(' / ')}（各 30%，其余随机）</p>:null}
        {fullness(egg)?<p className="mt-1 text-[10px] text-slate-500">满重 {fullness(egg)}（收进背包后确定）</p>:null}
        {egg.parents.stale?<p className="mt-1 text-[10px] text-amber-700">采集期间有精灵进出，配对可能已经过期。</p>:null}
      </>:<p className="text-[11px] text-slate-400">暂无亲本记录</p>}</div>
      {labeling?<div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-2"><label className="text-xs">性格<input aria-label="蛋性格" value={nature} onChange={e=>setNature(e.target.value)} maxLength={32} className="ml-2 min-h-8 w-28 rounded border px-2 text-left"/></label><div className="flex gap-2"><select aria-label="蛋体型" value={body} onChange={e=>setBody(e.target.value as DemandBody)} className="min-h-8 rounded border bg-white text-xs">{DEMAND_BODIES.map(b=><option key={b} value={b}>{BODY_LABELS[b]}</option>)}</select><select aria-label="蛋声音" value={voice} onChange={e=>setVoice(e.target.value as DemandVoice)} className="min-h-8 rounded border bg-white text-xs">{DEMAND_VOICES.map(v=><option key={v} value={v}>{VOICE_LABELS[v]}</option>)}</select><Button size="sm" busy={busy} onClick={()=>run({type:'label',id:egg.id,nature,body,voice},()=>setLabeling(false))}>保存标注</Button></div></div>:null}
      {error?<p role="alert" className="text-xs text-rose-600">{error}</p>:null}</div>
    </ModalSurface>:null}
  </div>;
}
