import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {encodeSnapshot,decodeSnapshot,decodeSnapshotText,SNAPSHOT_GZIP_PREFIX,MAX_SNAPSHOT_BYTES} from './snapshot-codec.mjs';
import {writeSnapshot,snapshotEtag} from './snapshot-store.mjs';
import {handleDbBlobRequest,matchContactByPhone,mutateOrgSnapshot} from './worker.js';
import {randomBytes} from 'node:crypto';

test('small legacy snapshots remain byte-identical and readable',async()=>{
  const text='{"contacts":[{"name":"Fictional Person — مثال"}]}';
  assert.equal(await encodeSnapshot(text),text);assert.deepEqual(await decodeSnapshot(text),JSON.parse(text));
});
test('large UTF-8 JSON round trips through bounded gzip/base64, without losing raw source fields',async()=>{
  const db={contacts:Array.from({length:7000},(_,i)=>({id:'fictional_'+i,name:'Example — مثال 🏡',notes:'Illustrative note'.repeat(15),phone:'+15555550000',tags:['original tag']}))};
  const text=JSON.stringify(db),stored=await encodeSnapshot(text);
  assert.ok(stored.startsWith(SNAPSHOT_GZIP_PREFIX));assert.ok(stored.length<Buffer.byteLength(text)/3);
  assert.equal(await decodeSnapshotText(stored),text);assert.deepEqual(await decodeSnapshot(stored),db);
});
test('corrupted base64, gzip, JSON and declared lengths fail closed',async()=>{
  for(const value of [SNAPSHOT_GZIP_PREFIX+'20:$$$$',SNAPSHOT_GZIP_PREFIX+'20:AAAA',SNAPSHOT_GZIP_PREFIX+'NaN:AAAA','{broken'])await assert.rejects(decodeSnapshot(value),e=>e.code==='SNAPSHOT_CORRUPTED');
  const valid=await encodeSnapshot(JSON.stringify({notes:'abc'.repeat(400000)}));
  const [length,data]=valid.slice(SNAPSHOT_GZIP_PREFIX.length).split(':');
  await assert.rejects(decodeSnapshot(SNAPSHOT_GZIP_PREFIX+(Number(length)+1)+':'+data),e=>e.code==='SNAPSHOT_CORRUPTED');
  await assert.rejects(decodeSnapshot(SNAPSHOT_GZIP_PREFIX+'20:'+data),e=>e.code==='SNAPSHOT_TOO_LARGE');
});
test('oversized declared or decompressed data is bounded before buffering the entire output',async()=>{
  await assert.rejects(decodeSnapshot(SNAPSHOT_GZIP_PREFIX+(MAX_SNAPSHOT_BYTES+1)+':AAAA'),e=>e.code==='SNAPSHOT_TOO_LARGE');
  await assert.rejects(encodeSnapshot('x'.repeat(MAX_SNAPSHOT_BYTES+1)),e=>e.code==='SNAPSHOT_TOO_LARGE');
  await assert.rejects(decodeSnapshotText('x'.repeat(MAX_SNAPSHOT_BYTES+1)),e=>e.code==='SNAPSHOT_TOO_LARGE');
});
test('compression changes only stored data, preserving CAS versions and stale-write protection',async()=>{
  const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);');
  const wrap=(s,v=[])=>({run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});
  const env={DB:{prepare(q){const s=sql.prepare(q);return{...wrap(s),bind(...v){return wrap(s,v);}};}}};
  try {
    const db={contacts:[{id:'fictional',name:'Preserved'}],large:'note'.repeat(300000)};
    const first=await writeSnapshot(env,'org1',JSON.stringify(db),'owner',null);
    const row=sql.prepare('SELECT * FROM crm_snapshot').get();assert.ok(row.data.startsWith(SNAPSHOT_GZIP_PREFIX));assert.equal(snapshotEtag(row),JSON.stringify(first));
    const next={...db,contacts:[{id:'fictional',name:'Updated'}]};
    assert.ok(await writeSnapshot(env,'org1',JSON.stringify(next),'owner',row));
    assert.equal(await writeSnapshot(env,'org1',JSON.stringify(db),'stale',row),null);
    assert.equal((await decodeSnapshot(sql.prepare('SELECT data FROM crm_snapshot').get().data)).contacts[0].name,'Updated');
  } finally {sql.close();}
});

test('incompressible data exceeding the stored limit is rejected',async()=>{
  const raw=JSON.stringify({notes:randomBytes(1_600_000).toString('base64')});
  await assert.rejects(encodeSnapshot(raw),e=>e.code==='SNAPSHOT_TOO_LARGE');
});

test('workspace GET/PUT, phone matching and meeting mutations share compressed storage and CAS',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);CREATE TABLE users(id TEXT,org_id TEXT,name TEXT,email TEXT,role_id TEXT,status TEXT,deleted_at TEXT,created_at TEXT);CREATE TABLE zoom_crm_meetings(org_id TEXT);CREATE TABLE audit_reports(id TEXT,audit_id TEXT,contact_id TEXT,kind TEXT,revision INTEGER,created_at TEXT,org_id TEXT);CREATE TABLE activity_log(id TEXT,org_id TEXT,who_user_id TEXT,what TEXT,contact_id TEXT);INSERT INTO users VALUES('u_ibrar','org1','Fictional Owner','owner@example.test','role_owner','active',NULL,'2026-01-01');");
 const wrap=(s,v=[])=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});
 const env={DB:{prepare(q){const s=sql.prepare(q);return{...wrap(s),bind(...v){return wrap(s,v);}};}}};
 const actor={id:'u_ibrar',orgId:'org1',isOwner:true};
 try {
  const db={contacts:[{id:'fictional',name:'Preserved',phone:'+12125551001'}],deals:[],users:[],meetings:[],files:[],notes:[],large:'original source note '.repeat(60000)};
  const version=await writeSnapshot(env,'org1',JSON.stringify(db),actor.id,null);
  const get=await handleDbBlobRequest(new Request('https://crm.test/api/db'),env,actor,{});assert.equal(get.status,200);assert.equal(get.headers.get('ETag'),JSON.stringify(version));const body=await get.json();assert.equal(body.data.contacts[0].name,'Preserved');
  assert.equal(await matchContactByPhone(env,'org1','(212) 555-1001'),'fictional');
  await mutateOrgSnapshot(env,'org1',snapshot=>{snapshot.meetings.push({id:'fictional-meeting',at:'2026-10-09T12:00:00Z'});return true;});
  const newer=sql.prepare('SELECT * FROM crm_snapshot').get();assert.ok(newer.data.startsWith(SNAPSHOT_GZIP_PREFIX));assert.equal((await decodeSnapshot(newer.data)).meetings.length,1);
  const stale=await handleDbBlobRequest(new Request('https://crm.test/api/db',{method:'PUT',headers:{'If-Match':JSON.stringify(version)},body:JSON.stringify(body.data)}),env,actor,{});assert.equal(stale.status,409);
  const next=await decodeSnapshot(newer.data);next.contacts[0].name='Updated';
  const put=await handleDbBlobRequest(new Request('https://crm.test/api/db',{method:'PUT',headers:{'If-Match':JSON.stringify(newer.updated_at)},body:JSON.stringify(next)}),env,actor,{waitUntil(){}});assert.equal(put.status,200);
  const final=await decodeSnapshot(sql.prepare('SELECT data FROM crm_snapshot').get().data);assert.equal(final.contacts[0].name,'Updated');assert.equal(final.large,db.large);assert.equal(final.meetings.length,1);
 }finally{sql.close();}
});
