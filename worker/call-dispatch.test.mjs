import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleZoomCallClaim,handleZoomPhoneMapping} from './worker.js';

const staff={id:'u_staff',orgId:'org1',name:'Fictional QA Caller',isOwner:false,visibility:{sections:['calls'],editSections:['calls']}};
function fixture({mapped=true,contact={}}={}){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);
 CREATE TABLE zoom_phone_user_map(org_id TEXT,crm_user_id TEXT,zoom_user_id TEXT,zoom_extension TEXT,zoom_email TEXT,active INTEGER);
 CREATE TABLE zoom_call_initiations(zoom_call_id TEXT PRIMARY KEY,org_id TEXT,crm_user_id TEXT,crm_user_name TEXT,zoom_user_id TEXT,authorized_shared_identity INTEGER,dest_number TEXT,created_at TEXT);`);
 const db={users:[{id:'u_staff',name:staff.name}],contacts:[{id:'c1',name:'Fictional QA Client',status:'Client',assignee_user_id:'u_staff',phone:'+1 (555) 000-1111',timezone:'Asia/Karachi',call_start:0,call_end:24,call_days:[0,1,2,3,4,5,6],created_at:new Date(Date.now()-45*86400000).toISOString(),...contact}],calls:[],reminders:[]};
 sql.prepare('INSERT INTO crm_snapshot VALUES(?,?,?,?)').run('org1',JSON.stringify(db),new Date().toISOString(),'qa');
 if(mapped)sql.prepare('INSERT INTO zoom_phone_user_map VALUES(?,?,?,?,?,1)').run('org1','u_staff','self-phone','501','self@example.test');
 sql.prepare('INSERT INTO zoom_phone_user_map VALUES(?,?,?,?,?,1)').run('org1','u_other','other-phone','502','other@example.test');
 const wrap=(s,v=[])=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});
 const env={DB:{prepare(q){const s=sql.prepare(q);return {...wrap(s),bind(...v){return wrap(s,v);}};}}};
 const request=body=>new Request('https://crm.test/api/zoom/calls/claim',{method:'POST',body:JSON.stringify(body)});
 const claims=()=>sql.prepare('SELECT * FROM zoom_call_initiations').all();
 return {sql,env,request,claims};
}
test('staff cannot claim arbitrary phone numbers or provider call IDs',async()=>{const f=fixture();try{for(const body of [{destNumber:'+15550001111'},{zoomCallId:'not-owned'}])assert.equal((await handleZoomCallClaim(f.request(body),f.env,staff)).status,403);assert.equal(f.claims().length,0);}finally{f.sql.close();}});
test('queued dispatch rechecks assignment, do-not-call and active Client status',async()=>{
 for(const contact of [{assignee_user_id:'u_other'},{do_not_call:true},{archived_at:'today'},{is_sample:true},{timezone:null}]){const f=fixture({contact});try{const r=await handleZoomCallClaim(f.request({queueContactId:'c1',destNumber:'+15550001111'}),f.env,staff);assert.ok([404,409].includes(r.status));assert.equal(f.claims().length,0);}finally{f.sql.close();}}
});
test('mismatched or missing canonical number blocks queued dispatch',async()=>{const f=fixture();try{for(const destNumber of ['+15559999999',null])assert.equal((await handleZoomCallClaim(f.request({queueContactId:'c1',destNumber}),f.env,staff)).status,409);assert.equal(f.claims().length,0);}finally{f.sql.close();}});
test('queued dispatch requires the authenticated caller own active mapping',async()=>{const f=fixture({mapped:false});try{const r=await handleZoomCallClaim(f.request({queueContactId:'c1',destNumber:'+15550001111'}),f.env,staff);assert.equal(r.status,403);assert.equal(f.claims().length,0);}finally{f.sql.close();}});
test('eligible queued claim records caller attribution and closing time without making a provider call',async()=>{const f=fixture();try{const r=await handleZoomCallClaim(f.request({queueContactId:'c1',destNumber:'+15550001111',inactivityDays:14}),f.env,staff),body=await r.json();assert.equal(r.status,200);assert.equal(body.data.ok,true);assert.ok(Date.parse(body.data.closesAt)>Date.now());const claim=f.claims()[0];assert.equal(claim.crm_user_id,'u_staff');assert.equal(claim.zoom_user_id,'self-phone');assert.equal(claim.dest_number,'+15550001111');}finally{f.sql.close();}});
test('staff cannot use a queued claim to attribute an arbitrary provider call ID',async()=>{const f=fixture();try{const r=await handleZoomCallClaim(f.request({queueContactId:'c1',destNumber:'+15550001111',zoomCallId:'provider-id'}),f.env,staff);assert.equal(r.status,400);assert.equal(f.claims().length,0);}finally{f.sql.close();}});
test('self mapping reads ignore staff attempts to request another user',async()=>{const f=fixture();try{const r=await handleZoomPhoneMapping(new Request('https://crm.test/api/zoom/phone-mapping?userId=u_other'),f.env,staff),body=await r.json();assert.equal(r.status,200);assert.equal(body.data.crm_user_id,'u_staff');assert.equal(body.data.zoom_user_id,'self-phone');}finally{f.sql.close();}});
