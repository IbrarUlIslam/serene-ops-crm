import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleCallQueue} from './call-queue.mjs';
import {analyzePublic} from './audit-analysis.mjs';
import {handleAuditConnectors} from './audit-connectors.mjs';
const NOW=Date.parse('2026-10-08T14:00:00Z');
const sales=id=>({id,orgId:'org1',name:id,isOwner:false,visibility:{profile:'sales_associate',scope:'all_sales',sections:['contacts','calls'],editSections:['contacts','calls']}});
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync(new URL('./migrations/20261009_low_cost_workflow.sql',import.meta.url),'utf8'));
 sql.exec('CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);CREATE TABLE zoom_crm_meetings(id TEXT,org_id TEXT);');
 const data={contacts:[{id:'c1',name:'Fictional lead',status:'Not contacted',timezone:'America/New_York',phone:'+12125550111',created_at:'2026-09-01T13:00:00Z'}],calls:[],reminders:[],activity:[]};
 sql.prepare('INSERT INTO crm_snapshot VALUES(?,?,?,?)').run('org1',JSON.stringify(data),'before','owner');
 const wrap=(s,v=[])=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});
 const env={CRM_LOW_COST_MODE:'true',DB:{prepare(q){const s=sql.prepare(q);return {...wrap(s),bind(...v){return wrap(s,v);}};}}};
 const request=(path,method='POST',body={})=>new Request('https://crm.test/api/call-queue'+path,{method,body:method==='GET'?undefined:JSON.stringify(body)});
 const call=(path,user='sales-a',body={},now=NOW)=>handleCallQueue(request(path,path===''?'GET':'POST',{contactId:'c1',...body}),env,sales(user),{now});
 return {sql,env,call};
}
test('atomic reservations prevent a second associate calling and hide their identity; release and expiry unblock',async()=>{
 const f=fixture();assert.equal((await f.call('/claim')).status,200);assert.equal((await f.call('/claim','sales-b')).status,409);
 const q=await (await f.call('','sales-b')).json();assert.equal(q.available.length,0);assert.equal(q.review[0].reasonCodes[0],'reserved');assert.ok(!JSON.stringify(q).includes('sales-a'));
 assert.equal((await f.call('/release','sales-b')).status,200);assert.equal((await f.call('/check','sales-b')).status,409);
 await f.call('/release');assert.equal((await f.call('/check','sales-b')).status,200);
 assert.equal((await f.call('/claim','sales-a',{},NOW+15*60000)).status,200);
});
test('claims still enforce visibility, calling hours and DNC; read-only users cannot reserve',async()=>{
 const f=fixture();assert.equal((await f.call('/claim','sales-a',{contactId:'hidden'})).status,404);
 assert.equal((await f.call('/claim','sales-a',{},Date.parse('2026-10-08T03:00:00Z'))).status,409);
 const data=JSON.parse(f.sql.prepare('SELECT data FROM crm_snapshot').get().data);data.contacts[0].do_not_call=true;f.sql.prepare('UPDATE crm_snapshot SET data=?').run(JSON.stringify(data));assert.equal((await f.call('/claim')).status,409);
 const u=sales('readonly');u.visibility.editSections=[];const r=new Request('https://crm.test/api/call-queue/claim',{method:'POST',body:JSON.stringify({contactId:'c1'})});assert.equal((await handleCallQueue(r,f.env,u,{now:NOW})).status,403);
});
test('logging releases own reservation without creating automatic follow-up reminders',async()=>{
 const f=fixture();await f.call('/claim');const body={idempotencyKey:'low_cost_attempt_001',outcome:'No answer',note:'No answer, retry later.'};assert.equal((await f.call('/outcome','sales-b',body)).status,409);
 assert.equal((await f.call('/outcome','sales-a',body)).status,200);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM call_reservations').get().n,0);
 const data=JSON.parse(f.sql.prepare('SELECT data FROM crm_snapshot').get().data);assert.equal(data.reminders.length,0);
 const replay=await (await f.call('/outcome','sales-a',body)).json();assert.equal(replay.duplicate,true);assert.equal(JSON.parse(f.sql.prepare('SELECT data FROM crm_snapshot').get().data).reminders.length,0);
});
test('audit analysis uses connector evidence without a hosting-plan daily quota',async()=>{
 const f=fixture();let calls=0;f.env.AI={run:async()=>{calls++;return {response:{sections:[]}};}};
 f.sql.exec('DROP TABLE crm_daily_usage');
 const evidence=[{source:'website',identityConfirmed:true,evidence:[{text:'Confirmed public evidence for a fictional lead.'}]}];
 for(let i=0;i<3;i++)assert.equal((await analyzePublic(f.env,evidence)).generated,true);
 assert.equal(calls,3);
});
test('connector collection follows explicit provider consent, independent of hosting budget mode',async()=>{
 const f=fixture();f.env.AUDIT_FIRECRAWL_KEY='fictional-test-secret';let requests=0;
 f.sql.exec(fs.readFileSync(new URL('./migrations/20261005_audit_connectors.sql',import.meta.url),'utf8'));
 const request=new Request('https://crm.test/api/audit-connectors/collect',{method:'POST',body:JSON.stringify({source:'discovery',target:{name:'Fictional lead',city:'New York'},allowPaid:true,runId:'fictional_request_001'})});
 const result=await handleAuditConnectors(request,f.env,{isOwner:true,orgId:'org1',id:'owner'},async()=>{requests++;return new Response(JSON.stringify({success:true,data:[]}),{status:200,headers:{'Content-Type':'application/json'}});});
 assert.equal(result.status,200);assert.equal(requests,1);
});
