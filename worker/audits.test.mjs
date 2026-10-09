import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {newDemoDeals,buildReport,reportHtml,validateAnswers,recommendedServices,QUESTIONS} from './audit-report.mjs';
import {handleAudits,enqueueDemoAudits,mergeAuditDocuments,resumeAuditQueue} from './audits.mjs';
import {SAMPLE_CONTACT_ID,SAMPLE_DEAL_ID,SAMPLE_ANSWERS,SAMPLE_SERVICES,SAMPLE_SERVICE_NOTES} from './audit-sample.mjs';
import {encodeSnapshot,decodeSnapshot,SNAPSHOT_GZIP_PREFIX} from './snapshot-codec.mjs';
const owner={id:'u1',orgId:'org1',isOwner:true},contact={id:'c1',name:'Example Realtor',brokerage:'Example Brokerage',state:'NY'},deal={id:'d1',contact_id:'c1',stage:'Demo scheduled'};
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);'+readFileSync(new URL('./migrations/20261005_audit_connectors.sql',import.meta.url),'utf8')+readFileSync(new URL('./migrations/20261007_audit_workflow.sql',import.meta.url),'utf8'));
 const db={contacts:[contact],deals:[deal],files:[]};
 sql.prepare('INSERT INTO crm_snapshot(org_id,data) VALUES(?,?)').run(owner.orgId,JSON.stringify(db));
 const wrap=(s,values=[])=>({first:async()=>s.get(...values)||null,all:async()=>({results:s.all(...values)}),run:async()=>({meta:{changes:Number(s.run(...values).changes)}})});
 const env={DB:{prepare(query){const s=sql.prepare(query);return {...wrap(s),bind(...values){return wrap(s,values);}};}}};
 const jobs=[];const ctx={waitUntil(p){jobs.push(p);}};
 return {sql,env,db,ctx,async drain(){await Promise.all(jobs.splice(0));}};
}
const request=(path,method='GET',body)=>new Request('https://crm.test/api/audits'+path,{method,body:body?JSON.stringify(body):undefined});
const complete=()=>Object.fromEntries(QUESTIONS.map(q=>[q.id,q.type==='select'?'Unknown':'Realtor-provided meeting answer']));
test('only new demo deals or stage transitions trigger, never autosaves, archives or other stages',()=>{
 const after={contacts:[contact],deals:[deal]};assert.equal(newDemoDeals({},after).length,1);assert.equal(newDemoDeals(after,after).length,0);assert.equal(newDemoDeals({deals:[{...deal,stage:'Audit sent'}]},after).length,1);assert.equal(newDemoDeals({}, {...after,deals:[{...deal,stage:'Closed won'}]}).length,0);assert.equal(newDemoDeals({}, {...after,contacts:[{...contact,deleted_at:'today'}]}).length,0);
});
test('a trusted sales demo queues one owner-service audit while reports stay owner-only and out-of-scope or readonly sales cannot queue',async t=>{
 const f=fixture();let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw Error('No provider calls without configured connectors');});const sales={id:'u_sales',orgId:'org1',name:'Sales Person',roleCode:'sales_associate',isOwner:false,visibility:{profile:'sales_associate',scope:'all_sales',sections:['contacts','pipeline'],editSections:['pipeline']}};try{
  const readonly={...sales,visibility:{...sales.visibility,editSections:[]}},assigned={...sales,visibility:{...sales.visibility,scope:'assigned'}};
  await enqueueDemoAudits(f.env,readonly,{},f.db,f.ctx);await enqueueDemoAudits(f.env,assigned,{},f.db,f.ctx);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_cases').get().n,0);
  await enqueueDemoAudits(f.env,sales,{},f.db,f.ctx);await f.drain();await enqueueDemoAudits(f.env,sales,{},f.db,f.ctx);await f.drain();const row=f.sql.prepare('SELECT * FROM audit_cases').get();assert.equal(row.by_user_id,'u_sales');assert.equal(row.status,'pre_ready');assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_reports').get().n,1);assert.equal((await handleAudits(request(''),f.env,sales,f.ctx)).status,403);assert.equal(network,0);
 }finally{f.sql.close();}
});
test('sample creation is owner-only and denied requests do not access storage',async()=>{
 const env={DB:{prepare(){throw Error('Storage must not be reached');}}};
 assert.equal((await handleAudits(request('/sample','POST',{}),env,{...owner,isOwner:false},{})).status,403);
});

test('audit sample generation reads and appends to compressed snapshots without provider calls',async t=>{
 const f=fixture();let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw Error('No provider calls allowed');});try {
  f.db.original_imported_notes='Illustrative imported source information — مثال. '.repeat(30000);
  f.sql.prepare('UPDATE crm_snapshot SET data=?').run(await encodeSnapshot(JSON.stringify(f.db)));
  const response=await handleAudits(request('/sample','POST',{}),f.env,owner,f.ctx);assert.equal(response.status,200);const result=await response.json();assert.equal(result.sample,true);
  const stored=f.sql.prepare('SELECT data FROM crm_snapshot').get().data;assert.ok(stored.startsWith(SNAPSHOT_GZIP_PREFIX));const saved=await decodeSnapshot(stored);assert.equal(saved.original_imported_notes,f.db.original_imported_notes);assert.equal(saved.contacts.length,2);assert.equal(network,0);
 }finally{f.sql.close();}
});
test('fictional sample appends one labelled contact while preserving real records and creating no deal',async()=>{
 const f=fixture();try{
  const resp=await handleAudits(request('/sample','POST',{}),f.env,owner,f.ctx);assert.equal(resp.status,200);const result=await resp.json();
  assert.equal(result.sample,true);assert.equal(result.reused,false);assert.equal(result.contactId,SAMPLE_CONTACT_ID);assert.equal(result.status,'pre_ready');assert.ok(result.updatedAt);
  const stored=f.sql.prepare('SELECT data,updated_at FROM crm_snapshot').get(),db=JSON.parse(stored.data);assert.equal(stored.updated_at,result.updatedAt);
  assert.deepEqual(db.contacts[0],contact);assert.deepEqual(db.deals,f.db.deals);assert.deepEqual(db.files,[]);assert.equal(db.contacts.length,2);
  const sample=db.contacts.find(c=>c.id===SAMPLE_CONTACT_ID);assert.equal(sample.is_sample,true);assert.match(sample.name,/^Sample/);assert.equal(sample.email,'');assert.equal(sample.phone,'');assert.deepEqual(sample.services,[]);
  const row=f.sql.prepare('SELECT * FROM audit_cases').get();assert.equal(row.deal_id,SAMPLE_DEAL_ID);assert.deepEqual(JSON.parse(row.answers_json),{});assert.deepEqual(JSON.parse(row.services_json),[]);
  const report=JSON.parse(f.sql.prepare('SELECT report_json FROM audit_reports').get().report_json);assert.equal(report.sample,true);assert.deepEqual(report.services,[]);assert.equal(report.analysis.sections.length,7);assert.ok(report.analysis.sections.every(s=>s.findings.length));assert.ok(report.evidence.every(g=>g.sample&&g.identityConfirmed===false));assert.ok(report.evidence.every(g=>g.evidence.every(e=>e.url==='')));
  const docs=await mergeAuditDocuments(f.env,owner.orgId,[]);assert.equal(docs.length,1);assert.match(docs[0].name,/^Sample/);assert.equal(docs[0].is_sample,true);assert.equal(docs[0].contact_id,SAMPLE_CONTACT_ID);
 }finally{f.sql.close();}
});
test('concurrent sample requests reuse one contact, case and pre-meeting document',async()=>{
 const f=fixture();try{
  const responses=await Promise.all([handleAudits(request('/sample','POST',{}),f.env,owner,f.ctx),handleAudits(request('/sample','POST',{}),f.env,owner,f.ctx)]);
  assert.ok(responses.every(r=>r.status===200));const results=await Promise.all(responses.map(r=>r.json()));assert.equal(results[0].id,results[1].id);assert.equal(results.filter(r=>r.reused===false).length,1);
  assert.equal(JSON.parse(f.sql.prepare('SELECT data FROM crm_snapshot').get().data).contacts.filter(c=>c.id===SAMPLE_CONTACT_ID).length,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_cases').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_reports').get().n,1);
 }finally{f.sql.close();}
});
test('sample can be filled, saved and generated through the normal meeting workflow without any research or AI calls',async t=>{
 const f=fixture();let networkCalls=0,aiCalls=0;t.mock.method(globalThis,'fetch',async()=>{networkCalls++;throw Error('Sample must not make network calls');});
 Object.assign(f.env,{AUDIT_FIRECRAWL_KEY:'fictional-test-only',AUDIT_META_TOKEN:'fictional-test-only',AUDIT_META_IG_ID:'test',AUDIT_META_VERSION:'v23.0',AI:{run(){aiCalls++;throw Error('Sample must not call AI');}}});
 try{
  const created=await (await handleAudits(request('/sample','POST',{}),f.env,owner,f.ctx)).json();
  const detail=await (await handleAudits(request('/'+created.id),f.env,owner,f.ctx)).json();assert.equal(detail.sample,true);assert.equal(detail.audit.sample,true);assert.deepEqual(detail.sampleAnswers,SAMPLE_ANSWERS);assert.deepEqual(detail.audit.answers,{});
  assert.equal((await handleAudits(request('/'+created.id+'/generate','POST',{revision:0}),f.env,owner,f.ctx)).status,400);
  assert.equal((await handleAudits(request('/'+created.id+'/answers','PUT',{revision:0,answers:detail.sampleAnswers,services:detail.sampleServices,serviceNotes:detail.sampleServiceNotes}),f.env,owner,f.ctx)).status,200);
  assert.equal((await handleAudits(request('/'+created.id+'/generate','POST',{revision:1}),f.env,owner,f.ctx)).status,200);
  const full=JSON.parse(f.sql.prepare("SELECT report_json FROM audit_reports WHERE kind='full'").get().report_json);assert.equal(full.sample,true);assert.deepEqual(full.answers,SAMPLE_ANSWERS);assert.deepEqual(full.services.map(s=>s.id),SAMPLE_SERVICES);assert.match(full.pricing,/\$1,045/);assert.match(full.serviceNotes,/FICTIONAL PROPOSAL/);assert.ok(full.gaps.some(g=>g.title==='Listing operations'));assert.ok(full.gaps.some(g=>g.title==='Database process'));assert.ok(full.gaps.some(g=>g.title==='Lead response'));
  const reopened=await (await handleAudits(request('/sample','POST',{}),f.env,owner,f.ctx)).json();assert.equal(reopened.id,created.id);assert.equal(reopened.reused,true);assert.equal(reopened.status,'full_ready');
  assert.deepEqual(JSON.parse(f.sql.prepare('SELECT answers_json FROM audit_cases').get().answers_json),SAMPLE_ANSWERS);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_reports').get().n,2);
  assert.equal((await handleAudits(request('/'+created.id+'/research','POST',{revision:1,allowPaid:true,sources:['website']}),f.env,owner,f.ctx)).status,409);
  assert.equal((await handleAudits(request('/start','POST',{contactId:SAMPLE_CONTACT_ID}),f.env,owner,f.ctx)).status,200);
  assert.equal(networkCalls,0);assert.equal(aiCalls,0);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_connector_runs').get().n,0);
 }finally{f.sql.close();}
});
test('sample queue recovery and accidental demo transitions never call providers',async t=>{
 const f=fixture();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('No sample network calls');});Object.assign(f.env,{AUDIT_FIRECRAWL_KEY:'fictional-test-only',AI:{run(){calls++;throw Error('No sample AI calls');}}});
 try{
  const sample=await (await handleAudits(request('/sample','POST',{}),f.env,owner,f.ctx)).json();
  f.sql.prepare("UPDATE audit_cases SET status='needs_attention' WHERE id=?").run(sample.id);
  assert.equal((await handleAudits(request('/'+sample.id+'/retry','POST',{revision:0}),f.env,owner,f.ctx)).status,200);await f.drain();
  assert.equal(f.sql.prepare('SELECT status FROM audit_cases').get().status,'pre_ready');
  const db=JSON.parse(f.sql.prepare('SELECT data FROM crm_snapshot').get().data);db.deals.push({id:'accidental-sample-deal',contact_id:SAMPLE_CONTACT_ID,stage:'Demo scheduled'});
  await enqueueDemoAudits(f.env,owner,f.db,db,f.ctx);await f.drain();assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_cases').get().n,1);assert.equal(calls,0);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_connector_runs').get().n,0);
 }finally{f.sql.close();}
});
test('sample report is clearly fictional, renders white and permits only same-origin brand fonts',async()=>{
 const f=fixture();try{
  const result=await (await handleAudits(request('/sample','POST',{}),f.env,owner,f.ctx)).json();const report=f.sql.prepare('SELECT id FROM audit_reports WHERE audit_id=?').get(result.id);
  const resp=await handleAudits(request('/reports/'+report.id),f.env,owner,f.ctx);assert.equal(resp.status,200);const html=await resp.text();assert.match(html,/FICTIONAL SAMPLE — NO REALTOR RESEARCHED/);assert.match(html,/Illustrative evidence — fictional excerpts/);assert.match(html,/Illustrative excerpt/);assert.ok(!html.includes('background:#fdf6e3'));assert.match(html,/body\{background:#fff/);assert.match(resp.headers.get('content-security-policy'),/style-src 'self' 'unsafe-inline'; font-src 'self'/);assert.ok(!html.includes('href="https://'));
  assert.equal((await handleAudits(request('/reports/'+report.id),f.env,{...owner,orgId:'org2'},f.ctx)).status,404);
 }finally{f.sql.close();}
});
test('sample CAS retries preserve a concurrent real contact change',async()=>{
 const f=fixture();try{
  const original=f.env.DB.prepare;let conflicted=false;
  f.env.DB.prepare=query=>{
   const prepared=original(query);if(!query.startsWith('UPDATE crm_snapshot SET data=?'))return prepared;
   return {...prepared,bind(...values){const bound=prepared.bind(...values);return {...bound,async run(){if(!conflicted){conflicted=true;const current=JSON.parse(f.sql.prepare('SELECT data FROM crm_snapshot').get().data);current.contacts[0].name='Concurrent real edit';f.sql.prepare("UPDATE crm_snapshot SET data=?,updated_at='2030-01-01T00:00:00.000Z'").run(JSON.stringify(current));}return bound.run();}};}};
  };
  assert.equal((await handleAudits(request('/sample','POST',{}),f.env,owner,f.ctx)).status,200);const saved=JSON.parse(f.sql.prepare('SELECT data FROM crm_snapshot').get().data);assert.equal(saved.contacts[0].name,'Concurrent real edit');assert.equal(saved.contacts.filter(c=>c.id===SAMPLE_CONTACT_ID).length,1);
 }finally{f.sql.close();}
});
test('sample never overwrites a reserved contact ID occupied by a real record',async()=>{
 const f=fixture();try{
  const db={...f.db,contacts:[...f.db.contacts,{id:SAMPLE_CONTACT_ID,name:'Real reserved-ID contact'}]};f.sql.prepare('UPDATE crm_snapshot SET data=?').run(JSON.stringify(db));
  assert.equal((await handleAudits(request('/sample','POST',{}),f.env,owner,f.ctx)).status,409);assert.deepEqual(JSON.parse(f.sql.prepare('SELECT data FROM crm_snapshot').get().data),db);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_cases').get().n,0);
 }finally{f.sql.close();}
});
test('auto demo generation persists one case and one document despite duplicate events',async()=>{
 const f=fixture();await enqueueDemoAudits(f.env,owner,{},f.db,f.ctx);await f.drain();await enqueueDemoAudits(f.env,owner,{},f.db,f.ctx);await f.drain();assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_cases').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM audit_reports').get().n,1);const docs=await mergeAuditDocuments(f.env,owner.orgId,[{id:'normal',name:'NDA'}]);assert.equal(docs.length,2);assert.equal(docs[1].contact_id,contact.id);assert.match(docs[1].url,/^\/api\/audits\/reports\//);f.sql.close();
});
test('auto report with unavailable provider labels missing evidence and does not infer weaknesses',async()=>{
 const f=fixture();await enqueueDemoAudits(f.env,owner,{},f.db,f.ctx);await f.drain();const report=JSON.parse(f.sql.prepare('SELECT report_json FROM audit_reports').get().report_json);assert.equal(report.evidence[0].status,'not_assessed');assert.deepEqual(report.gaps,[]);assert.deepEqual(report.services,[]);f.sql.close();
});
test('full audit requires answers, offers no unsupported service and separates responsibilities',()=>{
 assert.throws(()=>buildReport('full',contact,[],{},[]),/Complete every/);const answers=complete();answers.crmGap='Needs work';assert.deepEqual(recommendedServices(answers),['03']);const r=buildReport('full',contact,[],answers,['03'],'Custom scope requires a quote.');assert.equal(r.services[0].name,'CRM and database');assert.match(r.services[0].we,/Clean agreed records/);assert.match(r.services[0].agent,/Choose stages/);assert.match(r.pricing,/\$210/);assert.equal(r.unknown.length,6);assert.match(buildReport('full',contact,[],answers,['01','02','03','04','05','06','07']).pricing,/quoted on the call/);
});
test('hostile content cannot execute in generated report',()=>{
 const answers=complete();answers.details='<script>alert(1)</script>';const r=buildReport('full',{...contact,name:'<img onerror=alert(1)>'},[{source:'website',status:'collected',evidence:[{url:'javascript:alert(1)',text:'<script>bad()</script>'}]}],answers,['03']);const html=reportHtml(r);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Serene Ops will'));assert.ok(html.includes('The realtor will'));
});
test('case/report endpoints enforce organization and owner access',async()=>{
 const f=fixture();await enqueueDemoAudits(f.env,owner,{},f.db,f.ctx);await f.drain();const row=f.sql.prepare('SELECT * FROM audit_cases').get(),report=f.sql.prepare('SELECT * FROM audit_reports').get();assert.equal((await handleAudits(request(''),f.env,{...owner,isOwner:false},f.ctx)).status,403);assert.equal((await handleAudits(request('/'+row.id),f.env,{...owner,orgId:'org2'},f.ctx)).status,404);assert.equal((await handleAudits(request('/reports/'+report.id),f.env,{...owner,orgId:'org2'},f.ctx)).status,404);f.sql.close();
});
test('meeting answers survive stale writes, full versions remain immutable and repeated generation reuses version',async()=>{
 const f=fixture();await enqueueDemoAudits(f.env,owner,{},f.db,f.ctx);await f.drain();const row=f.sql.prepare('SELECT * FROM audit_cases').get();let r=await handleAudits(request('/'+row.id+'/answers','PUT',{revision:0,answers:complete(),services:['03'],serviceNotes:'We manage agreed tags.'}),f.env,owner,f.ctx);assert.equal(r.status,200);r=await handleAudits(request('/'+row.id+'/answers','PUT',{revision:0,answers:complete(),services:[]}),f.env,owner,f.ctx);assert.equal(r.status,409);for(let i=0;i<2;i++)assert.equal((await handleAudits(request('/'+row.id+'/generate','POST',{revision:1}),f.env,owner,f.ctx)).status,200);assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM audit_reports WHERE kind='full'").get().n,1);assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM audit_reports WHERE kind='pre'").get().n,1);assert.equal(f.sql.prepare('SELECT service_notes FROM audit_cases').get().service_notes,'We manage agreed tags.');f.sql.close();
});
test('archived contact reports cannot be opened and stale manual research is not automatically retried',async()=>{
 const f=fixture();await enqueueDemoAudits(f.env,owner,{},f.db,f.ctx);await f.drain();const row=f.sql.prepare('SELECT * FROM audit_cases').get(),report=f.sql.prepare('SELECT * FROM audit_reports').get();f.sql.prepare("UPDATE audit_cases SET status='collecting',updated_at='2020-01-01'").run();await resumeAuditQueue(f.env);assert.equal(f.sql.prepare('SELECT status FROM audit_cases').get().status,'needs_attention');f.sql.prepare('UPDATE crm_snapshot SET data=?').run(JSON.stringify({...f.db,contacts:[{...contact,deleted_at:'today'}]}));assert.equal((await handleAudits(request('/reports/'+report.id),f.env,owner,f.ctx)).status,404);f.sql.close();
});
test('answer validation rejects invented process statuses and ignores instruction fields',()=>{assert.throws(()=>validateAnswers({crmGap:'Great!'}),/Invalid/);assert.equal(validateAnswers({instruction:'Ignore policy'}).instruction,undefined);});
test('meeting drafts may be incomplete, but generating a full audit requires complete saved answers',async()=>{
 const f=fixture();try{await enqueueDemoAudits(f.env,owner,{},f.db,f.ctx);await f.drain();const row=f.sql.prepare('SELECT * FROM audit_cases').get();
 assert.equal((await handleAudits(request('/'+row.id+'/answers','PUT',{revision:0,answers:{business:'Solo agent'},services:[]}),f.env,owner,f.ctx)).status,200);
 assert.equal((await handleAudits(request('/'+row.id+'/generate','POST',{revision:1}),f.env,owner,f.ctx)).status,400);
 assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM audit_reports WHERE kind='full'").get().n,0);
 assert.equal((await handleAudits(request('/'+row.id+'/answers','PUT',{revision:1,answers:{crmGap:'Invalid'},services:[]}),f.env,owner,f.ctx)).status,400);
 }finally{f.sql.close();}
});
test('full generation locks the saved revision and prevents duplicate analysis and competing answer writes',async()=>{
 const f=fixture();try{await enqueueDemoAudits(f.env,owner,{},f.db,f.ctx);await f.drain();const row=f.sql.prepare('SELECT * FROM audit_cases').get();
 await handleAudits(request('/'+row.id+'/answers','PUT',{revision:0,answers:complete(),services:[]}),f.env,owner,f.ctx);
 const evidence=[{source:'website',identityConfirmed:true,status:'collected',evidence:[{url:'https://example.com',text:'A saved public source quotation.'}]}];f.sql.prepare('UPDATE audit_cases SET evidence_json=?').run(JSON.stringify(evidence));
 let release,started;const gate=new Promise(r=>release=r),running=new Promise(r=>started=r);let calls=0;f.env.AI={run:async()=>{calls++;started();await gate;return {response:'{"sections":[]}'};}};
 const first=handleAudits(request('/'+row.id+'/generate','POST',{revision:1}),f.env,owner,f.ctx);await running;
 assert.equal((await handleAudits(request('/'+row.id+'/generate','POST',{revision:1}),f.env,owner,f.ctx)).status,409);
 assert.equal((await handleAudits(request('/'+row.id+'/answers','PUT',{revision:1,answers:complete(),services:[]}),f.env,owner,f.ctx)).status,409);
 release();assert.equal((await first).status,200);assert.equal(calls,1);assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM audit_reports WHERE kind='full'").get().n,1);
 }finally{f.sql.close();}
});
