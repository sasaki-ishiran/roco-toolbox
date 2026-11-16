import { useMemo, useState } from 'react';
import { allNatureNames, targetNaturePool } from '../../data/catalog';
import type { EggDemand } from '../../shared/eggMatching';
import { DEMAND_BODIES, DEMAND_VOICES, DEMAND_NATURE_MAX, type DemandBody, type DemandVoice } from '../../shared/collectionGroups';
import type { SpeciesEntry } from '../../domain/types';
import { isBreedableGroup } from '../../domain/eggs';
import { PetAvatar } from '../PetAvatar';
import { ModalSurface } from '../primitives/ModalSurface';
import { SearchField } from '../primitives/SearchField';
import { Button } from '../primitives/Button';
import { BODY_LABELS, VOICE_LABELS } from '../DemandPublishSheet';
import { GREEN_NEST_ICON } from '../../domain/petIcons';

export function EggDemandEditor({ demand, species, busy, onSave, onClose }: {
  demand: EggDemand | null; species: readonly SpeciesEntry[]; busy: boolean;
  onSave: (drafts: Pick<EggDemand, 'id' | 'eggGameId' | 'natures' | 'body' | 'voice' | 'quantity' | 'greenNest'>[]) => Promise<void>; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [drafts,setDrafts]=useState<Record<number,{id:string;natures:string[];quantity:number}>>(demand?{[demand.eggGameId]:{id:demand.id,natures:[...demand.natures],quantity:demand.quantity}}:{});
  const [body, setBody] = useState<DemandBody>(demand?.body ?? '大块头');
  const [voice, setVoice] = useState<DemandVoice>(demand?.voice ?? '婉转声');
  const [green,setGreen]=useState(demand?.greenNest??false);
  const [limit,setLimit]=useState(12);
  const [error, setError] = useState('');
  const options = useMemo(() => species.filter(s => demand?s.gameId===demand.eggGameId:s.gameId === s.eggGameId && s.eggGroups.some(isBreedableGroup) &&
    (!query || (s.name + s.number + (s.officialName ?? '')).includes(query))), [species, query,demand]);
  const selected=Object.entries(drafts).filter(([id,d])=>d.natures.length>0 || Number(id)===demand?.eggGameId);
  const toggle=(id:number,nature:string)=>setDrafts(current=>{const old=current[id]??{id:crypto.randomUUID(),natures:[],quantity:1};return {...current,[id]:{...old,natures:old.natures.includes(nature)?old.natures.filter(n=>n!==nature):old.natures.length<DEMAND_NATURE_MAX?[...old.natures,nature]:old.natures}};});
  return <ModalSurface open title={demand ? '调整需求' : '添加想收'} onClose={onClose} size="lg" footer={
    <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>取消</Button><Button className="flex-1" busy={busy} disabled={!selected.length||selected.length>50||selected.some(([,d])=>!Number.isInteger(d.quantity)||d.quantity<1||d.quantity>99)}
      onClick={() => { setError(''); void onSave(selected.map(([egg,d])=>({...d,eggGameId:Number(egg),body,voice,greenNest:green}))).catch(e => setError(e instanceof Error ? e.message : '发布失败')); }}>
      {demand ? '保存调整' : '发布需求'+(selected.length?' · '+selected.length:'')}</Button></div>}>
    <div className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
          <label className="text-xs text-slate-500">体型 <select aria-label="体型" value={body} onChange={e => setBody(e.target.value as DemandBody)} className="min-h-[28px] rounded border border-slate-200 bg-white text-[11px]">{DEMAND_BODIES.map(b => <option key={b} value={b}>{BODY_LABELS[b]}</option>)}</select></label>
          <label className="text-xs text-slate-500">声音 <select aria-label="声音" value={voice} onChange={e => setVoice(e.target.value as DemandVoice)} className="min-h-[28px] rounded border border-slate-200 bg-white text-[11px]">{DEMAND_VOICES.map(v => <option key={v} value={v}>{VOICE_LABELS[v]}</option>)}</select></label>
          <label className="flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" checked={green} onChange={e=>setGreen(e.target.checked)}/><img src={GREEN_NEST_ICON} alt="" className="size-4"/>绿窝</label>
        </div>
        {!demand?<SearchField label="搜索精灵" value={query} onValueChange={v=>{setQuery(v);setLimit(12);}} placeholder="搜索精灵名 / 图鉴号" className="[&_input]:text-left"/>:null}
        <div className="grid grid-cols-2 gap-2">{options.slice(0,limit).map(s=>{const d=drafts[s.gameId];const main=[...new Set([...targetNaturePool.map(n=>n.name),'保守',...(d?.natures??[])])];const natureButton=(n:string)=><button key={n} type="button" aria-label={n} aria-pressed={!!d?.natures.includes(n)} onClick={()=>toggle(s.gameId,n)} className={'min-h-7 rounded border text-[10px] '+(d?.natures.includes(n)?'border-emerald-500 bg-emerald-50 text-emerald-700':'border-slate-200 bg-white text-slate-500')}>{n}</button>;
          return <div key={s.gameId} data-testid="publish-egg" className="flex min-w-0 flex-col items-center gap-1 rounded-lg border border-slate-200 p-1.5"><PetAvatar gameId={s.gameId} name={s.name} size={44}/><strong className="text-[11px]">{s.name}</strong><div className="grid w-full grid-cols-3 gap-0.5">{main.map(natureButton)}</div><details className="w-full text-[10px] text-slate-500"><summary className="min-h-7 cursor-pointer text-center leading-7">更多性格</summary><div className="grid grid-cols-3 gap-0.5">{allNatureNames.filter(n=>!main.includes(n)).map(natureButton)}</div></details><label className="flex items-center gap-1 text-[10px] text-slate-500">数量<input aria-label={s.name+'数量'} type="number" min={demand?demand.fulfilled+1:1} max={99} value={d?.quantity??1} onChange={e=>{const quantity=e.target.valueAsNumber;setDrafts(current=>({...current,[s.gameId]:{id:current[s.gameId]?.id??crypto.randomUUID(),natures:current[s.gameId]?.natures??[],quantity}}));}} className="min-h-7 w-12 rounded border border-slate-200 px-1 text-left"/></label></div>;
        })}</div>
        {options.length>limit?<Button variant="text" size="sm" onClick={()=>setLimit(n=>n+12)}>显示更多</Button>:null}
        {!options.length?<p className="py-4 text-center text-xs text-slate-500">没有符合的精灵</p>:null}
      {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}
    </div>
  </ModalSurface>;
}
