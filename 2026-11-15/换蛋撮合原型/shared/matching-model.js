(function(global){
 'use strict';
 // 所有库存、亲本和归属为演示数据，不代表已有真实采集来源校验。
 const EGGS={3227:{name:'菊花梨',file:'Item_107086.png'},3436:{name:'柴渣虫',file:'Item_107161.png'},3215:{name:'海豹战士',file:'Item_107083.png'}};
 const MEDALS={'1001':'大块头','1001-max':'满体重','1002':'小不点','1002-min':'零体重','1026':'婉转声','1026-max':'满声音','1025':'粗嗓门','1025-max':'满粗嗓门'};
 const needs=[
  {id:'mine-pear',egg:3227,owner:'我',mine:true,natures:['固执','保守'],body:'1001',voice:'1026',qty:2,fulfilled:1},
  {id:'mine-bug',egg:3436,owner:'我',mine:true,natures:['保守'],body:'1001-max',voice:'1026',qty:1,fulfilled:0},
  {id:'mine-seal',egg:3215,owner:'我',mine:true,natures:['开朗'],body:'1002',voice:'1025',qty:1,fulfilled:0},
  {id:'alan-pear',egg:3227,owner:'阿岚',mine:false,natures:['固执','保守'],body:'1001',voice:'1026',qty:1,fulfilled:0},
  {id:'xiaoman-bug',egg:3436,owner:'小满',mine:false,natures:['保守'],body:'1001',voice:'1026',qty:2,fulfilled:0},
  {id:'alan-bug',egg:3436,owner:'阿岚',mine:false,natures:['保守'],body:'1001',voice:'1026',qty:1,fulfilled:0},
  {id:'xiaoman-pear',egg:3227,owner:'小满',mine:false,natures:['保守'],body:'1001',voice:'1026',qty:1,fulfilled:0}
 ];
 const parents={
  pear:[{egg:3436,name:'柴渣虫',nature:'固执',gender:'公',body:'1001',voice:'1026',nest:'学院小窝'},{egg:3227,name:'菊花梨',nature:'保守',gender:'母',body:'1001',voice:'1026',nest:'普通窝'}],
  bug:[{egg:3436,name:'柴渣虫',nature:'保守',gender:'母',body:'1001',voice:'1026',nest:'学院小窝'},{egg:3436,name:'柴渣虫',nature:'固执',gender:'公',body:'1001',voice:'1026',nest:'普通窝'}]
 };
 const stock=[
  {id:'s1',egg:3227,nature:'固执',body:'1001',voice:'1026',status:'listed',origin:'self',location:'bag',system:true,parents:'pear'},
  {id:'s2',egg:3436,nature:'保守',body:'1001',voice:'1026',status:'listed',origin:'self',location:'bag',system:true,parents:'bug'},
  {id:'s3',egg:3227,nature:'保守',body:'1001-max',voice:'1026',status:'unlisted',origin:'self',location:'home',system:true,parents:'pear'},
  {id:'s4',egg:3436,nature:'保守',body:'1001',voice:'1026',status:'reserved',origin:'self',location:'bag',system:true,parents:'bug'},
  {id:'s5',egg:3436,nature:'',body:'1001',voice:'',status:'unknown',origin:'unknown',location:'bag',system:false},
  {id:'s7',egg:3227,nature:'固执',body:'1001',voice:'1026',status:'reserved',origin:'self',location:'bag',system:true,parents:'pear'},
  {id:'s8',egg:3215,nature:'胆小',body:'1002',voice:'1025',status:'unlisted',origin:'external',location:'bag',system:true}
 ];
 const supplies=[
  {id:'alan-stock-pear',egg:3227,owner:'阿岚',nature:'固执',body:'1001',voice:'1026',type:'spot',origin:'self',system:true,wants:'alan-bug',parents:'pear'},
  {id:'xiaoman-stock-pear',egg:3227,owner:'小满',nature:'保守',body:'1001',voice:'1026',type:'spot',origin:'self',system:true,wants:'xiaoman-bug',parents:'pear'},
  {id:'xiaoman-custom-pear',egg:3227,owner:'小满',nature:'固执',body:'1001',voice:'1026',type:'custom',system:true,wants:'xiaoman-bug',parents:'pear'}
 ];
 const state={demo:'normal',search:{mine:'',square:''},stockFilter:'all',stockSearch:'',selfOnly:false,tradeFilter:'active',customOffers:new Set(),newNeeds:[],alloc:'alan-pear',receiptEvents:[],form:null,order:[]};
 const trades=[
  {id:'t-existing',peer:'阿岚',give:{egg:3436,nature:'保守',body:'1001',voice:'1026'},receive:{egg:3227,nature:'固执',body:'1001',voice:'1026'},status:'accepted',role:'demander',need:'mine-pear',type:'spot',stockId:'s4'},
  {id:'t-custom',peer:'小满',give:{egg:3227,nature:'固执',body:'1001',voice:'1026'},receive:{egg:3436,nature:'保守',body:'1001',voice:'1026'},status:'accepted',role:'supplier',need:'xiaoman-pear',type:'custom',placed:false,stockId:'s7'},
  {id:'t-pending',peer:'阿岚',give:{egg:3215,nature:'开朗',body:'1002',voice:'1025'},receive:{egg:3436,nature:'保守',body:'1001-max',voice:'1026'},status:'proposed',role:'demander',need:'mine-bug',type:'custom'}
 ];
 const allNeeds=()=>[...needs,...state.newNeeds];
 const findNeed=id=>allNeeds().find(n=>n.id===id);
 const activeTrade=t=>!['done','cancelled'].includes(t.status);
 const locked=n=>trades.some(t=>t.need===n.id&&t.status==='accepted')||state.customOffers.has(n.id);
 const bodyMatch=(wanted,actual)=>!wanted||wanted===actual||(wanted==='1001'&&actual==='1001-max')||(wanted==='1002'&&actual==='1002-min');
 const matches=(n,s)=>n.egg===s.egg&&(!n.natures.length||n.natures.includes(s.nature))&&bodyMatch(n.body,s.body)&&(!n.voice||n.voice===s.voice);
 const eligible=s=>s.origin==='self'&&!!s.nature&&['listed','unlisted'].includes(s.status)&&s.system===true;
 const getOwn=n=>['new','empty'].includes(state.demo)?[]:stock.filter(s=>eligible(s)&&matches(n,s));
 const getSupplies=n=>state.demo==='empty'?[]:supplies.filter(s=>matches(n,s)&&(s.type==='custom'||s.origin==='self'));
 const linesFor=n=>['new','empty'].includes(state.demo)?[]:[{egg:3227,nature:'固执',body:'1001',voice:'1026',parents:'pear'},{egg:3436,nature:'保守',body:'1001',voice:'1026',parents:'bug'}].filter(s=>matches(n,s));
 function syncInventory(snapshot){
  // 调用者必须提供同一采集周期的完整背包+家园蛋快照；局部采集不能用于删除库存。
  if(!Array.isArray(snapshot.bag)||!Array.isArray(snapshot.home))throw new Error('需要完整背包与家园快照');
  const previous=new Map(stock.map(s=>[s.id,s])),seen=new Set(),next=[];
  for(const [location,rows] of [['bag',snapshot.bag],['home',snapshot.home]])for(const row of rows){if(!row.id||seen.has(row.id))continue;seen.add(row.id);const old=previous.get(row.id);const origin=row.origin||'unknown';const value={...row,location,origin,status:old?.status||row.status||'unlisted'};if(value.status==='traded')value.status='unlisted';if(value.status==='listed'&&!eligible(value))value.status='unlisted';next.push(value);}
  stock.splice(0,stock.length,...next);return stock;
 }
 function receive(id){const t=trades.find(t=>t.id===id);if(!t||t.role!=='demander'||t.status!=='accepted')return false;t.status='done';const index=stock.findIndex(s=>s.id===t.stockId);if(index>=0)stock.splice(index,1);stock.push({...t.receive,id:'received-'+t.id,status:'unlisted',origin:'external',location:'bag',system:true});const n=findNeed(t.need);if(n)n.fulfilled=Math.min(n.qty,n.fulfilled+1);state.receiptEvents.push({trade:t.id,text:'已收到'});return true;}
 function withdraw(id){const n=findNeed(id);if(!n?.mine||locked(n))return false;n.withdrawn=true;for(const t of trades.filter(t=>t.need===id&&t.status==='proposed')){t.status='cancelled';const s=stock.find(s=>s.id===t.stockId);if(s?.status==='reserved')s.status='unlisted';}return true;}
 global.MatchingModel={EGGS,MEDALS,needs,stock,supplies,parents,state,trades,findNeed,allNeeds,activeTrade,locked,matches,eligible,getOwn,getSupplies,linesFor,syncInventory,receive,withdraw};
})(window);

