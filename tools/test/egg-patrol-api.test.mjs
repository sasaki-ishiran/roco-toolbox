import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
let settings, bridge, patrol;
try {
  ({ handleEggBotSettings: settings, handleEggBotBridge: bridge } = await vite.ssrLoadModule('/functions/_lib/eggBotBridge.ts'));
  ({ runEggPatrol: patrol } = await vite.ssrLoadModule('/functions/_lib/eggPatrol.ts'));
} finally { await vite.close(); }

const time = Date.parse('2026-11-16T08:00:00+08:00');
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync('functions/schema.sql', 'utf8'));
  sql.exec(readFileSync('functions/migrations/2026-11-16-egg-matching.sql', 'utf8'));
  sql.exec(readFileSync('functions/migrations/2026-11-16-egg-patrol.sql', 'utf8'));
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
async function bot(db,action,body={},now=time,token=db.env.EGG_BOT_BRIDGE_TOKEN){
  const response=await bridge(new Request('https://local/api/egg-bot/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}),db.env,now);
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
const scene=(ids=[])=>({code:0,data:{home_scene_info:{snapshot_status:'valid',egg_count:ids.length,eggs:ids.map(id=>({actor_id:id,nest_furniture_guid:'5170452278714212143',
  mother_candidate:{pet_gid:64299,furniture_guid_exact:'5170452278714212143'},father_candidates:[{pet_gid:64037,furniture_guid_exact:'453835583565763747'}],biological_parentage_confirmed:false}))}}});

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
test('quiet hours make no request; first baseline, 30 minute cache, actual new egg queues once',async()=>{
  const db=database();await connect(db);tasks(db);
  let calls=0;let ids=['old'];const fetcher=async()=>{calls++;return Response.json(scene(ids));};
  await patrol(db.env,Date.parse('2026-11-16T07:59:59+08:00'),fetcher);assert.equal(calls,0);
  await patrol(db.env,time,fetcher);assert.equal(calls,1);
  ids=['old','new'];await patrol(db.env,time+29*60000,fetcher);assert.equal(calls,1);
  const result=await patrol(db.env,time+30*60000,fetcher);assert.equal(calls,2);assert.equal(result.queued,1);
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
test('new task must establish its own baseline and changing group revokes old notification lease',async()=>{
  const db=database();await connect(db);tasks(db);
  await patrol(db.env,time,async()=>Response.json(scene([])));
  await patrol(db.env,time+1800000,async()=>Response.json(scene(['new'])));
  const first=await bot(db,'claim',{botId:'654321',qqGroupId:'123456'},time+1800000);
  assert.equal(first.events.length,1);
  await connect(db);
  assert.equal((await bot(db,'ack',{id:first.events[0].id,leaseToken:first.events[0].leaseToken,outcome:'sent'},time+1800001)).status,409);
  const state=JSON.parse(db.sql.prepare('SELECT state_json FROM egg_matching_groups').get().state_json);
  state.trades[0].id='replacement';db.sql.prepare('UPDATE egg_matching_groups SET state_json=?').run(JSON.stringify(state));
  await patrol(db.env,time+3600000,async()=>Response.json(scene(['new','later'])));
  assert.equal(db.sql.prepare('SELECT count(*) n FROM egg_patrol_notifications').get().n,1);
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
  assert.equal(db.sql.prepare('SELECT count(*) n FROM egg_patrol_notifications').get().n,1);
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
