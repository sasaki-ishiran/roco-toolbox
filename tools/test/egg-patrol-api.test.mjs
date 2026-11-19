import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
let settings, bridge, patrol, matching;
try {
  ({ handleEggBotSettings: settings, handleEggBotBridge: bridge } = await vite.ssrLoadModule('/functions/_lib/eggBotBridge.ts'));
  ({ handleEggMatching: matching } = await vite.ssrLoadModule('/functions/_lib/eggMatching.ts'));
  ({ runEggPatrol: patrol } = await vite.ssrLoadModule('/functions/_lib/eggPatrol.ts'));
} finally { await vite.close(); }

const time = Date.parse('2026-11-16T08:00:00+08:00');
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync('functions/schema.sql', 'utf8'));
  sql.exec(readFileSync('functions/migrations/2026-11-16-egg-matching.sql', 'utf8'));
  sql.exec(readFileSync('functions/migrations/2026-11-16-egg-patrol.sql', 'utf8'));
  sql.exec(readFileSync('functions/migrations/2026-11-18-egg-patrol-repeat-reminders.sql', 'utf8'));
  sql.exec(readFileSync('functions/migrations/2026-11-18-egg-patrol-placement.sql', 'utf8'));
  for (const id of ['a','b','c']) sql.prepare('INSERT INTO accounts(id,recovery_hash,created_at,last_seen_at) VALUES(?,?,1,1)').run(id,id);
  for (const group of ['g','h']) {
    sql.prepare('INSERT INTO mother_groups(id,owner_account_id,name,invite_hash,created_at) VALUES(?,?,?,?,1)').run(group,'a','小组',group);
    for (const id of ['a','b']) sql.prepare('INSERT INTO mother_group_members(group_id,account_id,display_name,joined_at) VALUES(?,?,?,1)').run(group,id,id);
  }
  const prepare = query => {
    let params=[];
    const statement={bind(...values){params=values;return statement;},async first(){return sql.prepare(query).get(...params)??null;},
      async all(){return {results:sql.prepare(query).all(...params)};},async run(){const r=sql.prepare(query).run(...params);return {success:true,meta:{changes:Number(r.changes)}};}};
    return statement;
  };
  const DB={prepare,async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  return {sql,env:{DB,EGG_BOT_BRIDGE_TOKEN:'test-bridge-secret-32-characters-only',ROCOM_PATROL_API_KEY:'fixture-key'}};
}
async function setting(db,account='a',method='POST',group='g',now=time){
  const response=await settings(new Request('https://local/api/collection-groups/'+group+'/egg-bot',{method}),db.env,null,account,group,now);
  return {status:response.status,...await response.json()};
}
async function bot(db,action,body={},now=time,token=db.env.EGG_BOT_BRIDGE_TOKEN,fetcher=undefined){
  const response=await bridge(new Request('https://local/api/egg-bot/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}),db.env,now,fetcher??fetch);
  return {status:response.status,...await response.json()};
}
async function connect(db,group='g'){
  const {code}=await setting(db,'a','POST',group);
  const result=await bot(db,'redeem',{code,qqGroupId:'123456',botId:'654321',operatorQq:'234567'});
  assert.equal(result.status,200);return result;
}
function tasks(db,group='g',id='trade'){
  const line={eggGameId:3062,nature:'固执',body:'',voice:'',gameAccountKey:'uid:293143',motherId:'capture_293143_64299',fatherId:'capture_293143_64037'};
  const trade={id,groupId:group,demandId:'d',supplierAccountId:'b',demanderAccountId:'a',type:'custom',status:'accepted',placed:true,createdAt:1,line,
    give:{id:'line',accountId:'b',eggGameId:3062,nature:'固执',body:'',voice:'',status:'reserved'},receive:null};
  db.sql.prepare('INSERT INTO egg_matching_groups(group_id,state_json,updated_at) VALUES(?,?,1)').run(group,JSON.stringify({demands:[],eggs:[],trades:[trade],watermarks:{},orders:{}}));
}
const scene=(ids=[],pairs=[])=>({code:0,data:{home_scene_info:{snapshot_status:'valid',egg_count:ids.length,eggs:ids.map(id=>({actor_id:id,nest_furniture_guid:'5170452278714212143',
  mother_candidate:{pet_gid:64299,furniture_guid_exact:'5170452278714212143',pet_cfg_id:3062,nature:2,voice:100},father_candidates:[{pet_gid:64037,furniture_guid_exact:'453835583565763747',pet_cfg_id:3744,nature:2,voice:100}],biological_parentage_confirmed:false})),
  home_pets:[{pet_gid:64299,pet_cfg_id:3062,weight:55348},{pet_gid:64037,pet_cfg_id:3744,weight:30257}],breeding_pairs:pairs}}});

test('owner-only expiring one-time group codes; internal auth fails before database access',async()=>{
  const db=database();
  assert.equal((await setting(db,'b')).status,403);
  assert.equal((await setting(db,'c','GET')).status,403);
  const first=await setting(db);assert.equal(first.status,200);assert.ok(first.code);
  assert.equal((await bot(db,'redeem',{code:first.code,qqGroupId:'123456',botId:'654321',operatorQq:'234567'},time+600001)).status,409);
  await connect(db);
  assert.equal((await bot(db,'redeem',{code:first.code,qqGroupId:'123456',botId:'654321',operatorQq:'234567'})).status,409);
  assert.equal((await setting(db,'b','GET')).binding.qqGroupId,'123456');
  const result=await bridge(new Request('https://local/api/egg-bot/tick',{method:'POST'}),{DB:null,EGG_BOT_BRIDGE_TOKEN:'test-secret'},time);
  assert.equal(result.status,401);
  db.sql.close();
});
test('quiet hours make no request; 30 minute cache; an egg on the ground queues once per 2 hours',async()=>{
  const db=database();await connect(db);tasks(db);
  let calls=0;const ids=['old'];const fetcher=async()=>{calls++;return Response.json(scene(ids));};
  await patrol(db.env,Date.parse('2026-11-16T07:59:59+08:00'),fetcher);assert.equal(calls,0);
  const first=await patrol(db.env,time,fetcher);assert.equal(calls,1);assert.equal(first.queued,1);
  await patrol(db.env,time+29*60000,fetcher);assert.equal(calls,1);
  const repeat=await patrol(db.env,time+30*60000,fetcher);assert.equal(calls,2);assert.equal(repeat.queued,0);
  const status=await setting(db,'b','GET','g',time+30*60000);
  assert.equal(status.patrol[0].status,'produced');
  assert.equal(status.patrol[0].checkedAt,time+30*60000);
  const claimed=await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},time+30*60000);
  assert.equal(claimed.events.length,1);assert.equal(claimed.events[0].uid,'293143');
  assert.equal((await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},time+30*60000)).events.length,0);
  const event=claimed.events[0];
  assert.equal((await bot(db,'ack',{id:event.id,leaseToken:event.leaseToken,outcome:'sent'},time+30*60000)).status,200);
  await patrol(db.env,time+60*60000,fetcher);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM egg_patrol_notifications').get().n,1);
  db.sql.close();
});
test('force tick only works on the test deployment and skips the night window and 30 minute cache',async()=>{
  const db=database();await connect(db);tasks(db);
  let calls=0;const fetcher=async()=>{calls++;return Response.json(scene([]));};
  const night=Date.parse('2026-11-16T02:00:00+08:00');
  // 正式部署（CF_PAGES_BRANCH 不是 test）不接受强刷
  const denied=await bot(db,'tick',{force:true},night);
  assert.equal(denied.status,403);
  db.env.CF_PAGES_BRANCH='test';
  const first=await bot(db,'tick',{force:'1'},night,db.env.EGG_BOT_BRIDGE_TOKEN,fetcher);
  assert.equal(first.status,200);assert.equal(first.queried,1);assert.equal(calls,1);
  // 30 分钟缓存对强刷无效：同一 uid 立刻可以再刷
  const again=await bot(db,'tick',{force:true},night+60000,db.env.EGG_BOT_BRIDGE_TOKEN,fetcher);
  assert.equal(again.queried,1);assert.equal(calls,2);
  // 普通 tick 在窗口外仍然不动
  await bot(db,'tick',{},night+120000,db.env.EGG_BOT_BRIDGE_TOKEN,fetcher);assert.equal(calls,2);
  db.sql.close();
});
test('failed queries count quota, cancellation suppresses queued notification and disabling revokes lease',async()=>{
  const db=database();await connect(db);tasks(db);
  let calls=0;const bad=async()=>{calls++;return new Response('',{status:503});};
  await patrol(db.env,time,bad);assert.equal(calls,1);
  assert.equal(db.sql.prepare('SELECT used FROM egg_patrol_quota').get().used,1);
  await patrol(db.env,time+30*60000,async()=>Response.json(scene([])));
  await patrol(db.env,time+60*60000,async()=>Response.json(scene(['new'])));
  const row=db.sql.prepare('SELECT state_json FROM egg_matching_groups WHERE group_id=?').get('g');
  const state=JSON.parse(row.state_json);state.trades[0].status='cancelled';
  db.sql.prepare('UPDATE egg_matching_groups SET state_json=? WHERE group_id=?').run(JSON.stringify(state),'g');
  assert.equal((await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},time+60*60000)).events.length,0);
  await setting(db,'a','DELETE');
  assert.equal((await setting(db,'a','GET')).binding,null);
  db.sql.close();
});
test('UID shared across groups queries once and ambiguous egg is not assigned arbitrarily',async()=>{
  const db=database();await connect(db);await connect(db,'h');tasks(db);tasks(db,'h','other');
  let calls=0;let ids=[];const fetcher=async()=>{calls++;return Response.json(scene(ids));};
  await patrol(db.env,time,fetcher);assert.equal(calls,1);
  ids=['new'];await patrol(db.env,time+30*60000,fetcher);assert.equal(calls,2);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM egg_patrol_notifications').get().n,0);
  db.sql.close();
});
test('quota is capped atomically at 100 actual calls and resets on Beijing day; queued tasks stop overnight',async()=>{
  const db=database();await connect(db);tasks(db);
  db.sql.prepare('INSERT INTO egg_patrol_quota(day,used) VALUES(?,99)').run('2026-11-16');
  let calls=0;
  const fetcher=async()=>{calls++;return Response.json({code:0,data:{task_id:'fixture-task'}},{status:202});};
  await Promise.all([patrol(db.env,time,fetcher),patrol(db.env,time,fetcher)]);
  assert.equal(calls,1);
  await patrol(db.env,time+60000,fetcher);assert.equal(calls,1);
  await patrol(db.env,Date.parse('2026-11-17T00:30:00+08:00'),fetcher);assert.equal(calls,1);
  await patrol(db.env,Date.parse('2026-11-17T08:00:00+08:00'),async(url)=>{
    calls++;assert.match(String(url),/tasks\/fixture-task/);return Response.json(scene([]));
  });
  assert.equal(calls,2);
  assert.equal(db.sql.prepare('SELECT used FROM egg_patrol_quota WHERE day=?').get('2026-11-17').used,1);
  db.sql.close();
});
test('rebinding revokes the old lease and a re-created task reminds about an egg already on the ground',async()=>{
  const db=database();await connect(db);tasks(db);
  await patrol(db.env,time,async()=>Response.json(scene([])));
  await patrol(db.env,time+1800000,async()=>Response.json(scene(['new'])));
  const first=await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},time+1800000);
  assert.equal(first.events.length,1);
  await connect(db);
  assert.equal((await bot(db,'ack',{id:first.events[0].id,leaseToken:first.events[0].leaseToken,outcome:'sent'},time+1800001)).status,409);
  const state=JSON.parse(db.sql.prepare('SELECT state_json FROM egg_matching_groups').get().state_json);
  state.trades[0].id='replacement';db.sql.prepare('UPDATE egg_matching_groups SET state_json=?').run(JSON.stringify(state));
  const again=await patrol(db.env,time+3600000,async()=>Response.json(scene(['new','later'])));
  // 新任务不需要重置基线：地上的蛋会按新任务再提醒一次
  assert.equal(again.queued,2);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM egg_patrol_notifications').get().n,3);
  db.sql.close();
});
test('preflight rejects stale bindings and tasks before a claimed message is sent',async()=>{
  const db=database();await connect(db);tasks(db);
  await patrol(db.env,time,async()=>Response.json(scene([])));
  await patrol(db.env,time+1800000,async()=>Response.json(scene(['new'])));
  const claim=await bot(db,'claim',{botId:'654321',qqGroupId:'123456',groupId:'g'},time+1800000);
  const event=claim.events[0];
  const validate={id:event.id,leaseToken:event.leaseToken,botId:'654321',qqGroupId:'123456'};
  assert.equal((await bot(db,'validate',validate,time+1800001)).valid,true);
  assert.equal((await bot(db,'validate',{...validate,qqGroupId:'999999'},time+1800001)).valid,false);
  await setting(db,'a','DELETE');
  assert.equal((await bot(db,'validate',validate,time+1800002)).valid,false);
  db.sql.close();
});

test('changing the selected parents revokes a queued egg notice even with the same trade ID',async()=>{
  const db=database();await connect(db);tasks(db);
  await patrol(db.env,time,async()=>Response.json(scene([])));
  await patrol(db.env,time+1800000,async()=>Response.json(scene(['new'])));
  const state=JSON.parse(db.sql.prepare('SELECT state_json FROM egg_matching_groups').get().state_json);
  state.trades[0].line.fatherId='capture_293143_99999';
  db.sql.prepare('UPDATE egg_matching_groups SET state_json=?').run(JSON.stringify(state));
  assert.equal((await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},time+1800000)).events.length,0);
  assert.notEqual((await setting(db,'b','GET','g',time+1800000)).patrol[0].status,'produced');
  db.sql.close();
});

test('stale local subscriptions cannot lease notices belonging to the replacement binding',async()=>{
  const db=database();const old=await connect(db);tasks(db);
  const current=await connect(db);
  await patrol(db.env,time,async()=>Response.json(scene([])));
  await patrol(db.env,time+1800000,async()=>Response.json(scene(['new'])));
  assert.equal((await bot(db,'claim',{botId:'654321',qqGroupId:'123456',groupId:'g',bindingVersion:old.bindingVersion},time+1800000)).events.length,0);
  assert.equal((await bot(db,'claim',{botId:'654321',qqGroupId:'123456',groupId:'g',bindingVersion:current.bindingVersion},time+1800000)).events.length,1);
  db.sql.close();
});

test('async polling counts every request; incomplete snapshots preserve the last successful baseline',async()=>{
  const db=database();await connect(db);tasks(db);
  await patrol(db.env,time,async()=>Response.json(scene(['old'])));
  await patrol(db.env,time+1800000,async()=>Response.json({code:0,data:{task_id:'queued-1'}},{status:202}));
  await patrol(db.env,time+1860000,async(url)=>{
    assert.match(String(url),/tasks\/queued-1$/);return Response.json({code:0,data:{status:'running'}});
  });
  await patrol(db.env,time+1920000,async()=>Response.json({code:0,data:{home_scene_info:{snapshot_status:'partial',egg_count:0,eggs:[]}}}));
  assert.equal(JSON.parse(db.sql.prepare('SELECT scene_json FROM egg_patrol_cache').get().scene_json).eggs[0].actorId,'old');
  assert.equal(db.sql.prepare('SELECT used FROM egg_patrol_quota').get().used,4);
  await patrol(db.env,time+3720000,async()=>Response.json(scene(['old','new'])));
  // 旧蛋仍在 2 小时节流内，只补提醒新出现的蛋
  assert.equal(db.sql.prepare('SELECT count(*) n FROM egg_patrol_notifications').get().n,2);
  assert.equal(db.sql.prepare('SELECT used FROM egg_patrol_quota').get().used,5);
  db.sql.close();
});

test('pending upstream queries stop after cancellation and task facts remain private to both parties',async()=>{
  const db=database();await connect(db);tasks(db);
  db.sql.prepare('INSERT INTO mother_group_members(group_id,account_id,display_name,joined_at) VALUES(?,?,?,1)').run('g','c','c');
  await patrol(db.env,time,async()=>Response.json({code:0,data:{task_id:'queued-1'}},{status:202}));
  assert.equal((await setting(db,'c','GET')).patrol.length,0);
  assert.equal((await setting(db,'a','GET')).patrol.length,1);
  const state=JSON.parse(db.sql.prepare('SELECT state_json FROM egg_matching_groups').get().state_json);
  state.trades[0].status='cancelled';db.sql.prepare('UPDATE egg_matching_groups SET state_json=?').run(JSON.stringify(state));
  let calls=0;await patrol(db.env,time+60000,async()=>{calls++;return Response.json(scene([]));});
  assert.equal(calls,0);
  db.sql.close();
});

test('a task egg that stays on the ground reminds every 2 hours, at most 4 times a day, and stops when collected',async()=>{
  const db=database();await connect(db);tasks(db);
  let eggs=['egg1'];
  const fetcher=async()=>Response.json(scene(eggs));
  async function tick(at){
    const result=await patrol(db.env,at,fetcher);
    const claim=await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},at);
    for(const event of claim.events) await bot(db,'ack',{id:event.id,leaseToken:event.leaseToken,outcome:'sent'},at);
    return result.queued;
  }
  assert.equal(await tick(time),1);
  assert.equal(await tick(time+30*60000),0);
  assert.equal(await tick(time+60*60000),0);
  assert.equal(await tick(time+120*60000),1);
  assert.equal(await tick(time+150*60000),0);
  assert.equal(await tick(time+240*60000),1);
  assert.equal(await tick(time+360*60000),1);
  assert.equal(await tick(time+480*60000),0);
  assert.equal(await tick(time+600*60000),0);
  assert.equal(await tick(Date.parse('2026-11-17T08:00:00+08:00')),1);
  eggs=[];
  assert.equal(await tick(Date.parse('2026-11-17T08:30:00+08:00')),0);
  db.sql.close();
});
test('a queued notice is dropped when the egg is collected before delivery',async()=>{
  const db=database();await connect(db);tasks(db);
  let eggs=['egg1'];
  await patrol(db.env,time,async()=>Response.json(scene(eggs)));
  assert.equal(db.sql.prepare("SELECT count(*) n FROM egg_patrol_notifications WHERE status='pending'").get().n,1);
  eggs=[];
  const result=await patrol(db.env,time+30*60000,async()=>Response.json(scene(eggs)));
  assert.equal(result.queued,0);
  assert.equal(db.sql.prepare("SELECT count(*) n FROM egg_patrol_notifications WHERE status='pending'").get().n,0);
  assert.equal((await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},time+30*60000)).events.length,0);
  db.sql.close();
});


test('spot trades never trigger patrol, even when the egg is still at home',async()=>{
  const db=database();await connect(db);
  const give={id:'home-egg',accountId:'b',gameAccountKey:'uid:293143',eggGameId:3062,nature:'固执',body:'',voice:'',status:'available',location:'home',
    parents:{mother:{id:'capture_293143_64299',gameId:3062,name:'m',nature:'固执',body:'',voice:''},
      fathers:[{id:'capture_293143_64037',gameId:1,name:'f',nature:'固执',body:'',voice:''}],confirmed:false}};
  const trade={id:'home-trade',groupId:'g',demandId:'d',supplierAccountId:'b',demanderAccountId:'a',type:'spot',status:'accepted',placed:true,createdAt:1,give,receive:null};
  db.sql.prepare('INSERT INTO egg_matching_groups(group_id,state_json,updated_at) VALUES(?,?,1)').run('g',JSON.stringify({demands:[],eggs:[],trades:[trade],watermarks:{},orders:{}}));
  let calls=0;
  const result=await patrol(db.env,time,async()=>{calls++;return Response.json(scene(['home-egg']));});
  assert.equal(calls,0);
  assert.equal(result.queued,0);
  assert.equal((await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},time)).events.length,0);
  db.sql.close();
});

test('placement is detected from breeding pairs; the egg afterwards queues a notice',async()=>{
  const db=database();await connect(db);tasks(db);
  const pairs=[{female:{pet_gid:64299,furniture_guid_exact:'n1',pet_cfg_id:3062,nature:2,voice:100},
    male_partners:[{pet_gid:64037,furniture_guid_exact:'n2',pet_cfg_id:3744,nature:2,voice:100}]}];
  await patrol(db.env,time,async()=>Response.json(scene([],pairs)));
  assert.equal((await setting(db,'b','GET')).patrol[0].status,'placed');
  assert.equal(db.sql.prepare('SELECT count(*) n FROM egg_patrol_notifications').get().n,0);
  const result=await patrol(db.env,time+1800000,async()=>Response.json(scene(['egg1'],pairs)));
  assert.equal(result.queued,1);
  assert.equal((await setting(db,'b','GET')).patrol[0].status,'produced');
  db.sql.close();
});

async function reminder(db, account='a', now=time) {
  const version=db.sql.prepare('SELECT version FROM egg_matching_groups WHERE group_id=?').get('g').version;
  const response=await matching(new Request('https://local/api/collection-groups/g/egg-matching',{method:'POST',body:JSON.stringify({baseVersion:version,action:{type:'remind',id:'trade'}})}),db.env,null,account,'g',now);
  return {status:response.status,...await response.json()};
}
function remindable(db) {
  tasks(db);
  const state=JSON.parse(db.sql.prepare('SELECT state_json FROM egg_matching_groups').get().state_json);
  state.demands=[{id:'d',groupId:'g',demanderAccountId:'a',eggGameId:3062,natures:[],body:'',voice:'',quantity:1,fulfilled:0,status:'open'}];
  db.sql.prepare('UPDATE egg_matching_groups SET state_json=?').run(JSON.stringify(state));
  for(const [owner,uid] of [['a','345678'],['b','293143']]) db.sql.prepare('INSERT INTO mother_group_accounts(group_id,game_account_key,member_account_id,account_name,source_exported_at,egg_game_ids) VALUES(?,?,?,?,?,?)').run('g','uid:'+uid,owner,owner,'2026-11-17','[]');
}
test('a manual reminder queues once at night without patrol quota and permits another click only after 30 minutes',async()=>{
  const db=database();await connect(db);remindable(db);
  const night=Date.parse('2026-11-17T01:00:00+08:00');
  const first=await reminder(db,'a',night);assert.equal(first.status,200);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM egg_patrol_notifications').get().n,1);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM egg_patrol_quota').get().n,0);
  const claimed=await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},night);
  assert.equal(claimed.events.length,1);assert.equal(claimed.events[0].kind,'reminder');
  assert.equal(claimed.events[0].uid,'293143');assert.equal(claimed.events[0].requesterName,'a');
  const event=claimed.events[0];
  assert.equal((await bot(db,'validate',{id:event.id,leaseToken:event.leaseToken,botId:'654321',qqGroupId:'123456'},night+1)).valid,true);
  assert.equal((await reminder(db,'a',night+1799999)).status,400);
  await bot(db,'ack',{id:event.id,leaseToken:event.leaseToken,outcome:'sent'},night+2);
  assert.equal((await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},night+1800000)).events.length,0);
  assert.equal((await reminder(db,'b',night+1800000)).status,200);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM egg_patrol_notifications').get().n,2);
  const other=await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},night+1800000);
  assert.equal(other.events[0].uid,'345678');
  db.sql.close();
});
test('manual reminder failures and expired send leases never auto-send again; a cancelled task revokes delivery',async()=>{
  for(const outcome of ['failed','unbound','expired','cancelled']) {
    const db=database();await connect(db);remindable(db);
    await reminder(db);
    const claim=await bot(db,'claim',{botId:'654321',qqGroupId:'123456'});
    assert.equal(claim.events.length,1);const event=claim.events[0];
    if(outcome==='cancelled') {
      const state=JSON.parse(db.sql.prepare('SELECT state_json FROM egg_matching_groups').get().state_json);
      state.trades[0].status='cancelled';db.sql.prepare('UPDATE egg_matching_groups SET state_json=?').run(JSON.stringify(state));
      assert.equal((await bot(db,'validate',{id:event.id,leaseToken:event.leaseToken,botId:'654321',qqGroupId:'123456'},time+1)).valid,false);
    } else if(outcome!=='expired') await bot(db,'ack',{id:event.id,leaseToken:event.leaseToken,outcome});
    assert.equal((await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},time+3600000)).events.length,0);
    db.sql.close();
  }
});
test('disconnected group and missing recipient UID do not consume manual reminder cooldown',async()=>{
  const db=database();remindable(db);
  const first=await reminder(db);assert.equal(first.status,400);assert.match(first.error,/群|机器人/);
  await connect(db);
  db.sql.exec("DELETE FROM mother_group_accounts;");
  const state=JSON.parse(db.sql.prepare('SELECT state_json FROM egg_matching_groups').get().state_json);delete state.trades[0].line;state.trades[0].legacy=true;
  db.sql.prepare('UPDATE egg_matching_groups SET state_json=?').run(JSON.stringify(state));
  const missing=await reminder(db);assert.equal(missing.status,400);assert.match(missing.error,/UID|账号/);
  assert.equal(JSON.parse(db.sql.prepare('SELECT state_json FROM egg_matching_groups').get().state_json).trades[0].reminderAt,undefined);
  db.sql.close();
});
