import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleSalesContactAutosave} from './sales-contact-autosave.mjs';
import {decodeSnapshot,encodeSnapshot} from './snapshot-codec.mjs';
const user={id:'u_sales',orgId:'org1',email:'sales@example.invalid',name:'Sales Person',isOwner:false,roleCode:'sales_associate',visibility:{profile:'sales_associate',scope:'all_sales',sections:['contacts','pipeline','calls'],editSections:['contacts','pipeline','calls']}};
const request=(patch={sales_notes:'After'},base={sales_notes:'Before'},id='c1')=>new Request('https://crm.test/api/sales/contacts/'+id,{method:'PATCH',body:JSON.stringify({patch,base})});
async function fixture({large=false}={}){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT)');
 const db={org:{id:'org1'},users:[{id:user.id,email:user.email,name:user.name},{id:'private_operator',email:'private@example.invalid',name:'Private Operator'}],contacts:[{id:'c1',name:'QA Prospect',status:'Not contacted',timezone:'America/New_York',phone:'+12025550111',sales_notes:'Before',owner:'Private Operator',owner_user_id:'private_operator',notes:'Private operations',monthly_override:500,do_not_call:true,call_blocked_reason:'Private consent decision',call_start:9,call_end:18,tags:['public','assign-private']},{id:'c2',name:'Other Prospect',status:'Not contacted',timezone:'America/Chicago',sales_notes:'Other original',notes:'Other private notes'}],deals:[],todos:[],calls:[],activity:[],...(large?{original_imported_notes:'Fictional source material. '.repeat(50000)}:{})};
 sql.prepare('INSERT INTO crm_snapshot VALUES(?,?,?,?)').run('org1',await encodeSnapshot(db),'2026-10-08T12:00:00.000Z','owner');
 let race=null;const wrap=(text,values=[])=>({first:async()=>sql.prepare(text).get(...values)||null,run:async()=>{if(race&&text.startsWith('UPDATE crm_snapshot')){const once=race;race=null;await once();}return{meta:{changes:Number(sql.prepare(text).run(...values).changes)}};}});
 const env={DB:{prepare(text){return{...wrap(text),bind(...values){return wrap(text,values);}};}}};
 return{sql,db,env,race(fn){race=fn;},async stored(){return decodeSnapshot(sql.prepare('SELECT data FROM crm_snapshot').get().data);}};
}
test('small note autosave preserves private fields and all other contacts in the compressed canonical workspace',async()=>{
 const f=await fixture({large:true});try{const req=request();assert.ok((await req.clone().text()).length<100);const response=await handleSalesContactAutosave(req,f.env,user);assert.equal(response.status,200);const result=await response.json();assert.equal(result.data.ok,true);assert.equal(result.contact.sales_notes,'After');assert.equal(result.contact.assigned_to_me,false);for(const key of ['notes','monthly_override','owner','owner_user_id','call_blocked_reason'])assert.equal(Object.hasOwn(result.contact,key),false,key);const stored=await f.stored();assert.equal(stored.contacts[0].notes,'Private operations');assert.equal(stored.contacts[0].monthly_override,500);assert.equal(stored.contacts[0].do_not_call,true);assert.deepEqual(stored.contacts[1],f.db.contacts[1]);assert.equal(stored.original_imported_notes,f.db.original_imported_notes);assert.equal(stored.activity[0].by_user_id,user.id);}finally{f.sql.close();}
});
test('replaying a save with the old base acknowledges its committed value without duplicate events',async()=>{
 const f=await fixture();try{const first=await handleSalesContactAutosave(request(),f.env,user);const replay=await handleSalesContactAutosave(request(),f.env,user);assert.equal(first.status,200);assert.equal(replay.status,200);assert.equal(first.headers.get('ETag'),replay.headers.get('ETag'));assert.equal((await f.stored()).activity.length,1);}finally{f.sql.close();}
});
test('another contact or an independent field can change without being overwritten by note autosave',async()=>{
 const f=await fixture();try{const fresh=await f.stored();fresh.contacts[1].sales_notes='Another user latest note';fresh.contacts[0].city='New latest city';f.sql.prepare('UPDATE crm_snapshot SET data=?,updated_at=?').run(await encodeSnapshot(fresh),'2026-10-08T12:00:01.000Z');const response=await handleSalesContactAutosave(request(),f.env,user);assert.equal(response.status,200);const saved=await f.stored();assert.equal(saved.contacts[1].sales_notes,'Another user latest note');assert.equal(saved.contacts[0].city,'New latest city');assert.equal(saved.contacts[0].sales_notes,'After');}finally{f.sql.close();}
});
test('a changed note returns a field conflict and preserves both the server note and private data',async()=>{
 const f=await fixture();try{const fresh=await f.stored();fresh.contacts[0].sales_notes='Other user note';f.sql.prepare('UPDATE crm_snapshot SET data=?').run(await encodeSnapshot(fresh));const response=await handleSalesContactAutosave(request(),f.env,user);assert.equal(response.status,409);assert.deepEqual((await response.json()).fields,['sales_notes']);assert.equal((await f.stored()).contacts[0].sales_notes,'Other user note');}finally{f.sql.close();}
});
test('a conditional write race retries against the latest snapshot and preserves the concurrent contact edit',async()=>{
 const f=await fixture();try{f.race(async()=>{const fresh=await f.stored();fresh.contacts[1].sales_notes='Concurrent edit';f.sql.prepare('UPDATE crm_snapshot SET data=?,updated_at=?').run(await encodeSnapshot(fresh),'2026-10-08T12:00:01.000Z');});const response=await handleSalesContactAutosave(request(),f.env,user);assert.equal(response.status,200);const stored=await f.stored();assert.equal(stored.contacts[0].sales_notes,'After');assert.equal(stored.contacts[1].sales_notes,'Concurrent edit');assert.equal(stored.activity.length,1);}finally{f.sql.close();}
});
test('restricted, read-only and archived contacts cannot be changed through the small route',async()=>{
 const f=await fixture();try{const readOnly={...user,visibility:{...user.visibility,editSections:[]}},assigned={...user,visibility:{...user.visibility,scope:'assigned'}};assert.equal((await handleSalesContactAutosave(request(),f.env,readOnly)).status,403);assert.equal((await handleSalesContactAutosave(request(),f.env,assigned)).status,403);const archived=await f.stored();archived.contacts[0].deleted_at='2026-10-08T12:00:00Z';f.sql.prepare('UPDATE crm_snapshot SET data=?').run(await encodeSnapshot(archived));assert.equal((await handleSalesContactAutosave(request(),f.env,user)).status,403);assert.equal((await f.stored()).contacts[0].sales_notes,'Before');}finally{f.sql.close();}
});
test('private, consent, ownership, archive and access fields are rejected before storage',async()=>{
 const f=await fixture();try{for(const key of ['notes','owner_user_id','do_not_call','deleted_at','visibility','assigned_to_me'])assert.equal((await handleSalesContactAutosave(request({[key]:'Changed'},{[key]:null}),f.env,user)).status,400,key);assert.equal((await f.stored()).activity.length,0);}finally{f.sql.close();}
});
