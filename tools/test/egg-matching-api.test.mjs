import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
let route;
let collectionRoute;
let leaveGroup;
let removeMember;
try { ({ handleEggMatching: route } = await vite.ssrLoadModule('/functions/_lib/eggMatching.ts'));({leaveCollectionGroup:leaveGroup,removeCollectionGroupMember:removeMember}=await vite.ssrLoadModule('/functions/_lib/collectionGroupsStore.ts')); }
finally { await vite.close(); }

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync('functions/schema.sql', 'utf8'));
  sql.exec(readFileSync('functions/migrations/2026-11-16-egg-matching.sql', 'utf8'));
  for (const account of ['a', 'b', 'c']) sql.prepare('INSERT INTO accounts (id, created_at, last_seen_at, recovery_hash) VALUES (?,1,1,?)').run(account, account);
  sql.prepare('INSERT INTO mother_groups (id,owner_account_id,name,invite_hash,created_at) VALUES (?,?,?,?,1)').run('g', 'a', '组', 'invite');
  for (const account of ['a', 'b']) sql.prepare('INSERT INTO mother_group_members (group_id,account_id,display_name,joined_at) VALUES (?,?,?,1)').run('g', account, account);
  const prepare = (query) => {
    let params = [];
    const result = { bind(...values) { params = values; return result; },
      async first() { return sql.prepare(query).get(...params) ?? null; },
      async all() { return { success: true, results: sql.prepare(query).all(...params) }; },
      async run() { const r = sql.prepare(query).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; } };
    return result;
  };
  return { sql, DB: { prepare, async batch(statements) { sql.exec('BEGIN'); try { const r = []; for (const s of statements) r.push(await s.run()); sql.exec('COMMIT'); return r; } catch (e) { sql.exec('ROLLBACK'); throw e; } } } };
}
async function call(db, account, method = 'GET', body, groupId='g') {
  const request = new Request('http://localhost/api/collection-groups/g/egg-matching', { method,
    ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
  const response = await route(request, { DB: db.DB }, null, account, groupId);
  return { status: response.status, body: await response.json() };
}
test('membership and atomic version checks guard every read and write', async () => {
  const db = database();
  assert.equal((await call(db, 'c')).status, 403);
  const first = await call(db, 'a');
  assert.equal(first.status, 200);
  const action = { type: 'publish', demand: { id: 'd', eggGameId: 3227, natures: ['固执','保守'], body: '', voice: '', quantity: 2 } };
  assert.equal((await call(db, 'a', 'POST', { baseVersion: first.body.version, action })).status, 200);
  assert.equal((await call(db, 'b', 'POST', { baseVersion: first.body.version, action })).status, 409);
  const read = await call(db, 'b');
  assert.deepEqual(read.body.state.demands[0].natures, ['固执','保守']);
  assert.equal(read.body.state.demands[0].gender, undefined);
  db.sql.close();
});
test('migration runs once and hides private stock while preserving legacy claimed tasks', async () => {
  const db = database();
  db.sql.prepare("INSERT INTO collection_group_demands (group_id,demander_account_id,egg_game_id,nature,gender,body,voice,status,claimer_account_id,created_at,updated_at) VALUES ('g','a',3227,'固执','母','','','claimed','b',1,1)").run();
  const first = await call(db, 'a');
  assert.equal(first.body.state.demands.length, 1);
  assert.equal(first.body.state.trades[0].supplierAccountId, 'b');
  const written = await call(db, 'a', 'POST', { baseVersion: first.body.version, action: { type: 'stock-sync', gameAccountKey: 'uid:1', capturedAt: 1, complete: true, eggs: [{ id: 'e', eggGameId: 3227, kind: 'ordinary' }] } });
  assert.equal(written.status, 200);
  assert.equal(written.body.state.eggs.length, 1);
  assert.equal((await call(db, 'b')).body.state.eggs.length, 0);
  assert.equal((await call(db, 'a')).body.state.demands.length, 1);
  db.sql.close();
});

test('an unrelated former-member proposal does not freeze the group', async()=>{
  const db=database();
  await call(db,'a');
  const row=db.sql.prepare('SELECT state_json FROM egg_matching_groups WHERE group_id=?').get('g');
  const state=JSON.parse(row.state_json);
  state.trades.push({id:'orphan',groupId:'g',demandId:'d',demanderAccountId:'a',supplierAccountId:'c',status:'proposed',give:{},receive:null});
  db.sql.prepare('UPDATE egg_matching_groups SET state_json=? WHERE group_id=?').run(JSON.stringify(state),'g');
  const result=await call(db,'a','POST',{baseVersion:0,action:{type:'publish',demand:{id:'new',eggGameId:3227,natures:[],body:'',voice:'',quantity:1}}});
  assert.equal(result.status,200);
  db.sql.close();
});

test('the same captured egg cannot be accepted in two groups, including transaction rollback', async()=>{
  const db=database();
  db.sql.prepare("INSERT INTO mother_groups (id,owner_account_id,name,invite_hash,created_at) VALUES ('h','a','组2','invite2',1)").run();
  for(const a of ['a','b'])db.sql.prepare("INSERT INTO mother_group_members (group_id,account_id,display_name,joined_at) VALUES ('h',?,?,1)").run(a,a);
  const write=async(group,actor,action)=>{const read=await call(db,actor,'GET',undefined,group);return call(db,actor,'POST',{baseVersion:read.body.version,action},group);};
  for(const group of ['g','h']){
    await write(group,'a',{type:'publish',demand:{id:'d',eggGameId:3227,natures:[],body:'',voice:'',quantity:1}});
    for(const [actor,id,species] of [['a','back',3436],['b','give',3227]])await write(group,actor,{type:'stock-sync',gameAccountKey:'uid:1',capturedAt:1,complete:true,eggs:[{id,eggGameId:species,kind:'ordinary'}]});
    await write(group,'a',{type:'list',id:'back',listed:true});
    await write(group,'b',{type:'propose',id:'t',demandId:'d',giveId:'give',receiveId:'back'});
  }
  assert.equal((await write('g','a',{type:'accept',id:'t'})).status,200);
  const before=await call(db,'a','GET',undefined,'h');
  assert.equal((await write('h','a',{type:'accept',id:'t'})).status,409);
  const after=await call(db,'a','GET',undefined,'h');
  assert.equal(after.body.version,before.body.version);
  assert.equal(after.body.state.trades[0].status,'proposed');
  db.sql.close();
});

test('initialized workflows project the legacy feed and reject legacy writes',async()=>{
  const server=await createServer({server:{middlewareMode:true},appType:'custom'});
  try{({handleCollectionGroups:collectionRoute}=await server.ssrLoadModule('/functions/_lib/collectionGroups.ts'));}finally{await server.close();}
  const db=database();
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('test-local-token'));
  db.sql.prepare('INSERT INTO tokens(token_hash,account_id,created_at,last_used_at) VALUES (?,?,1,1)').run(Buffer.from(hash).toString('hex'),'a');
  let result=await call(db,'a');
  await call(db,'a','POST',{baseVersion:result.body.version,action:{type:'publish',demand:{id:'new-demand',eggGameId:3227,natures:['固执'],body:'',voice:'',quantity:2}}});
  const invoke=async(method,path)=>{const r=await collectionRoute(new Request('http://localhost/api/collection-groups/g/'+path,{method,headers:{Authorization:'Bearer test-local-token','Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})}),{DB:db.DB},null);return {status:r.status,body:await r.json()};};
  const fingerprint=(await invoke('GET','version')).body.demands;
  const current=await call(db,'a');
  await call(db,'a','POST',{baseVersion:current.body.version,action:{type:'withdraw',id:'new-demand'}});
  assert.notEqual((await invoke('GET','version')).body.demands,fingerprint);
  await call(db,'a','POST',{baseVersion:current.body.version+1,action:{type:'publish',demand:{id:'new-demand-2',eggGameId:3227,natures:['固执'],body:'',voice:'',quantity:2}}});
  const feed=await invoke('GET','demands');
  assert.equal(feed.status,200);
  assert.equal(feed.body.demands[0].eggGameId,3227);
  assert.equal((await invoke('POST','demands')).status,409);
  assert.equal((await invoke('POST','plans')).status,409);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM collection_group_demands').get().n,0);
  db.sql.close();
});

test('parent reservations enforce two partners and one academy resident across groups',async()=>{
  const db=database();
  for(const group of ['h','i']){
    db.sql.prepare('INSERT INTO mother_groups(id,owner_account_id,name,invite_hash,created_at) VALUES (?,?,?,?,1)').run(group,'a',group,group);
    for(const a of ['a','b'])db.sql.prepare('INSERT INTO mother_group_members(group_id,account_id,display_name,joined_at) VALUES (?,?,?,1)').run(group,a,a);
  }
  const write=async(group,actor,action)=>{const read=await call(db,actor,'GET',undefined,group);return call(db,actor,'POST',{baseVersion:read.body.version,action},group);};
  const setup=async(group,mother,father)=>{
    await write(group,'a',{type:'publish',demand:{id:'d',eggGameId:3227,natures:[],body:'',voice:'',quantity:1}});
    await write(group,'a',{type:'stock-sync',gameAccountKey:'uid:1',capturedAt:1,complete:true,eggs:[{id:'back-'+group,eggGameId:3436,kind:'ordinary'}]});
    await write(group,'a',{type:'list',id:'back-'+group,listed:true});
    await write(group,'b',{type:'propose',id:'t',demandId:'d',receiveId:'back-'+group,line:{eggGameId:3227,nature:'固执',body:'',voice:'',gameAccountKey:'uid:2',motherId:mother,fatherId:father,greenParentId:father}});
  };
  await setup('g','m1','f');await setup('h','m2','f');await setup('i','m3','other');
  assert.equal((await write('g','a',{type:'accept',id:'t'})).status,200);
  assert.equal((await write('h','a',{type:'accept',id:'t'})).status,200);
  assert.equal((await write('i','a',{type:'accept',id:'t'})).status,409);
  db.sql.close();
});

test('migration retries if a legacy request commits while its snapshot is being read',async()=>{
  const db=database();
  let injected=false;
  const original=db.DB.prepare;
  db.DB.prepare=(query)=>{
    const statement=original(query),run=statement.run;
    statement.run=async()=>{
      if(!injected&&query.startsWith('INSERT INTO egg_matching_groups')){
        injected=true;
        db.sql.prepare("INSERT INTO collection_group_demands(group_id,demander_account_id,egg_game_id,nature,gender,body,voice,status,created_at,updated_at) VALUES ('g','a',3227,'固执','母','','','open',1,1)").run();
      }
      return run();
    };
    return statement;
  };
  const response=await call(db,'a');
  assert.equal(response.status,200);
  assert.equal(response.body.state.demands.length,1);
  assert.throws(()=>db.sql.prepare("UPDATE collection_group_demands SET nature='保守' WHERE group_id='g'").run(),/upgraded/i);
  db.sql.close();
});

test('leaving an upgraded group cancels obligations and releases reservations without damaging history',async()=>{
  const db=database();
  db.sql.prepare("INSERT INTO collection_group_demands(group_id,demander_account_id,egg_game_id,nature,gender,body,voice,status,created_at,updated_at) VALUES ('g','b',3436,'固执','母','','','open',1,1)").run();
  const write=async(actor,action)=>{const read=await call(db,actor);return call(db,actor,'POST',{baseVersion:read.body.version,action});};
  await write('a',{type:'publish',demand:{id:'d',eggGameId:3227,natures:[],body:'',voice:'',quantity:1}});
  for(const [actor,id,game] of [['a','back',3436],['b','give',3227]])await write(actor,{type:'stock-sync',gameAccountKey:'uid:1',capturedAt:1,complete:true,eggs:[{id,eggGameId:game}]});
  await write('a',{type:'list',id:'back',listed:true});await write('b',{type:'propose',id:'t',demandId:'d',giveId:'give',receiveId:'back'});await write('a',{type:'accept',id:'t'});
  await write('b',{type:'stock-sync',gameAccountKey:'uid:1',capturedAt:2,complete:true,eggs:[]});
  await leaveGroup(db.DB,'g','b');
  const stored=JSON.parse(db.sql.prepare("SELECT state_json FROM egg_matching_groups WHERE group_id='g'").get().state_json);
  assert.equal(stored.eggs.some(e=>e.id==='give'),false);
  const state=(await call(db,'a')).body.state;
  assert.equal(state.trades[0].status,'cancelled');
  assert.equal(state.eggs[0].status,'available');
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM egg_matching_locks WHERE group_id=?').get('g').n,0);
  assert.equal((await call(db,'b')).status,403);
  db.sql.close();
});

test('removing a legacy plan owner cascades offers by remaining members',async()=>{
  const db=database();
  db.sql.prepare("INSERT INTO collection_plans(id,group_id,member_account_id,egg_game_id,status,created_at,updated_at) VALUES ('old','g','b',3227,'backlog',1,1)").run();
  db.sql.prepare("INSERT INTO plan_offers(id,group_id,plan_id,offer_account_id,created_at,updated_at) VALUES ('offer','g','old','a',1,1)").run();
  await call(db,'a');
  await leaveGroup(db.DB,'g','b');
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM plan_offers').get().n,0);
  db.sql.close();
});


test('allocated real hatch eggs stay locked across groups and after receipt',async()=>{
  const db=database();
  db.sql.prepare("INSERT INTO mother_groups(id,owner_account_id,name,invite_hash,created_at) VALUES ('h','a','另组','h',1)").run();
  for(const a of ['a','b'])db.sql.prepare("INSERT INTO mother_group_members(group_id,account_id,display_name,joined_at) VALUES ('h',?,?,1)").run(a,a);
  const write=async(group,actor,action)=>{const read=await call(db,actor,'GET',undefined,group);return call(db,actor,'POST',{baseVersion:read.body.version,action},group);};
  for(const group of ['g','h']){
    await write(group,'a',{type:'publish',demand:{id:'d',eggGameId:3227,natures:['固执'],body:'',voice:'',quantity:1}});
    await write(group,'a',{type:'stock-sync',gameAccountKey:'uid:1',capturedAt:1,complete:true,eggs:[{id:'back-'+group,eggGameId:3436}]});
    await write(group,'a',{type:'list',id:'back-'+group,listed:true});
    await write(group,'b',{type:'stock-sync',gameAccountKey:'uid:2',capturedAt:1,complete:true,eggs:[{id:'hatched',eggGameId:3227,nature:'固执'}]});
  }
  await write('g','b',{type:'propose',id:'t',demandId:'d',receiveId:'back-g',line:{eggGameId:3227,nature:'固执',body:'',voice:'',gameAccountKey:'uid:2',motherId:'m',fatherId:'f'}});
  assert.equal((await write('g','a',{type:'accept',id:'t'})).status,200);
  assert.equal((await write('g','b',{type:'place',id:'t'})).status,200);
  assert.equal((await write('g','b',{type:'allocate',id:'t',eggId:'hatched'})).status,200);
  await write('h','b',{type:'propose',id:'other',demandId:'d',giveId:'hatched',receiveId:'back-h'});
  assert.equal((await write('h','a',{type:'accept',id:'other'})).status,409);
  assert.equal((await write('g','a',{type:'receive',id:'t'})).status,200);
  assert.equal((await write('h','a',{type:'accept',id:'other'})).status,409);
  assert.equal(db.sql.prepare("SELECT status FROM egg_matching_locks WHERE resource_id='egg:hatched'").get().status,'transferred');
  db.sql.close();
});

test('deleting an upgraded group cascades all workflow locks without fence failures',async()=>{
  const db=database();
  db.sql.prepare("INSERT INTO collection_group_demands(group_id,demander_account_id,egg_game_id,nature,gender,body,voice,status,created_at,updated_at) VALUES ('g','a',3227,'固执','母','','','open',1,1)").run();
  await call(db,'a');
  assert.doesNotThrow(()=>db.sql.prepare("DELETE FROM mother_groups WHERE id='g'").run());
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM egg_matching_groups').get().n,0);
  db.sql.close();
});


test('a legacy write overtaken by migration reports an upgrade conflict instead of server failure',async()=>{
  const server=await createServer({server:{middlewareMode:true},appType:'custom'});
  try{({handleCollectionGroups:collectionRoute}=await server.ssrLoadModule('/functions/_lib/collectionGroups.ts'));}finally{await server.close();}
  const db=database();
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('race-local-token'));
  db.sql.prepare('INSERT INTO tokens(token_hash,account_id,created_at,last_used_at) VALUES (?,?,1,1)').run(Buffer.from(hash).toString('hex'),'a');
  const original=db.DB.prepare;let injected=false;
  db.DB.prepare=(query)=>{
    if(!injected&&query.startsWith('SELECT 1 AS ready FROM egg_matching_groups')){
      const statement=original(query);
      statement.first=async()=>{injected=true;await call(db,'a');return null;};
      return statement;
    }
    return original(query);
  };
  const response=await collectionRoute(new Request('http://localhost/api/collection-groups/g/demands',{method:'POST',headers:{Authorization:'Bearer race-local-token','Content-Type':'application/json'},body:JSON.stringify({eggGameId:3227,natures:['固执'],gender:'母',body:'',voice:''})}),{DB:db.DB},null);
  assert.equal(response.status,409);assert.equal((await response.json()).code,'WORKFLOW_UPGRADED');
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM collection_group_demands').get().n,0);
  db.sql.close();
});


test('oversized group state is rejected atomically without dropping existing history',async()=>{
 const db=database();await call(db,'a');
 const state=JSON.parse(db.sql.prepare("SELECT state_json FROM egg_matching_groups WHERE group_id='g'").get().state_json);
 state.orders[JSON.stringify('archived-account')]=['h'.repeat(1600000)];
 db.sql.prepare("UPDATE egg_matching_groups SET state_json=? WHERE group_id='g'").run(JSON.stringify(state));
 const result=await call(db,'a','POST',{baseVersion:0,action:{type:'publish',demand:{id:'new',eggGameId:3227,natures:[],body:'',voice:'',quantity:1}}});
 assert.equal(result.status,413);
 const after=db.sql.prepare("SELECT version,state_json FROM egg_matching_groups WHERE group_id='g'").get();
 assert.equal(after.version,0);assert.equal(JSON.parse(after.state_json).demands.length,0);
 assert.equal(JSON.parse(after.state_json).orders[JSON.stringify('archived-account')][0].length,1600000);
 db.sql.close();
});

test('untyped claimed obligations become private cancelled history while original rows remain intact',async()=>{
 const db=database();
 db.sql.prepare("INSERT INTO collection_group_demands(group_id,demander_account_id,egg_game_id,nature,gender,body,voice,status,claimer_account_id,created_at,updated_at) VALUES ('g','a',-4,'开朗','公','','','claimed','b',1,1)").run();
 const result=await call(db,'a');
 assert.equal(result.status,200);
 assert.equal(result.body.state.demands.length,0);
 assert.equal(result.body.state.trades.length,0);
 assert.equal(result.body.state.legacyHistory.length,1);
 assert.equal(result.body.state.legacyHistory[0].status,'cancelled');
 assert.equal((await call(db,'b')).body.state.legacyHistory.length,1);
 db.sql.prepare("INSERT INTO mother_group_members(group_id,account_id,display_name,joined_at) VALUES ('g','c','丙',1)").run();
 assert.deepEqual((await call(db,'c')).body.state.legacyHistory,[]);
 assert.equal(db.sql.prepare("SELECT status FROM collection_group_demands WHERE egg_game_id=-4").get().status,'claimed');
 assert.equal(db.sql.prepare('SELECT count(*) AS n FROM egg_matching_locks').get().n,0);
 db.sql.close();
});
