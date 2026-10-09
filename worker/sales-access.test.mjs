import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {attachVisibility,canonicalUsers,scopeSnapshot,mergeScopedWrite,handleUsers,allowedStaffRoute,canAccessSalesContact,canAccessSalesDeal} from './user-access.mjs';
import {DEAL_STAGES} from './sales-access.mjs';
import {handleDbBlobRequest} from './worker.js';
import {encodeSnapshot,decodeSnapshot,SNAPSHOT_GZIP_PREFIX} from './snapshot-codec.mjs';
const sales=(scope='all_sales',edits=['contacts','pipeline','calls'],sections=['contacts','pipeline','calls'])=>({id:'u_sales',orgId:'org1',email:'sales@example.test',name:'Sales Person',roleCode:'sales_associate',isOwner:false,visibility:{profile:'sales_associate',scope,sections,editSections:edits}});
const source=()=>({
 users:[{id:'legacy_sales',auth_user_id:'u_sales',email:'sales@example.test',name:'Sales Person',role:'Sales associate',status:'active'},{id:'u_ibrar',auth_user_id:'u_ibrar',email:'owner@example.test',name:'Ibrar',role:'Owner / Admin'},{id:'other',name:'Other Operator',email:'operator@example.test'}],
 contacts:[
  {id:'lead',name:'Warm Realtor',phone:'+12125551234',email:'realtor@example.test',brokerage:'A Realty',status:'Not contacted',owner_user_id:'other',timezone:'America/New_York',tz_source:'Phone area estimate',timezone_review:true,tags:['assign-other','Warm','DNC'],created_at:'2026-09-01T00:00:00Z',notes:'private operations',monthly_override:900,onboarding_vault:{password:'secret'},zoom_user_id:'private mapping'},
  {id:'mine',name:'Assigned Realtor',status:'Contacted',owner_user_id:'u_sales',timezone:'America/Chicago',tags:[]},
  {id:'client',name:'Existing Client',status:'Client',owner_user_id:'other',timezone:'America/Denver',notes:'private finance note',monthly_override:1000},
  {id:'archived',name:'Archived Contact',status:'Not contacted',archived_at:'2026-10-01'},
  {id:'deleted',name:'Deleted Contact',status:'Client',deleted_at:'2026-10-01'}
 ],
 deals:[{id:'deal',contact_id:'lead',stage:'Meeting held',meeting_at:'2026-10-08T15:00:00Z',meeting_tz:'America/New_York',scope_agreed:'Owner approved work for $900',notes:'private deal note',price:900,assignee:'Other Operator',tags:['owner-other','Warm']},{id:'mineDeal',contact_id:'mine',stage:'Audit sent'},{id:'otherAssignedDeal',contact_id:'mine',stage:'Audit sent',assignee:'Other Operator'}],
 todos:[{id:'privateTask',assignee:'Other Operator',title:'Private owner task',contact_id:'lead'}],files:[{id:'file',contact_id:'lead',name:'Private document'}],sop_instances:[],sop_templates:[{id:'sop_audit',title:'Audit',version:3,steps:[{id:'research',title:'Research',due_days:0}]}],calls:[],activity:[],org:{name:'Serene Ops',capacity_hours:300,revenue:900},user_prefs:{},access:[{password:'secret'}],tickets:[],social_posts:[],meetings:[],reminders:[]
});
const input=(db,user=sales())=>scopeSnapshot(db,user);
test('all-sales reveals basic contacts and deals without staff, private notes, files or commercial values',()=>{
 const db=source(),scoped=input(db);assert.deepEqual(scoped.contacts.map(c=>c.id),['lead','mine','client']);assert.equal(scoped.deals.length,3);assert.deepEqual(scoped.users.map(u=>u.name),['Sales Person']);
 assert.deepEqual(scoped.files,[]);assert.deepEqual(scoped.todos,[]);assert.deepEqual(scoped.sop_templates,[]);assert.deepEqual(scoped.access,[]);assert.equal(scoped.org.revenue,undefined);
 const text=JSON.stringify(scoped);for(const secret of ['Other Operator','private operations','private finance','Private document','private mapping','Owner approved work','monthly_override','onboarding_vault','assign-other','owner-other'])assert.equal(text.includes(secret),false,secret);
 assert.equal(scoped.deals[0].scope_ready,true);assert.equal(scoped.deals[0].meeting_tz,'America/New_York');assert.deepEqual(scoped.contacts[0].tags,['Warm','DNC']);
});
test('assigned sales scope preserves explicit deal assignee precedence and section removal',()=>{
 const db=source(),user=sales('assigned');assert.deepEqual(input(db,user).contacts.map(c=>c.id),['mine']);assert.deepEqual(input(db,user).deals.map(d=>d.id),['mineDeal']);
 assert.equal(canAccessSalesContact(db.contacts[0],db,user),false);assert.equal(canAccessSalesDeal(db.deals[2],db,user),false);
 const pipelineOnly=sales('all_sales',[],['pipeline']);const scoped=input(db,pipelineOnly);assert.deepEqual(scoped.contacts[0],{id:'lead',name:'Warm Realtor',timezone:'America/New_York'});assert.equal(scoped.contacts[0].phone,undefined);
 scoped.contacts[0].name='Changed through context';assert.throws(()=>mergeScopedWrite(db,scoped,pipelineOnly),/read-only/);
});
test('an unchanged sales projection saves without changing hidden data or routing tag order, including read-only access',()=>{
 const db=source();for(const user of [sales(),sales('all_sales',[])])assert.deepEqual(mergeScopedWrite(db,input(db,user),user),db);
});
test('sales edits use independent public notes and preserve protected consent and routing tags',()=>{
 const db=source();db.contacts[0].do_not_call=true;const body=input(db);Object.assign(body.contacts[0],{name:'Updated Name',sales_notes:'Asked to follow up next week',tags:['New tag']});body.deals[0].sales_notes='Discussed next steps';body.deals[0].tags=['Priority'];
 const saved=mergeScopedWrite(db,body,sales()),contact=saved.contacts[0];assert.equal(contact.notes,'private operations');assert.equal(contact.monthly_override,900);assert.equal(contact.do_not_call,true);assert.deepEqual(contact.tags,['assign-other','DNC','New tag']);assert.equal(contact.sales_notes,'Asked to follow up next week');assert.equal(saved.deals[0].notes,'private deal note');assert.deepEqual(saved.deals[0].tags,['owner-other','Priority']);assert.equal(saved.activity.every(a=>a.by_user_id==='u_sales'),true);
});
test('every queue-recognized do-not-call tag variant survives a sales tag edit',()=>{
 for(const tag of ['DNC','Do not call','do-not-call',' DO NOT CALL ']){const db=source();db.contacts[0].tags=[tag];const body=input(db);body.contacts[0].tags=[];assert.deepEqual(mergeScopedWrite(db,body,sales()).contacts[0].tags,[tag]);}
});
test('new routing tags and protected contact changes are rejected rather than silently expanded',()=>{
 for(const change of [{owner_user_id:'u_sales'},{do_not_call:false},{consent_withdrawn_at:null},{notes:'forged private note'},{monthly_override:0},{archived_at:'today'},{zoom_user_id:'new mapping'},{status:'Client'},{tags:['assign-sales']}]){const db=source(),body=input(db);Object.assign(body.contacts[0],change);assert.throws(()=>mergeScopedWrite(db,body,sales()),/Sales|Routing/);}
});
test('existing Client and Past client states remain owner-controlled',()=>{
 for(const status of ['Client','Past client']){const db=source();db.contacts[2].status=status;const body=input(db);body.contacts.find(c=>c.id==='client').status='Contacted';assert.throws(()=>mergeScopedWrite(db,body,sales()),/Client status is controlled/);}
});
test('contact scope, read permission, section removal and forged user access cannot be bypassed through a snapshot',()=>{
 const db=source();assert.throws(()=>mergeScopedWrite(db,{contacts:[{id:'lead',name:'Outside',phone:'555'}]},sales('assigned')),/outside your sales/);
 assert.throws(()=>mergeScopedWrite(db,{contacts:[{id:'lead',name:'Changed'}]},sales('all_sales',[],['calls'])),/read-only/);
 for(const change of [{isOwner:true},{profile:'owner'},{visibility:{scope:'all'}},{current_user_visibility:{scope:'all'}}])assert.throws(()=>mergeScopedWrite(db,{...input(db),...change},sales()),/Only Ibrar/);
 const body=input(db);body.users[0].role='Owner / Admin';assert.throws(()=>mergeScopedWrite(db,body,sales()),/Only Ibrar/);
 for(const path of ['/api/users','/api/contacts','/api/deals','/api/audits','/api/zoom/calls'])assert.equal(allowedStaffRoute(path,'POST',sales()),false);
});
test('phone-area changes invalidate an estimate but explicit valid manual timezone selection is retained',()=>{
 const db=source(),body=input(db);body.contacts[0].phone='+13105551234';const contact=mergeScopedWrite(db,body,sales()).contacts[0];assert.equal(contact.timezone,'');assert.equal(contact.timezone_review,true);assert.equal(contact.tz_source,'');
 const explicit=input(db);Object.assign(explicit.contacts[0],{phone:'+13105551234',timezone:'America/Los_Angeles'});const selected=mergeScopedWrite(db,explicit,sales()).contacts[0];assert.equal(selected.timezone,'America/Los_Angeles');assert.equal(selected.timezone_review,false);assert.equal(selected.tz_source,'manual');
 const sameArea=input(db);sameArea.contacts[0].phone='(212) 555-9876';assert.equal(mergeScopedWrite(db,sameArea,sales()).contacts[0].timezone,'America/New_York');
});
test('timezone verification metadata cannot be forged, and read-only projections do not confirm estimates',()=>{
 const db=source();for(const change of [{timezone_review:false},{tz_source:''},{timezone:'US/Invented'},{timezone:'America/Los_Angeles',tz_source:'Phone area'}]){const body=input(db);Object.assign(body.contacts[0],change);if(change.timezone==='America/Los_Angeles'){const saved=mergeScopedWrite(db,body,sales()).contacts[0];assert.equal(saved.tz_source,'manual');assert.equal(saved.timezone_review,false);}else assert.throws(()=>mergeScopedWrite(db,body,sales()),/timezone/);}
 assert.equal(mergeScopedWrite(db,input(db),sales()).contacts[0].timezone_review,true);
});
test('new compact contacts are assigned by the server, without inherited private defaults or fake created dates',()=>{
 const db=source(),body=input(db);body.contacts.push({id:'new_contact',name:'New Realtor',email:'new@example.test',phone:'+13105551234',timezone:'America/Los_Angeles',created_at:'2000-01-01',status:'Not contacted',sales_notes:'New source'});const saved=mergeScopedWrite(db,body,sales()),contact=saved.contacts.find(c=>c.id==='new_contact');assert.equal(contact.owner_user_id,'u_sales');assert.equal(contact.owner,'Sales Person');assert.equal(contact.org_id,'org1');assert.notEqual(contact.created_at,'2000-01-01');assert.equal(contact.timezone_review,false);assert.equal(contact.tz_source,'manual');assert.equal(contact.monthly_override,undefined);
 const forged=input(db);forged.contacts.push({id:'forged',name:'Forged',owner_user_id:'u_ibrar'});assert.throws(()=>mergeScopedWrite(db,forged,sales()),/Sales cannot/);
});
test('annual transaction buckets from the native contact selector remain valid on edits and unrelated saves',()=>{
 for(const value of ['Under 10','10 to 25','25 to 50','50+',45]){const db=source(),body=input(db);body.contacts[0].transactions_per_year=value;assert.equal(mergeScopedWrite(db,body,sales()).contacts[0].transactions_per_year,value);db.contacts[0].transactions_per_year=value;const unrelated=input(db);unrelated.contacts[0].sales_notes='Unrelated contact update';assert.equal(mergeScopedWrite(db,unrelated,sales()).contacts[0].transactions_per_year,value);}
});
test('deals validate stages, dates and IANA meeting zones and protect links, scope and pricing',()=>{
 for(const change of [{stage:'Won'},{meeting_at:'tomorrow'},{meeting_tz:'Invented/Zone'},{contact_id:'client'},{price:0},{scope_agreed:'Fabricated approved scope'},{scope_ready:false}]){const db=source(),body=input(db);Object.assign(body.deals[0],change);assert.throws(()=>mergeScopedWrite(db,body,sales()),/valid|Sales cannot|cannot be moved|controlled/);}
 assert.equal(DEAL_STAGES.includes('Closed won'),true);const db=source(),body=input(db);Object.assign(body.deals[0],{meeting_tz:'America/Chicago',sales_notes:'Confirmed local meeting timezone'});assert.equal(mergeScopedWrite(db,body,sales()).deals[0].meeting_tz,'America/Chicago');
});
test('contract and Closed won gates use canonical written scope and owner acceptance',()=>{
 const db=source();db.deals[0].scope_agreed='';let body=input(db);body.deals[0].stage='Contract sent';assert.throws(()=>mergeScopedWrite(db,body,sales()),/Written scope/);
 db.deals[0].scope_agreed='Owner written scope';body=input(db);body.deals[0].stage='Closed won';body.sop_instances=[{template_id:'sop_acceptance',contact_id:'lead',status:'Complete'}];assert.throws(()=>mergeScopedWrite(db,body,sales()),/Ibrar must complete/);
 db.sop_instances=[{template_id:'sop_acceptance',contact_id:'lead',status:'Complete'}];body=input(db);body.deals[0].stage='Closed won';const saved=mergeScopedWrite(db,body,sales());assert.equal(saved.contacts[0].status,'Client');assert.equal(saved.deals[0].stage,'Closed won');assert.equal(saved.activity[0].by_user_id,'u_sales');
});
test('demo stage derives owner workflow from saved template, never staff-supplied SOPs or tasks',()=>{
 const db=source(),body=input(db);body.deals.push({id:'new_deal',contact_id:'lead',stage:'Demo scheduled',meeting_at:'2026-10-09T15:00:00Z',meeting_tz:'America/New_York'});const saved=mergeScopedWrite(db,body,sales());assert.equal(saved.contacts[0].status,'Booked');assert.equal(saved.sop_instances[0].assignee,'Ibrar');assert.equal(saved.sop_instances[0].template_version,3);assert.equal(saved.todos.find(t=>t.sop_instance_id===saved.sop_instances[0].id).assignee,'Ibrar');assert.deepEqual(input(saved).todos,[]);assert.deepEqual(input(saved).sop_instances,[]);
 const forged=input(db);forged.todos=[{id:'injected',title:'Inject a task'}];assert.throws(()=>mergeScopedWrite(db,forged,sales()),/section is no longer/);
});
test('sales calling activity allows own all-sales prospect outcomes while hiding other callers and ledgers',()=>{
 const db=source(),user=sales('all_sales',['calls'],['calls','activity']);db.calls=[{id:'call',contact_id:'lead',queue:'next_to_call',queue_mode:'sales',by_user_id:user.id}];db.activity=[{id:'mineCall',who:user.name,kind:'call',target:{section:'calls',recordId:'lead',callId:'call'},contact_id:'lead',what:'Connected'},{id:'otherCall',who:'Other Operator',kind:'call',target:{section:'calls',recordId:'lead',callId:'call'},what:'private conversation'}];const scoped=input(db,user);assert.deepEqual(scoped.activity.map(a=>a.id),['mineCall']);assert.deepEqual(scoped.calls,[]);assert.deepEqual(scoped.contacts,[]);
});
function fixture(migrate=true){const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE users(id TEXT PRIMARY KEY,org_id TEXT,name TEXT,email TEXT,role_id TEXT,status TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT,deleted_at TEXT);CREATE TABLE user_visibility(org_id TEXT,user_id TEXT,sections_json TEXT,edit_sections_json TEXT,updated_at TEXT,PRIMARY KEY(org_id,user_id));CREATE TABLE user_invitations(user_id TEXT,org_id TEXT,status TEXT,access_status TEXT,sent_at TEXT);");sql.prepare('INSERT INTO users(id,org_id,name,email,role_id,status) VALUES(?,?,?,?,?,?)').run('u_ibrar','org1','Ibrar','owner@example.test','role_owner_admin','active');if(migrate)sql.exec(readFileSync(new URL('./migrations/20261008_sales_access.sql',import.meta.url),'utf8'));const wrap=(query,values=[])=>({first:async()=>query.get(...values)||null,all:async()=>({results:query.all(...values)}),run:async()=>({meta:{changes:Number(query.run(...values).changes)}})});return{sql,env:{DB:{prepare(text){const q=sql.prepare(text);return{...wrap(q),bind(...v){return wrap(q,v);}};}}}};}
const owner={id:'u_ibrar',orgId:'org1',isOwner:true};const userRequest=(path,method,body)=>new Request('https://crm.test/api/users'+path,{method,body:body?JSON.stringify(body):undefined});
test('the sales migration defaults existing policies to Contributor/assigned without adding permissions',async()=>{
 const f=fixture(false);try{f.sql.prepare('INSERT INTO user_visibility VALUES(?,?,?,?,?)').run('org1','u_sales','["work"]','["work"]','old');f.sql.exec(readFileSync(new URL('./migrations/20261008_sales_access.sql',import.meta.url),'utf8'));const user=await attachVisibility(f.env,{...sales(),roleCode:'contributor'});assert.deepEqual(user.visibility,{sections:['work'],editSections:['work'],profile:'contributor',scope:'assigned'});assert.equal(user.isOwner,false);}finally{f.sql.close();}
});
test('owner provisions a Sales profile while underlying authentication role stays Contributor and no invitation is sent',async()=>{
 const f=fixture();try{const response=await handleUsers(userRequest('','POST',{name:'Sales Person',email:'sales@example.test',profile:'sales_associate',scope:'all_sales',sections:['contacts','pipeline','calls'],editSections:['contacts','pipeline','calls']}),f.env,owner);assert.equal(response.status,200);const result=await response.json(),raw=f.sql.prepare('SELECT * FROM users WHERE id=?').get(result.id);assert.equal(raw.role_id,'role_contributor');assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM user_invitations').get().n,0);const authenticated=await attachVisibility(f.env,{id:raw.id,orgId:'org1',roleCode:'contributor'});assert.equal(authenticated.isOwner,false);assert.equal(authenticated.roleCode,'sales_associate');assert.equal(authenticated.roleName,'Sales associate');assert.equal(authenticated.visibility.scope,'all_sales');const roster=await canonicalUsers(f.env,'org1');assert.equal(roster.find(u=>u.email==='sales@example.test').role,'Sales associate');const listing=await(await handleUsers(userRequest('','GET'),f.env,owner)).json();assert.equal(listing.users.find(u=>u.id===raw.id).profile,'sales_associate');assert.equal(listing.users.find(u=>u.id===raw.id).scope,'all_sales');}finally{f.sql.close();}
});
test('missing migration fails before creating an orphan Sales account',async()=>{
 const f=fixture(false);try{const response=await handleUsers(userRequest('','POST',{name:'Sales Person',email:'sales@example.test',profile:'sales_associate',scope:'all_sales',sections:['contacts'],editSections:['contacts']}),f.env,owner);assert.equal(response.status,503);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);}finally{f.sql.close();}
});
test('staff cannot grant their own Sales profile, while owner cannot accidentally grant all-sales to Contributor',async()=>{
 const f=fixture();try{const body={name:'Other',email:'other@example.test',profile:'contributor',scope:'all_sales',sections:['contacts'],editSections:['contacts']};assert.equal((await handleUsers(userRequest('','POST',body),f.env,sales())).status,403);assert.equal((await handleUsers(userRequest('','POST',body),f.env,owner)).status,400);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);}finally{f.sql.close();}
});
test('a newly provisioned sales actor can save a compressed workspace before their roster was persisted, with CAS and role protection',async t=>{
 const f=fixture();let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw Error('No external calls in this test');});try{
  f.sql.exec('CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);CREATE TABLE zoom_crm_meetings(org_id TEXT);CREATE TABLE audit_reports(id TEXT,audit_id TEXT,contact_id TEXT,kind TEXT,revision INTEGER,created_at TEXT,org_id TEXT);CREATE TABLE activity_log(id TEXT,org_id TEXT,who_user_id TEXT,what TEXT,contact_id TEXT);');
  f.sql.prepare('INSERT INTO users(id,org_id,name,email,role_id,status) VALUES(?,?,?,?,?,?)').run('u_sales','org1','Sales Person','sales@example.test','role_contributor','active');
  f.sql.prepare('INSERT INTO user_visibility VALUES(?,?,?,?,?,?,?)').run('org1','u_sales','["contacts","pipeline","calls"]','["contacts","pipeline","calls"]','now','sales_associate','all_sales');
  const db=source();db.users=db.users.filter(u=>u.auth_user_id!=='u_sales');db.original_imported_notes='Imported illustrative source notes. '.repeat(40000);const at='2026-10-08T12:00:00.000Z';f.sql.prepare('INSERT INTO crm_snapshot VALUES(?,?,?,?)').run('org1',await encodeSnapshot(JSON.stringify(db)),at,'owner');
  const user=await attachVisibility(f.env,{id:'u_sales',orgId:'org1',name:'Sales Person',email:'sales@example.test',roleCode:'contributor'});
  const get=await handleDbBlobRequest(new Request('https://crm.test/api/db'),f.env,user,{});assert.equal(get.status,200);const body=(await get.json()).data;assert.equal(body.users[0].role,'Sales associate');body.contacts[0].sales_notes='A legitimate sales edit';
  const put=(data,version=at)=>handleDbBlobRequest(new Request('https://crm.test/api/db',{method:'PUT',headers:{'If-Match':JSON.stringify(version)},body:JSON.stringify(data)}),f.env,user,{waitUntil(){throw Error('No new demo transition');}});
  const saved=await put(body);assert.equal(saved.status,200);const stored=f.sql.prepare('SELECT * FROM crm_snapshot').get();assert.ok(stored.data.startsWith(SNAPSHOT_GZIP_PREFIX));const decoded=await decodeSnapshot(stored.data);assert.equal(decoded.original_imported_notes,db.original_imported_notes);assert.equal(decoded.contacts[0].sales_notes,'A legitimate sales edit');assert.equal(decoded.contacts[0].notes,'private operations');assert.equal(stored.updated_by,'u_sales');assert.equal((await put(body)).status,409);
  body.users[0].role='Owner / Admin';assert.equal((await put(body,stored.updated_at)).status,403);assert.equal(network,0);
 }finally{f.sql.close();}
});
