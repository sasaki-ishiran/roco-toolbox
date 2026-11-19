import { useEffect, useMemo, useRef, useState } from 'react';
import type { OwnedPet, SpeciesEntry } from '../../domain/types';
import type { AccountSnapshot } from '../../domain/parseBackup';
import { inventoryFromSnapshot } from '../../domain/eggInventory';
import { canCirculateEgg, canMatchDemand, type EggDemand, type EggRecord } from '../../shared/eggMatching';
import { emptyEggWorkflow, type EggLine, type PublishedEggLine, type WorkflowEgg } from '../../shared/eggWorkflow';
import type { PublishedMotherResource } from '../../shared/motherGroups';
import { pairOptionsForEgg } from '../../domain/demandCriteria';
import { accountKeyOf } from '../../domain/parseBackup';
import { PetAvatar } from '../PetAvatar';
import { ModalSurface } from '../primitives/ModalSurface';
import { Button } from '../primitives/Button';
import { SearchField } from '../primitives/SearchField';
import { EggDemandCard } from './EggDemandCard';
import { EggDemandEditor } from './EggDemandEditor';
import { useEggMatching } from './useEggMatching';
import { EggStockPanel, EggMedals, EggArt } from './EggStockPanel';
import { emptyEggStock, reconcileEggStock, type EggStockState, type StockEgg } from './eggStockModel';
import { newUuid } from '../../shared/uuid';
import { homeStockFromSnapshot } from './homeEggAdapter';
import { EggTasksPanel } from './EggTasksPanel';

export interface EggMatchingHubProps {
  groupId: string; viewerAccountId: string; species: readonly SpeciesEntry[];
  members: readonly { accountId: string; displayName: string; resource?:PublishedMotherResource|null }[];
  snapshots?: readonly AccountSnapshot[];
}
const box = 'rounded-xl border border-slate-200 bg-white p-2.5';
const empty = 'rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500';

const sharedParent=(pet:OwnedPet)=>({id:pet.captureId!,gameId:pet.gameId,name:pet.name,nature:pet.nature,body:pet.medalBody==='大块头'?(pet.weightPercent!=null&&pet.weightPercent>=100?'满体重':'大块头'):pet.medalBody==='小不点'?(pet.weightPercent!=null&&pet.weightPercent<=0?'零体重':'小不点'):'',voice:pet.voiceDb===100?'+100':pet.voiceDb===-100?'-100':pet.voiceDb>=96?'婉转声':pet.voiceDb<=-96?'粗嗓门':''});
function localLinesForDemand(demand:EggDemand,snapshots:readonly AccountSnapshot[],species:readonly SpeciesEntry[]):EggLine[]{
  const options=(demand.natures.length?demand.natures:['']).flatMap(nature=>pairOptionsForEgg(snapshots,{eggGameId:demand.eggGameId,nature,gender:'',body:demand.body,voice:demand.voice},species,3,demand.greenNest)
    .filter(p=>p.motherPet.pet.captureId&&p.malePet.pet.captureId).map(p=>({eggGameId:demand.eggGameId,nature,body:demand.body,voice:demand.voice,gameAccountKey:accountKeyOf(p.motherPet.snapshot),motherId:p.motherPet.pet.captureId!,fatherId:p.malePet.pet.captureId!,natureChance:p.natureChance,parents:[sharedParent(p.motherPet.pet),sharedParent(p.malePet.pet)],
      ...(demand.greenNest?{greenParentId:p.motherPet.pet.nature===nature?p.motherPet.pet.captureId!:p.malePet.pet.captureId!}:{})})));
  return [...new Map(options.map(line=>[JSON.stringify(line),line])).values()].slice(0,6);
}

export function EggMatchingHub({ groupId, viewerAccountId: me, species, members, snapshots = [] }: EggMatchingHubProps) {
  const api = useEggMatching(groupId, me);
  const state = api.data?.state ?? emptyEggWorkflow();
  const [tab, setTab] = useState<'mine' | 'square'>('mine');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<'stock' | 'tasks' | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EggDemand | 'new' | null>(null);
  const [withdraw, setWithdraw] = useState(false);
  const [proposal, setProposal] = useState<{ give?: WorkflowEgg; line?: EggLine; lineId?:string; supplier?: string } | null>(null);
  /** 组内广场：只看我能接（有现蛋或能代孵）。 */
  const [onlyAffordable, setOnlyAffordable] = useState(false);
  /** 需求方点「看他的需求」：列出对方需求里我能提供的蛋。 */
  const [peer, setPeer] = useState<string | null>(null);
  /** 发起前的确认（原型「发起换蛋」弹窗）；换回的一侧由系统自动带入。 */
  const [confirming, setConfirming] = useState<{ back: WorkflowEgg | { line: EggLine; id?: string }; returnDemandId?: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const syncing = useRef(false);
  const attemptedCaptures = useRef(new Set<string>());
  // 服务端库存是持久化基线；家蛋只补 home 这一层，不能覆盖背包的 complete 语义。
  const stockRef = useRef<EggStockState>(emptyEggStock());
  const partTimes = useRef<Record<string, { bag: number; home: number }>>({});
  const hydrated = useRef(false);
  const [syncError,setSyncError] = useState('');
  const [syncRetry,setSyncRetry] = useState(0);
  const lineAttempt=useRef('');
  const name = (id: number) => species.find(s => s.gameId === id)?.name ?? '未收录精灵';
  const owner = (id: string) => id === me ? '我' : members.find(m => m.accountId === id)?.displayName ?? '已退出成员';
  const act = async (action: unknown) => { setError(''); try { await api.mutate(action); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); throw e; } };
  const run = (action: unknown, done?: () => void) => { void act(action).then(done).catch(() => {}); };

  // Read only real imported captures. The server watermark makes repeated visits idempotent.
  useEffect(() => {
    if (!api.data || api.busy || syncing.current) return;
    if (!hydrated.current) {
      // 先用服务端库存水合，避免把已经同步过的蛋当成新蛋重新发一遍。
      const eggs = api.data.state.eggs.map(egg => ({
        ...egg,
        location: egg.location ?? 'bag',
        lastConfirmedAt: egg.lastConfirmedAt ?? 0,
      } as StockEgg));
      stockRef.current = { eggs, captureWatermarks: {}, provenanceHistory: {} };
      for (const egg of eggs) {
        const key = egg.gameAccountKey ?? '';
        const times = partTimes.current[key] ?? { bag: -1, home: -1 };
        if (egg.location === 'home') times.home = Math.max(times.home, egg.lastConfirmedAt);
        else times.bag = Math.max(times.bag, egg.lastConfirmedAt);
        partTimes.current[key] = times;
      }
      hydrated.current = true;
    }
    for (const snapshot of snapshots) {
      try {
        const bag = inventoryFromSnapshot(snapshot, me);
        const home = homeStockFromSnapshot(snapshot, me);
        const key = bag.gameAccountKey;
        const times = partTimes.current[key] ?? { bag: -1, home: -1 };
        const bagTime = Number.isFinite(bag.capturedAt) ? bag.capturedAt : -1;
        const homeTime = home?.capturedAt ?? -1;
        const bagChanged = bagTime > times.bag;
        const homeChanged = homeTime > times.home;
        if (!bagChanged && !homeChanged) continue;
        const attempt = JSON.stringify([groupId, me, key, bagChanged ? bagTime : -1, homeChanged ? homeTime : -1]);
        if (attemptedCaptures.current.has(attempt)) continue;
        attemptedCaptures.current.add(attempt);
        const capturedAt = Math.max(bagChanged ? bagTime : -1, homeChanged ? homeTime : -1);
        const nextStock = reconcileEggStock(stockRef.current, {
          accountId: me, gameAccountKey: key, capturedAt,
          ...(bagChanged ? { bag: { eggs: bag.eggs, complete: bag.complete, capturedAt: bagTime } } : {}),
          ...(homeChanged && home ? { home: { eggs: home.eggs, complete: home.complete, capturedAt: homeTime } } : {}),
        });
        syncing.current = true;
        void api.mutate({ type: 'stock-sync', gameAccountKey: key, capturedAt,
          complete: bagChanged ? bag.complete : false,
          homeComplete: homeChanged ? !!home?.complete : false,
          eggs: nextStock.eggs
            .filter(egg => egg.accountId === me && (egg.gameAccountKey ?? '') === key)
            .map(egg => ({ ...egg, gameAccountKey: key })) })
          .then(() => {
            // 只有服务端确认成功才推进本地基线与部位时间，失败时重试仍能重发同一批。
            stockRef.current = nextStock;
            partTimes.current[key] = { bag: bagChanged ? bagTime : times.bag, home: homeChanged ? homeTime : times.home };
            setSyncError('');
          })
          .catch(e => setSyncError(e instanceof Error ? e.message : '蛋仓同步失败'))
          .finally(() => { syncing.current = false; setSyncRetry(n => n + 1); });
        break;
      } catch (e) {
        setSyncError(e instanceof Error ? e.message : '蛋仓同步失败');
      }
    }
  }, [api.data, api.busy, api.mutate, snapshots, me, groupId, syncRetry]);

  const sharedAccountKeys=members.find(m=>m.accountId===me)?.resource?.accounts.map(a=>a.accountKey)??[];
  const sharedSnapshots=snapshots.filter(s=>sharedAccountKeys.includes(accountKeyOf(s)));
  // 产线只在需求/快照变化时重算；改筛选、开关弹窗不再把所有需求重跑一遍配对
  const sharedLines:PublishedEggLine[]=useMemo(()=>state.demands.filter(d=>d.status==='open').flatMap(d=>localLinesForDemand(d,sharedSnapshots,species)).map(line=>({...line,accountId:me,id:JSON.stringify([line.gameAccountKey,line.motherId,line.fatherId,line.eggGameId,line.nature,line.body,line.voice,line.greenParentId??''])}))
    ,[state.demands,sharedSnapshots,species,me]);
  const linePayload=JSON.stringify([...new Map(sharedLines.map(l=>[l.id,l])).values()].slice(0,1024));
  useEffect(()=>{
    if(!api.data||api.busy||syncing.current)return;
    const signature=JSON.stringify([groupId,me,linePayload]);
    if(lineAttempt.current===signature)return;
    const current=JSON.stringify((api.data.state.lines??[]).filter(l=>l.accountId===me));
    if(current===linePayload)return;
    lineAttempt.current=signature;
    void api.mutate({type:'line-sync',lines:JSON.parse(linePayload)}).catch(e=>setSyncError(e instanceof Error?e.message:'产线同步失败'));
  },[api.data,api.busy,api.mutate,groupId,me,linePayload,syncRetry]);

  const demand = state.demands.find(d => d.id === detailId);
  const mine = demand?.demanderAccountId === me;
  const locked = !!demand && state.trades.some(t => t.status === 'accepted' && (t.demandId === demand.id || t.returnDemandId === demand.id));
  const ownEggs = state.eggs.filter(e => e.accountId === me && e.status !== 'transferred');
  const offers = demand ? state.eggs.filter(e => canCirculateEgg(e) && canMatchDemand(demand, e) &&
    (mine ? e.accountId !== me && e.listed : e.accountId === me)) : [];
  const groupLines=demand&&mine?(state.lines??[]).filter(l=>l.accountId!==me&&canMatchDemand(demand,l)&&(!demand.greenNest||l.greenParentId)):[];
  const lines=useMemo(()=>demand&&demand.demanderAccountId!==me?localLinesForDemand(demand,snapshots,species).map(line=>({line})):[],[demand,me,snapshots,species]);
  /** 我这一侧能提供的现蛋 / 产线：广场卡片和「看他的需求」共用同一份索引。 */
  const myEggs=useMemo(()=>state.eggs.filter(e=>e.accountId===me&&e.status!=='transferred'&&canCirculateEgg(e)),[state.eggs,me]);
  const myLines=useMemo(()=>(state.lines??[]).filter(l=>l.accountId===me),[state.lines,me]);
  const supplyOf=(value:EggDemand):'give'|'hatch'|'none'=>
    myEggs.some(egg=>canMatchDemand(value,egg))?'give'
      :myLines.some(l=>canMatchDemand(value,l)&&(!value.greenNest||l.greenParentId))?'hatch':'none';
  const visible=useMemo(()=>state.demands.filter(d => (tab === 'mine' ? d.demanderAccountId === me : d.demanderAccountId !== me) &&
    d.status === 'open' && (!query || name(d.eggGameId).includes(query) || owner(d.demanderAccountId).includes(query)) &&
    (tab !== 'square' || !onlyAffordable || supplyOf(d) !== 'none')),
    // eslint 会提示 supplyOf 每次都是新函数，但索引来自上面两个 memo，这里是纯判断，不会引发重复计算
    [state.demands,tab,me,query,onlyAffordable,myEggs,myLines]);
  const completed=state.demands.filter(d=>d.demanderAccountId===me&&d.status==='fulfilled');
  const propose = (back: WorkflowEgg | {line:EggLine;id?:string}, returnDemandId?: string) => {
    if (!proposal || !demand) return;
    const backAction='line' in back?(mine?{returnLine:back.line}:{returnLineId:back.id}):{receiveId:back.id};
    run({ type: mine ? 'request' : 'propose', id: newUuid(), demandId: demand.id,
      supplierAccountId: proposal.supplier, giveId: proposal.give?.id, line: proposal.line,lineId:proposal.lineId,...backAction,returnDemandId },
    () => { setProposal(null); setConfirming(null); setPeer(null); setDetailId(null); setPage('tasks'); setNotice('已提出换蛋'); });
  };
  /** 产线只作推荐配窝：每个账号 / 每颗蛋只留一条，避免弹窗里铺一大堆。 */
  const bestPerOwner = (values: readonly PublishedEggLine[]): PublishedEggLine[] => {
    const seen = new Set<string>();
    return values.filter(line => !seen.has(line.accountId) && (seen.add(line.accountId), true));
  };
  const bestPerEgg = <T extends EggLine>(values: readonly T[]): T[] => {
    const seen = new Set<number>();
    return values.filter(line => !seen.has(line.eggGameId) && (seen.add(line.eggGameId), true));
  };
  /** 需求方点「看他的需求」：对方 open 需求里，我能提供的蛋与产线（产线每颗蛋只留一条）。 */
  const peerDemands = peer ? state.demands.filter(d => d.demanderAccountId === peer && d.status === 'open') : [];
  const peerEggs = peer ? myEggs.filter(egg => peerDemands.some(d => canMatchDemand(d, egg))) : [];
  const peerLines = peer ? bestPerEgg(myLines.filter(line => peerDemands.some(d => canMatchDemand(d, line) && (!d.greenNest || line.greenParentId)))) : [];
  /** 接单方换回：从对方已挂出的现蛋 / 产线里自动挑一颗能满足我需求单的。 */
  const myOpenDemands = state.demands.filter(d => d.demanderAccountId === me && d.status === 'open');
  const autoReturnEggs = demand && !mine
    ? state.eggs.filter(e => e.accountId === demand.demanderAccountId && e.listed && canCirculateEgg(e) && myOpenDemands.some(d => canMatchDemand(d, e)))
    : [];
  const autoReturnLines = demand && !mine
    ? (state.lines ?? []).filter(l => l.accountId === demand.demanderAccountId && myOpenDemands.some(d => canMatchDemand(d, l) && (!d.greenNest || l.greenParentId)))
    : [];
  const chooseSupply = (item: { egg: WorkflowEgg } | { line: EggLine }) => {
    if (!demand) return;
    setProposal('egg' in item ? { give: item.egg, supplier: me } : { line: item.line, supplier: me });
    const backEgg = autoReturnEggs[0];
    const backLine = autoReturnLines[0];
    if (backEgg) setConfirming({ back: backEgg, returnDemandId: myOpenDemands.find(d => canMatchDemand(d, backEgg))?.id });
    else if (backLine) setConfirming({ back: { line: backLine, id: backLine.id }, returnDemandId: myOpenDemands.find(d => canMatchDemand(d, backLine))?.id });
    else { setConfirming(null); setError('对方暂时没有你需要的蛋，先让对方挂出一颗再发起'); }
  };
  const supplyEggs = demand && !mine ? myEggs.filter(egg => canMatchDemand(demand, egg)) : [];
  const supplyLines = demand && !mine ? bestPerEgg(lines.map(entry => entry.line)) : [];
  const groupLinesBest = bestPerOwner(groupLines);
  const eggRow = (egg: EggRecord, action?: React.ReactNode) => <div className="flex items-center gap-2 py-2" key={egg.accountId + egg.id}>
    <EggArt eggGameId={egg.eggGameId} name={name(egg.eggGameId)} size={32} />
    <div className="min-w-0 flex-1"><strong className="text-xs">{name(egg.eggGameId)}的蛋</strong><div className="flex items-center gap-1 text-[10px] text-slate-500">{egg.nature || '性格未标注'}<EggMedals body={egg.body} voice={egg.voice}/><span>{owner(egg.accountId)}</span></div></div>{action}</div>;
  /** 推荐配窝只占一行：蛋图 + 谁 + 父母 + 概率，不铺开一张亲本卡（按原型）。 */
  const lineRow = (line: EggLine, accountLabel: string, action: React.ReactNode) => {
    const mother = line.parents?.find(parent => parent.id === line.motherId)?.name || '母本';
    const father = line.parents?.find(parent => parent.id === line.fatherId)?.name || '父本';
    return <div className="flex items-center gap-2 border-b border-slate-100 py-2 last:border-0" key={accountLabel + line.eggGameId + line.motherId + line.fatherId}>
      <EggArt eggGameId={line.eggGameId} name={name(line.eggGameId)} size={32}/>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">{name(line.eggGameId)}的蛋</div>
        <div className="truncate text-[10px] text-slate-500">{accountLabel} · 推荐配窝 {mother} × {father}{line.natureChance != null ? ` · ${Math.round(line.natureChance * 100)}%` : ''}</div>
      </div>
      {action}
    </div>;
  };

  return <div className="flex min-w-0 flex-col gap-2" data-testid="egg-matching-hub">
    {syncError?<div role="alert" className="flex items-center justify-between rounded-lg bg-amber-50 p-2 text-xs text-amber-800"><span>蛋仓同步失败：{syncError}</span><Button size="sm" variant="text" disabled={api.busy} onClick={()=>{attemptedCaptures.current.clear();lineAttempt.current='';setSyncError('');setSyncRetry(n=>n+1);}}>重试同步</Button></div>:null}
    {api.error || error ? <div role="alert" className="flex items-center justify-between rounded-lg bg-rose-50 p-2 text-xs text-rose-700"><span>{error || api.error}</span><Button variant="text" size="sm" onClick={() => void api.refresh()}>重试</Button></div> : null}
    {notice ? <div role="status" className="text-xs text-emerald-700">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice('')} className="ml-2 min-h-7 px-2">×</button></div> : null}
    {page ? <div className="flex items-center gap-2"><Button variant="text" size="sm" onClick={() => setPage(null)}>‹ 返回</Button><h3 className="text-sm font-semibold">{page === 'stock' ? '我的蛋仓' : '我的换蛋'}</h3></div> : <>
      <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1">{(['mine','square'] as const).map(t => <button key={t} type="button" aria-pressed={tab === t} onClick={() => { setTab(t); setQuery(''); }} className={'min-h-8 rounded-md text-xs ' + (tab === t ? 'bg-white font-semibold text-emerald-700 shadow-sm' : 'text-slate-500')}>{t === 'mine' ? '我的收集' : '组内广场'}</button>)}</div>
      <div className="grid grid-cols-2 gap-2"><Button variant="secondary" size="sm" onClick={() => setPage('stock')}>蛋仓 <span className="ml-auto text-slate-400">{ownEggs.length}</span></Button><Button variant="secondary" size="sm" onClick={() => setPage('tasks')}>我的换蛋 <span className="ml-auto text-amber-600">{state.trades.filter(t => ['proposed','accepted'].includes(t.status)).length}</span></Button></div>
      <SearchField label="搜索需求" value={query} onValueChange={setQuery} placeholder="搜索精灵名" className="text-left [&_input]:text-left" />
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{tab === 'mine' ? '想收' : '组内需求'}</h3>{tab === 'mine' ? <Button variant="text" size="sm" disabled={!api.data} onClick={() => setEditor('new')}>＋ 添加想收</Button> : <span className="text-[10px] text-slate-400">{visible.length} 项</span>}</div>
      {tab === 'square' ? <div className="flex flex-wrap gap-1"><button type="button" aria-pressed={onlyAffordable} onClick={() => setOnlyAffordable(v => !v)} className={'min-h-7 rounded-md px-2 text-[11px] ' + (onlyAffordable ? 'bg-emerald-50 font-semibold text-emerald-700' : 'text-slate-500')}>只看我能接</button></div> : null}
      {api.loading ? <div className={empty}>正在读取…</div> : visible.length ? <div className="grid grid-cols-3 gap-[7px]">{visible.map(d => <EggDemandCard key={d.id} demand={d} name={name(d.eggGameId)} ownerLabel={tab === 'square' ? owner(d.demanderAccountId) : undefined}
        statusLabel={state.trades.some(t => t.status === 'accepted' && t.demandId === d.id) ? '进行中'
          : tab === 'square' ? (supplyOf(d) === 'give' ? '我能给蛋' : supplyOf(d) === 'hatch' ? '我能孵' : '接不了')
          : state.eggs.some(e => e.accountId !== d.demanderAccountId && e.listed && canCirculateEgg(e) && canMatchDemand(d,e)) ? '有匹配' : '待匹配'}
        onOpen={d => { setDetailId(d.id); setError(''); }} />)}</div> : <div className={empty}>{tab === 'mine' ? '还没有想收的精灵' : '暂无组内需求'}</div>}
      {tab==='mine'&&completed.length?<details className="rounded-xl border border-slate-200 p-2"><summary className="cursor-pointer text-xs text-slate-500">已完成 · {completed.length}</summary><div className="mt-2 grid grid-cols-3 gap-[7px]">{completed.map(d=><EggDemandCard key={d.id} demand={d} name={name(d.eggGameId)} statusLabel="已完成" onOpen={d=>setDetailId(d.id)}/>)}</div></details>:null}
    </>}
    {page === 'stock' ? <EggStockPanel eggs={ownEggs} species={species} busy={api.busy} mutate={act} /> : null}
    {page === 'tasks' ? <EggTasksPanel state={state} me={me} snapshots={snapshots} species={species} members={members} busy={api.busy} mutate={act} /> : null}
    {demand ? <ModalSurface open title={mine?'需求详情':'接单详情'} onClose={() => { setDetailId(null); setProposal(null); }} size="lg"><div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2"><PetAvatar gameId={demand.eggGameId} name={name(demand.eggGameId)} size={44} /><div><strong className="text-sm">{name(demand.eggGameId)}</strong><div className="text-xs text-slate-500">{owner(demand.demanderAccountId)} · 已收 {demand.fulfilled}/{demand.quantity}</div><div className="flex items-center gap-1 text-[11px] text-slate-600">{demand.natures.join(' / ')}<EggMedals body={demand.body} voice={demand.voice}/></div></div></div>
      {mine && !locked && demand.status === 'open' ? <div className="flex justify-end gap-2"><Button variant="text" size="sm" onClick={() => setEditor(demand)}>调整需求</Button><Button variant="danger" size="sm" onClick={() => setWithdraw(true)}>撤回</Button></div> : null}
      {demand.status==='open'?<>
        {mine?<>
          <h4 className="text-xs font-semibold">组内现蛋<span className="ml-1 text-[10px] font-normal text-slate-400">{offers.length} 颗 · 谁有</span></h4>
          <div className={box}>{offers.length ? offers.map(egg => eggRow(egg, <Button size="sm" variant="secondary" onClick={() => { setProposal({ give: egg, supplier: egg.accountId }); setPeer(egg.accountId); }}>看他的需求</Button>)) : <p className="text-xs text-slate-400">暂无匹配现蛋</p>}</div>
          <h4 className="text-xs font-semibold">组内能帮我孵<span className="ml-1 text-[10px] font-normal text-slate-400">{groupLinesBest.length} 人 · 谁能</span></h4>
          <div className={box}>{groupLinesBest.length?groupLinesBest.map(line=>lineRow(line, owner(line.accountId), <Button size="sm" variant="secondary" onClick={()=>{setProposal({lineId:line.id,supplier:line.accountId});setPeer(line.accountId);}}>看他的需求</Button>)):<p className="text-xs text-slate-400">暂无可用产线</p>}</div>

        </>:<>
          <h4 className="text-xs font-semibold">我能提供<span className="ml-1 text-[10px] font-normal text-slate-400">{supplyEggs.length + supplyLines.length} 个蛋</span></h4>
          <div className={box}>
            {supplyEggs.map(egg => eggRow(egg, <Button size="sm" busy={api.busy} onClick={()=>chooseSupply({ egg })}>选这颗</Button>))}
            {supplyLines.map(line => lineRow(line, '我能孵', <Button size="sm" busy={api.busy} onClick={()=>chooseSupply({ line })}>选这颗</Button>))}
            {supplyEggs.length + supplyLines.length ? null : <p className="text-xs text-slate-400">我暂时给不了这颗蛋</p>}
          </div>
        </>}
      </>:null}
    </div></ModalSurface> : null}
    {peer && demand ? <ModalSurface open title="我能满足他的需求" onClose={() => { setPeer(null); setProposal(null); }} size="lg"><div className="p-3">
      <p className="mb-2 text-[10px] text-slate-500">{owner(peer)} 有 {peerDemands.length} 条需求；下面是我能提供的蛋，选一颗发起换蛋。产线只是推荐配窝。</p>
      {peerEggs.length || peerLines.length ? <>{peerEggs.map(egg => { const match = peerDemands.find(d => canMatchDemand(d, egg)); return eggRow(egg, <Button size="sm" busy={api.busy} onClick={() => setConfirming({ back: egg, returnDemandId: match?.id })}>选这颗</Button>); })}
        {peerLines.map(line => lineRow(line, '我能孵', <Button size="sm" busy={api.busy} onClick={() => setConfirming({ back: { line, id: line.id }, returnDemandId: peerDemands.find(d => canMatchDemand(d, line) && (!d.greenNest || line.greenParentId))?.id })}>选这颗</Button>))}
      </> : <p className="py-2 text-center text-xs text-slate-500">他的需求我都满足不了</p>}
      {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}
    </div></ModalSurface> : null}
    {proposal && demand && confirming ? (() => {
      const back = confirming.back;
      const givenEggId = mine
        ? ('line' in back ? back.line.eggGameId : back.eggGameId)
        : (proposal.give?.eggGameId || proposal.line?.eggGameId || demand.eggGameId);
      const form = ('line' in back) || !!proposal.line || !!proposal.lineId ? '蛋换代孵' : '蛋换蛋';
      const peerName = owner(mine ? proposal.supplier ?? demand.demanderAccountId : demand.demanderAccountId);
      return <ModalSurface open title="发起换蛋" onClose={() => setConfirming(null)} size="md"><div className="flex flex-col gap-2 p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-center gap-1">
          <div className="flex min-w-0 items-center gap-1"><PetAvatar gameId={givenEggId} name={name(givenEggId)} size={32}/><div className="min-w-0"><strong className="block truncate text-[11px]">{name(givenEggId)}的蛋</strong><div className="text-[10px] text-slate-400">我给 · {form==='蛋换代孵'?'上窝孵化':'现蛋'}</div></div></div>
          <span className="self-center text-center text-lg leading-none text-slate-400">⇄</span>
          <div className="flex min-w-0 items-center gap-1"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-500">{peerName.slice(0,1)}</span><div className="min-w-0"><strong className="block truncate text-[11px]">{peerName}</strong><div className="text-[10px] text-slate-400">{form}</div></div></div>
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-600"><span>交换形式</span><b className="font-semibold text-slate-900">{form}</b></div>
        <div className="flex items-center justify-between text-[11px] text-slate-600"><span>我这一侧</span><b className="font-semibold text-slate-900">{form==='蛋换代孵'?'家园上窝':'交出现蛋'}</b></div>
        <div className="flex items-center justify-between text-[11px] text-slate-600"><span>对方确认后</span><b className="font-semibold text-slate-900">进入巡查</b></div>
        <Button busy={api.busy} onClick={() => propose(confirming.back, confirming.returnDemandId)}>确认发起</Button>
        {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}
      </div></ModalSurface>;
    })() : null}
    {editor ? <EggDemandEditor demand={editor === 'new' ? null : editor} species={species} busy={api.busy} onClose={() => setEditor(null)} onSave={async drafts => { await act(editor==='new'?{type:'publish-batch',demands:drafts}:{type:'edit',demand:drafts[0]}); setEditor(null); }} /> : null}
    {withdraw && demand ? <ModalSurface open title="撤回需求" onClose={() => setWithdraw(false)} footer={<Button variant="danger" busy={api.busy} onClick={() => run({type:'withdraw',id:demand.id}, () => {setWithdraw(false);setDetailId(null);})}>确认撤回</Button>}><p className="p-3 text-sm">撤回{name(demand.eggGameId)}需求？</p>{error ? <p role="alert" className="px-3 text-xs text-rose-600">{error}</p> : null}</ModalSurface> : null}
  </div>;
}
