import { useEffect, useRef, useState } from 'react';
import type { SpeciesEntry } from '../../domain/types';
import type { EggWorkflowState, WorkflowTrade } from '../../shared/eggWorkflow';
import { eggTaskReady, eggTaskNeedsPlacement } from '../../shared/eggTaskActions';
import { canCirculateEgg, canMatchDemand, type EggDemand } from '../../shared/eggMatching';
import type { EggRecord } from '../../shared/eggMatching';
import { Button } from '../primitives/Button';
import { ModalSurface } from '../primitives/ModalSurface';
import { EggArt, EggMedals } from './EggStockPanel';
import { EggLineSummary } from './EggLineSummary';
import type { AccountSnapshot } from '../../domain/parseBackup';
import catalog from '../../data/catalog.gen.json';

export function EggTasksPanel({state,me,members,species,busy,mutate,snapshots=[]}:{state:EggWorkflowState;snapshots?:readonly AccountSnapshot[];me:string;members:readonly {accountId:string;displayName:string}[];species:readonly SpeciesEntry[];busy:boolean;mutate:(action:unknown)=>Promise<unknown>}) {
  const [filter,setFilter]=useState('进行中');
  const [allocation,setAllocation]=useState<string|null>(null);
  const [receipt,setReceipt]=useState<string|null>(null);
  const [cancel,setCancel]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [draftOrder,setDraftOrder]=useState<string[]|null>(null);
  const [dragging,setDragging]=useState<string|null>(null);
  const host=useRef<HTMLDivElement>(null);
  const persisted=state.orders[JSON.stringify(me)]??[];
  const order=draftOrder??persisted;
  const tasks=state.trades.filter(t=>[t.supplierAccountId,t.demanderAccountId].includes(me)&&(filter==='进行中'?['proposed','accepted'].includes(t.status):filter==='已完成'?t.status==='done':t.status==='cancelled'))
    .sort((a,b)=>{const ai=order.indexOf(a.id),bi=order.indexOf(b.id);return (ai<0?1e9:ai)-(bi<0?1e9:bi)||b.createdAt-a.createdAt;});
  const latest=useRef({tasks,busy,mutate});latest.current={tasks,busy,mutate};
  useEffect(()=>{setDraftOrder(null);},[state.orders,me]);
  useEffect(()=>{
    const list=host.current;if(!list)return;
    let gesture:{id:string;x:number;y:number;started:number;active:boolean;ids:string[]}|null=null;
    let suppress=false;
    const start=(target:EventTarget|null,x:number,y:number)=>{if(latest.current.busy||!(target instanceof Element)||target.closest('button,input,select,a'))return;const card=target.closest<HTMLElement>('[data-task-id]');if(!card)return;gesture={id:card.dataset.taskId!,x,y,started:performance.now(),active:false,ids:latest.current.tasks.map(t=>t.id)};};
    const move=(event:Event,x:number,y:number)=>{const g=gesture;if(!g)return;if(!g.active){if(Math.hypot(x-g.x,y-g.y)<=8)return;if(performance.now()-g.started<300){gesture=null;return;}g.active=true;suppress=true;setDragging(g.id);}if(event.cancelable)event.preventDefault();const card=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-task-id]');if(card&&card.dataset.taskId!==g.id){const to=g.ids.indexOf(card.dataset.taskId!);if(to>=0){g.ids.splice(g.ids.indexOf(g.id),1);g.ids.splice(to,0,g.id);setDraftOrder([...g.ids]);}}const rect=list.getBoundingClientRect();if(y<Math.max(rect.top,0)+35)window.scrollBy(0,-8);else if(y>Math.min(rect.bottom,window.innerHeight)-35)window.scrollBy(0,8);};
    const finish=(commit:boolean)=>{const g=gesture;gesture=null;setDragging(null);if(g?.active){if(commit)void latest.current.mutate({type:'order',ids:g.ids}).catch(e=>{setDraftOrder(null);setError(e instanceof Error?e.message:'排序失败');});else setDraftOrder(null);}window.setTimeout(()=>{suppress=false;},0);};
    const touchStart=(e:TouchEvent)=>{if(e.touches.length===1)start(e.target,e.touches[0].clientX,e.touches[0].clientY);else finish(false);};
    const touchMove=(e:TouchEvent)=>{if(e.touches.length===1)move(e,e.touches[0].clientX,e.touches[0].clientY);};
    const mouseDown=(e:MouseEvent)=>{if(e.button===0)start(e.target,e.clientX,e.clientY);};
    const mouseMove=(e:MouseEvent)=>move(e,e.clientX,e.clientY);
    const end=()=>finish(true),abort=()=>finish(false);
    const click=(e:MouseEvent)=>{if(suppress){e.preventDefault();e.stopPropagation();}};
    list.addEventListener('touchstart',touchStart,{passive:true});list.addEventListener('touchmove',touchMove,{passive:false});list.addEventListener('mousedown',mouseDown);list.addEventListener('click',click,true);
    window.addEventListener('mousemove',mouseMove);window.addEventListener('mouseup',end);list.addEventListener('touchend',end);list.addEventListener('touchcancel',abort);window.addEventListener('blur',abort);
    return()=>{list.removeEventListener('touchstart',touchStart);list.removeEventListener('touchmove',touchMove);list.removeEventListener('mousedown',mouseDown);list.removeEventListener('click',click,true);window.removeEventListener('mousemove',mouseMove);window.removeEventListener('mouseup',end);list.removeEventListener('touchend',end);list.removeEventListener('touchcancel',abort);window.removeEventListener('blur',abort);};
  },[]);
  const run=(action:unknown,done?:()=>void)=>{setError('');void mutate(action).then(done).catch(e=>setError(e instanceof Error?e.message:'操作失败'));};
  const name=(id:number)=>species.find(s=>s.gameId===id)?.name??'未收录精灵';
  const half=(egg:EggRecord|null,label:string)=>egg?<div className="flex min-w-0 items-center gap-1"><EggArt eggGameId={egg.eggGameId} name={name(egg.eggGameId)} size={32}/><div className="min-w-0"><strong className="block truncate text-[11px]">{name(egg.eggGameId)}</strong><div className="text-[10px] text-slate-400">{label} · {egg.nature||'未标注'}</div><EggMedals body={egg.body} voice={egg.voice}/></div></div>:<span className="text-[10px] text-slate-400">旧单无换回记录</span>;
  const ready=eggTaskReady;
  const allocating=state.trades.find(t=>t.id===allocation);
  const target=allocating?(allocating.supplierAccountId===me?allocating.give:allocating.receive):null;
  const candidates=target?state.eggs.filter(e=>e.accountId===me&&canCirculateEgg(e)&&canMatchDemand({eggGameId:target.eggGameId,natures:target.nature?[target.nature]:[],body:target.body==='unknown'?'':target.body,voice:target.voice==='unknown'?'':target.voice} as EggDemand,e)):[];
  const status=(t:WorkflowTrade)=>t.status==='done'?'已完成':t.status==='cancelled'?'已取消':t.status==='proposed'?'待接受':t.type==='custom'&&!ready(t)?((t.line&&!t.placed)||(t.returnLine&&!t.returnPlaced)?'待上窝':'待分配现蛋'):t.demanderAccountId===me?'待我收到':'待对方收到';
  const history=(state.legacyHistory??[]).filter(h=>[h.demanderAccountId,h.supplierAccountId].includes(me)&&(filter==='已完成'?h.status==='done':filter==='已取消'?h.status==='cancelled':false));
  return <div className="flex flex-col gap-2"><div className="flex gap-1">{['进行中','已完成','已取消'].map(f=><button key={f} type="button" aria-pressed={filter===f} onClick={()=>setFilter(f)} className={'min-h-7 rounded-md px-2 text-[11px] '+(filter===f?'bg-emerald-50 text-emerald-700':'text-slate-500')}>{f}</button>)}</div>
    {error?<p role="alert" className="text-xs text-rose-600">{error}</p>:null}
    <div ref={host} className="flex flex-col gap-2">{tasks.map(t=>{const demander=t.demanderAccountId===me;const peer=demander?t.supplierAccountId:t.demanderAccountId;const canAccept=(t.initiatorAccountId===t.demanderAccountId?t.supplierAccountId:t.demanderAccountId)===me;
      const ownLine=demander?t.returnLine:t.line;
      const needsPlacement=eggTaskNeedsPlacement(t,me);
      const needsAllocation=!!ownLine&&!needsPlacement&&!(demander?t.returnEggId:t.giveEggId);
      const peerName=members.find(m=>m.accountId===peer)?.displayName??'已退出成员';
      /** 两侧各自的状态：任一侧确认都不会替另一侧推进（2026-11-19）。 */
      const sideOf=(asDemander:boolean)=>{
        const sideLine=asDemander?t.returnLine:t.line;
        const placed=asDemander?!!t.returnPlaced:!!t.placed;
        const eggId=asDemander?t.returnEggId:t.giveEggId;
        if(sideLine)return placed?{text:'已上窝',done:true}:{text:'待上窝',done:false};
        return eggId?{text:'已交付',done:true}:{text:'待交付',done:false};
      };
      const mySide=sideOf(demander);
      const peerSide=sideOf(!demander);
      const reminder = state.reminders?.find(r=>r.tradeId===t.id&&r.reminderAt===t.reminderAt);
      const reminderLabel = reminder?.status==='sent'?'群内已提醒':reminder?.status==='unbound'?'对方未绑定QQ':reminder?.status==='failed'?'催促发送失败':reminder?.status==='pending'?'催促待发送':'已催进度';
      const patrol=(state.patrol??[]).find(p=>p.tradeId===t.id&&p.side===(demander?'return':'give'))??(state.patrol??[]).find(p=>p.tradeId===t.id);
      const patrolText=patrol?(patrol.checkedAt?new Date(patrol.checkedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'})+' ':'')+
        (patrol.status==='placed'?'已上窝 · 等待产出':
          patrol.status==='produced'?'发现产出 · '+(patrol.notification==='sent'?'已提醒':patrol.notification==='failed'?'提醒失败':patrol.notification==='unbound'?'待绑定QQ':'待提醒'):
          patrol.status==='ambiguous'?'发现产出 · 待分配':patrol.status==='quota'?'今日巡查额度已用完':patrol.status==='quiet'?'夜间暂停 · 08:00 恢复':
          patrol.status==='error'?'巡查失败':patrol.status==='pending'?'待巡查':patrol.status==='queued'?'巡查排队中':'已巡查'):null;
      const steps=t.type==='custom'?['已提出','已接受','已上窝','已收到']:['已提出','已接受','交接中','已收到'];const step=t.status==='done'?3:t.status==='accepted'?(t.type==='custom'&&(((t.line||t.legacy)&&!t.placed)||(t.returnLine&&!t.returnPlaced))?1:2):0;
      return <article key={t.id} data-task-id={t.id} tabIndex={0} aria-label={'与'+(members.find(m=>m.accountId===peer)?.displayName??'已退出成员')+'的换蛋任务'} className={'select-none rounded-xl border bg-white p-2.5 '+(dragging===t.id?'border-emerald-500 shadow-lg':'border-slate-200')} onKeyDown={e=>{if(!e.altKey||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const ids=tasks.map(t=>t.id),i=ids.indexOf(t.id),j=i+(e.key==='ArrowUp'?-1:1);if(j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];setDraftOrder(ids);run({type:'order',ids});}}>
        <div className="mb-2 flex items-center justify-between text-xs"><strong className="min-w-0 truncate">{peerName}</strong><span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">{status(t)}</span></div>
        <div className="grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-center gap-1">{half(demander?t.receive:t.give,'给出')}<span className="self-center text-center text-lg leading-none text-slate-400">⇄</span>{half(demander?t.give:t.receive,'收到')}</div>
        {ownLine?<div className="mt-2"><EggLineSummary line={ownLine} snapshots={snapshots}/></div>:null}
        <ol aria-label="换蛋进度" className="my-2 grid grid-cols-4">{steps.map((label,i)=><li key={label} aria-current={i===step?'step':undefined} className={'relative border-t-2 pt-1 text-center text-[10px] '+(i<=step?'border-emerald-400 text-emerald-700':'border-slate-100 text-slate-400')}>{label}</li>)}</ol>
        <div className="mb-2 flex flex-col gap-1 border-t border-slate-100 pt-1">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-600"><span className={'size-1.5 rounded-full '+(mySide.done?'bg-emerald-500':'bg-amber-500')}/>我 · {mySide.text}</div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-600"><span className={'size-1.5 rounded-full '+(peerSide.done?'bg-emerald-500':'bg-amber-500')}/>{peerName} · {peerSide.text}</div>
        </div>
        {patrolText?<p className="mb-1 border-t border-slate-100 pt-1 text-[10px] text-slate-500">{patrolText}</p>:null}
        {t.reminderAt&&t.reminderBy!==me&&t.status!=='done'?<p className="mb-1 text-[10px] text-amber-700">对方催了进度</p>:null}
        {['proposed','accepted'].includes(t.status)?<div className="flex items-center gap-1"><Button variant="text" size="sm" busy={busy} disabled={!!t.reminderAt&&Date.now()-t.reminderAt<1800000} onClick={()=>run({type:'remind',id:t.id})}>{t.reminderAt&&Date.now()-t.reminderAt<1800000?reminderLabel:'催进度'}</Button><Button variant="text" size="sm" onClick={()=>setCancel(t.id)}>取消</Button><span className="flex-1"/>{t.status==='proposed'&&canAccept?<Button size="sm" busy={busy} onClick={()=>run({type:'accept',id:t.id})}>接受换蛋</Button>:t.status==='accepted'&&needsPlacement?<Button size="sm" busy={busy} onClick={()=>run({type:'place',id:t.id})}>已上窝</Button>:t.status==='accepted'&&needsAllocation?<Button size="sm" busy={busy} onClick={()=>setAllocation(t.id)}>分配现蛋</Button>:t.status==='accepted'&&demander?(ready(t)?<Button size="sm" busy={busy} onClick={()=>setReceipt(t.id)}>已收到</Button>:<span className="text-[10px] text-amber-700">{t.type==='custom'&&(t.line||t.legacy)&&!t.placed?'等待对方上窝':'等待对方分配现蛋'}</span>):t.status==='accepted'&&!demander&&t.type==='custom'&&!t.placed?<Button size="sm" busy={busy} onClick={()=>run({type:'place',id:t.id})}>已上窝</Button>:<span className="text-[10px] text-slate-400">{t.status==='proposed'?'等待对方接受':'等待对方收到'}</span>}</div>:null}
      </article>;
    })}{history.map(h=><article key={h.id} className="rounded-xl border border-slate-200 bg-white p-2.5 text-xs"><div className="flex justify-between"><strong>{(catalog.eggGroupNames as Record<string,string>)[String(h.eggGroupId)]??'旧蛋组需求'}</strong><span className="text-slate-400">{h.status==='done'?'已完成':'已取消'}</span></div><div className="mt-1 text-slate-500">{h.nature||'不挑性格'}</div><EggMedals body={h.body} voice={h.voice}/></article>)}{!tasks.length&&!history.length?<p className="py-6 text-center text-xs text-slate-500">暂无{filter}任务</p>:null}</div>
    {allocating?<ModalSurface open title="分配现蛋" onClose={()=>setAllocation(null)}><div className="p-3">{candidates.length?candidates.map(egg=><div key={egg.id} className="flex items-center gap-2 py-2"><div className="min-w-0 flex-1">{half(egg,'现蛋')}</div><Button size="sm" busy={busy} onClick={()=>run({type:'allocate',id:allocating.id,eggId:egg.id},()=>setAllocation(null))}>分配这颗</Button></div>):<p className="py-4 text-center text-xs text-slate-500">暂无符合的现蛋</p>}{error?<p role="alert" className="text-xs text-rose-600">{error}</p>:null}</div></ModalSurface>:null}
    {receipt?<ModalSurface open title="确认收货" onClose={()=>setReceipt(null)} footer={<Button busy={busy} onClick={()=>run({type:'receive',id:receipt},()=>setReceipt(null))}>确认已收到</Button>}><p className="p-3 text-sm">确认已经收到这颗蛋？</p>{error?<p role="alert" className="px-3 text-xs text-rose-600">{error}</p>:null}</ModalSurface>:null}
    {cancel?<ModalSurface open title="取消换蛋" onClose={()=>setCancel(null)} footer={<Button variant="danger" busy={busy} onClick={()=>run({type:'cancel',id:cancel},()=>setCancel(null))}>确认取消</Button>}><p className="p-3 text-sm">取消这笔换蛋？</p>{error?<p role="alert" className="px-3 text-xs text-rose-600">{error}</p>:null}</ModalSurface>:null}
  </div>;
}
