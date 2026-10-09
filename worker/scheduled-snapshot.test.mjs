import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runContractDeadlineCheck,runWeeklyCallPackDrafts,runAutomationsEngine,logSystemAlert} from './worker.js';
import {encodeSnapshot,decodeSnapshot,SNAPSHOT_GZIP_PREFIX} from './snapshot-codec.mjs';

const MONDAY=Date.parse('2026-10-05T12:00:00.000Z');
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);');
 const data={contacts:[{id:'c1',name:'Existing client',status:'Client',rate_locked_until:'2026-10-01',notice_days:40},{id:'sample',name:'Sample fictional contact',is_sample:true,status:'Not contacted',services:[]}],todos:[],reminders:[],notes:[],activity:[],autolog:[],automations:[{id:'rule1',name:'Client onboarding',enabled:true,on:'contact_status',status:'Client',do:'task',title:'Review {client}',module:'03'}]};
 sql.prepare('INSERT INTO crm_snapshot VALUES(?,?,?,?)').run('org1',JSON.stringify(data),'2026-10-05T10:00:00.000Z','owner');
 const wrap=(s,v=[])=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});
 const env={DB:{prepare(q){const s=sql.prepare(q);return {...wrap(s),bind(...v){return wrap(s,v);}};}}};
 return {sql,env,data};
}

const engines=[['contract notice',runContractDeadlineCheck],['weekly call pack',runWeeklyCallPackDrafts],['automation',runAutomationsEngine],['system alert',env=>logSystemAlert(env,'Test job','Example failure')]];
for(const [name,engine] of engines)test(name+' skips a stale snapshot rather than overwriting a concurrent contact/sample update',async t=>{
 t.mock.timers.enable({apis:['Date'],now:MONDAY});const f=fixture();let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw Error('Scheduled snapshot tests must not call providers');});
 try{
  const prepare=f.env.DB.prepare;let intervened=false;
  f.env.DB.prepare=q=>{
   const prepared=prepare(q);if(!q.startsWith('UPDATE crm_snapshot SET data=?'))return prepared;
   return {...prepared,bind(...v){const bound=prepared.bind(...v);return {...bound,async run(){
    if(!intervened){intervened=true;const current=JSON.parse(f.sql.prepare('SELECT data FROM crm_snapshot').get().data);current.contacts[0].name='Newer real contact name';current.contacts.push({id:'new-sample',name:'Newer fictional sample',is_sample:true});f.sql.prepare('UPDATE crm_snapshot SET data=?,updated_at=?,updated_by=?').run(JSON.stringify(current),'2026-10-05T12:00:01.000Z','owner');}
    return bound.run();
   }};}};
  };
  const result=await engine(f.env);assert.equal(intervened,true);const row=f.sql.prepare('SELECT * FROM crm_snapshot').get(),saved=JSON.parse(row.data);
  assert.equal(saved.contacts[0].name,'Newer real contact name');assert.ok(saved.contacts.some(c=>c.id==='new-sample'));assert.equal(saved.todos.length,0);assert.equal(saved.notes.length,0);assert.equal(saved.reminders.length,0);assert.equal(row.updated_by,'owner');assert.equal(row.updated_at,'2026-10-05T12:00:01.000Z');if(result)assert.equal(result[0].skipped,'workspace-changed');assert.equal(network,0);
 }finally{f.sql.close();}
});
test('scheduled engines save canonical derived records once and monotonically advance the workspace token',async t=>{
 t.mock.timers.enable({apis:['Date'],now:MONDAY});const f=fixture();try{
  const versions=[];
  for(const [,engine] of engines){await engine(f.env);versions.push(f.sql.prepare('SELECT updated_at FROM crm_snapshot').get().updated_at);}
  assert.equal(new Set(versions).size,4);assert.deepEqual([...versions].sort(),versions);
  let data=JSON.parse(f.sql.prepare('SELECT data FROM crm_snapshot').get().data);assert.equal(data.todos.length,1);assert.equal(data.notes.length,1);assert.equal(data.reminders.length,3);assert.equal(data.notes[0].entity_id,'c1');assert.ok(data.reminders.every(r=>r.contact_id!=='sample'));assert.ok(data.todos.every(r=>r.contact_id!=='sample'));
  for(const [,engine] of engines.slice(0,3))await engine(f.env);data=JSON.parse(f.sql.prepare('SELECT data FROM crm_snapshot').get().data);assert.equal(data.todos.length,1);assert.equal(data.notes.length,1);assert.equal(data.reminders.length,3);
 }finally{f.sql.close();}
});

test('all four scheduled engines decode and save compressed snapshots without losing imported records',async t=>{
 t.mock.timers.enable({apis:['Date'],now:MONDAY});const f=fixture();let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw Error('No provider calls allowed');});
 try {
  f.data.imported_source_notes='Illustrative original imported information — مثال. '.repeat(24000);
  f.sql.prepare('UPDATE crm_snapshot SET data=?').run(await encodeSnapshot(JSON.stringify(f.data)));
  const versions=[];
  for(const [,engine]of engines){await engine(f.env);const saved=f.sql.prepare('SELECT data,updated_at FROM crm_snapshot').get();assert.ok(saved.data.startsWith(SNAPSHOT_GZIP_PREFIX));versions.push(saved.updated_at);const db=await decodeSnapshot(saved.data);assert.equal(db.imported_source_notes,f.data.imported_source_notes);assert.equal(db.contacts.length,2);}
  assert.equal(new Set(versions).size,4);const final=await decodeSnapshot(f.sql.prepare('SELECT data FROM crm_snapshot').get().data);assert.equal(final.todos.length,1);assert.equal(final.notes.length,1);assert.equal(final.reminders.length,3);assert.equal(network,0);
 } finally {f.sql.close();}
});

for(const [name,engine]of engines)test(name+' respects CAS races while reading compressed data',async t=>{
 t.mock.timers.enable({apis:['Date'],now:MONDAY});const f=fixture();
 try {
  f.data.imported_source_notes='Preserve imported record context. '.repeat(40000);
  f.sql.prepare('UPDATE crm_snapshot SET data=?').run(await encodeSnapshot(JSON.stringify(f.data)));
  const prepare=f.env.DB.prepare;let intervened=false;
  f.env.DB.prepare=q=>{const prepared=prepare(q);if(!q.startsWith('UPDATE crm_snapshot SET data=?'))return prepared;return{...prepared,bind(...v){const bound=prepared.bind(...v);return{...bound,async run(){if(!intervened){intervened=true;const current=await decodeSnapshot(f.sql.prepare('SELECT data FROM crm_snapshot').get().data);current.contacts.push({id:'newer',name:'Fictional newer contact'});f.sql.prepare('UPDATE crm_snapshot SET data=?,updated_at=?').run(await encodeSnapshot(JSON.stringify(current)),'2026-10-05T12:00:01.000Z');}return bound.run();}};}};};
  await engine(f.env);const db=await decodeSnapshot(f.sql.prepare('SELECT data FROM crm_snapshot').get().data);assert.equal(intervened,true);assert.ok(db.contacts.some(c=>c.id==='newer'));assert.equal(db.imported_source_notes,f.data.imported_source_notes);assert.equal(db.todos.length,0);assert.equal(db.notes.length,0);
 } finally {f.sql.close();}
});
