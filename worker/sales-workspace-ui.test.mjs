import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {scopeSnapshot,mergeScopedWrite} from './user-access.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const template=JSON.parse(html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]);
const code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture({edits=['contacts','pipeline','calls'],profile='sales_associate',scope='all_sales',full}={}){
 const context={Date,Intl,JSON,Math,URL,URLSearchParams,structuredClone,console,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
 location:{hostname:'crm.example.invalid',origin:'https://crm.example.invalid'},document:{querySelectorAll:()=>[]},
 window:{scrollTo(){},addEventListener(){},removeEventListener(){},location:{reload(){}}},
 DCLogic:class{setState(value,callback){this.state={...this.state,...(typeof value==='function'?value(this.state):value)};callback?.();}}};
 vm.createContext(context);vm.runInContext(code+';globalThis.ReviewComponent=Component;',context);
 const c=new context.ReviewComponent();c.props={};c.persistDb=()=>{};c.toast=message=>{c.lastToast=message;};
 const user={id:'u_sales',orgId:'org1',name:'QA Sales associate',email:'sales@example.invalid',roleCode:profile,roleName:'Sales associate',isOwner:false,visibility:{profile,scope,sections:['contacts','pipeline','calls'],editSections:edits}};
 full ||= {org:{id:'org1',capacity_hours:230,trigger:.75},users:[{id:'u1',auth_user_id:user.id,name:user.name,email:user.email,role:'Contributor'},{id:'u2',name:'Private operator',email:'private@example.invalid',role:'Owner / Admin'}],
 contacts:[{id:'c1',name:'QA compact import',owner:'Private operator',owner_user_id:'u2',timezone:'',timezone_review:true,tz_source:'',state:'',phone:'+12025550111',status:'Not contacted',lead_source:'Imported list',call_start:9,call_end:18,tags:['public','assign-private'],notes:'PRIVATE OWNER NOTE',services:['03'],monthly_override:1100,onboarding_vault:{secret:'PRIVATE'},sales_notes:'Shared initial context'},
 {id:'c2',name:'QA existing client',owner:'Private operator',status:'Client',timezone:'America/Chicago',tags:[]}],
 deals:[{id:'d1',contact_id:'c1',stage:'Demo scheduled',scope_agreed:'PRIVATE PRICE AND SCOPE',checks:{intro:true},sales_notes:'Shared opportunity',tags:['public','owner-private'],meeting_at:'2026-10-10T14:00:00.000Z',meeting_tz:'America/New_York',artifact_type:'CRM snapshot',artifact_minutes:20},{id:'d2',contact_id:'c2',stage:'Initiate',scope_agreed:'',checks:{}}],todos:[],tickets:[],meetings:[],sop_instances:[],checklists:{precall:[],onboarding:[]}};
 c.state={...c.state,authChecked:true,accessUser:user,dbLoadFailed:false,meIdUnresolved:false,meId:'u1',db:c.normalizeScopedWorkspace(scopeSnapshot(full,user)),view:'contacts',contactId:'c1',fStatus:'All',fService:'All',now:Date.parse('2026-10-08T12:00:00Z')};
 c.x=()=>({db:c.state.db,live:c.state.db.contacts,clients:c.state.db.contacts.filter(c=>c.status==='Client'),byId:Object.fromEntries(c.state.db.contacts.map(c=>[c.id,c])),wStart:9,wEnd:17});
 return {c,user,full};
}
const roundTrip=({c,user,full})=>mergeScopedWrite(full,plain(c.workspaceWritePayload()),user);
const field=(c,label)=>c.contactVals(c.x()).cd.fields.find(row=>row.label===label);

test('sales identity keeps administrator controls off and navigation restricted to three sales sections',()=>{
 const {c}=fixture(),model=c.renderVals();assert.equal(c.isContributor(),true);assert.equal(model.canManageRecords,false);assert.equal(model.canManageSalesContact,true);assert.equal(model.canManageSalesDeal,true);
 assert.deepEqual(plain(model.navGroups.flatMap(g=>g.items.map(i=>i.label))),['Contacts','Pipeline','Calls']);
 for(const section of ['users','command','work','tickets','reports','audits','social','clients','calendar'])assert.equal(c.canView(section),false,section);
 assert.equal(model.canShowContactPanel,true);assert.equal(model.canShowContactModules,false);assert.ok(!model.contactCols.includes('Monthly'));assert.ok(!model.contactCols.includes('Modules'));
 const detail=c.contactVals(c.x()).cd;assert.deepEqual(plain(detail.tabs.map(t=>t.label)),['Details','Deals','Calls','Sales notes']);assert.ok(detail.fields.every(f=>c.salesContactFields().includes(f.key)));
 const rendered=JSON.stringify(plain({...detail,fields:detail.fields.map(f=>({label:f.label,value:f.value}))}));assert.doesNotMatch(rendered,/PRIVATE|Private operator|monthly_override|onboarding_vault/);
});

test('normalizing a sales snapshot adds no owner defaults, inferred time zone or private modules',()=>{
 const {c}=fixture(),before=plain(c.state.db.contacts);c.ensureEnhancements(c.state.db);assert.deepEqual(plain(c.state.db.contacts),before);assert.equal(c.state.db.contacts[0].timezone,'');
 assert.ok(!Object.hasOwn(c.state.db.contacts[0],'owner'));assert.ok(!Object.hasOwn(c.state.db.contacts[0],'services'));assert.equal(c.state.db.users.length,1);
});

test('compact imported contact detail edits save safely and preserve canonical private records and routing tags',()=>{
 const f=fixture(),{c,full}=f;field(c,'Name').onChange({target:{value:'QA edited contact'}});field(c,'Email').onChange({target:{value:'edited@example.invalid'}});field(c,'City').onChange({target:{value:'Washington'}});field(c,'Tags').onChange({target:{value:'public, reviewed'}});field(c,'Sales notes').onChange({target:{value:'Shared updated context'}});
 const out=roundTrip(f),row=out.contacts.find(c=>c.id==='c1');assert.equal(row.name,'QA edited contact');assert.equal(row.email,'edited@example.invalid');assert.equal(row.city,'Washington');assert.equal(row.sales_notes,'Shared updated context');assert.ok(row.tags.includes('assign-private'));assert.equal(row.timezone,'');assert.equal(row.timezone_review,true);
 assert.equal(row.owner,full.contacts[0].owner);assert.equal(row.notes,full.contacts[0].notes);assert.equal(row.monthly_override,1100);assert.deepEqual(out.contacts.find(c=>c.id==='c2'),full.contacts[1]);
});

test('sales direct guards reject private field and approval writes while shared notes remain editable',()=>{
 const f=fixture(),{c}=f,before=JSON.stringify(c.state.db);for(const key of ['owner','services','monthly_override','notes','onboarding_vault','deleted_at'])c.patch('contacts','c1',key,'invalid','Invalid');c.patch('deals','d1','scope_agreed','invalid','Invalid');assert.equal(JSON.stringify(c.state.db),before);
 c.patch('contacts','c1','sales_notes','Authorized sales context','Sales notes');assert.equal(roundTrip(f).contacts[0].sales_notes,'Authorized sales context');
 c.state.modal='scope';c.state.draft={scope:'Invalid bypass'};c.saveModal(c.x());assert.match(c.state.err,/Ibrar/);
});

test('client status is read-only for sales and bulk changes reject client and final-status bypasses',()=>{
 const {c}=fixture();c.state.contactId='c2';assert.equal(field(c,'Status').disabled,true);field(c,'Status').onChange({target:{value:'Contacted'}});assert.equal(c.state.db.contacts.find(c=>c.id==='c2').status,'Client');
 c.state.modal='bulkcontactstatus';c.state.draft={ids:['c1','c2'],status:'Contacted'};c.saveModal(c.x());assert.match(c.state.err,/prospect status/);assert.equal(c.state.db.contacts[0].status,'Not contacted');
 c.state.draft={ids:['c1'],status:'Client'};c.saveModal(c.x());assert.match(c.state.err,/prospect status/);
 c.state.draft={ids:['c1'],status:'Contacted'};c.saveModal(c.x());assert.equal(c.state.db.contacts[0].status,'Contacted');
});

test('sales deal stage changes send no SOP seeds and server derives approval-gated progression',()=>{
 const f=fixture(),{c}=f;c.moveDeal('d1','Meeting held');assert.equal(c.state.db.sop_instances.length,0);assert.equal(c.state.db.todos.length,0);assert.equal(c.state.db.deals[0].stage,'Meeting held');const out=roundTrip(f);assert.equal(out.deals[0].stage,'Meeting held');
 c.state.db=scopeSnapshot(out,f.user);c.moveDeal('d1','Closed won');assert.throws(()=>mergeScopedWrite(out,plain(c.workspaceWritePayload()),f.user),/complete client acceptance/);
 c.moveDeal('d2','Contract sent');assert.match(c.lastToast,/approve written scope/);assert.equal(c.state.db.deals.find(d=>d.id==='d2').stage,'Initiate');
});

test('meeting dates, next action, preparation and shared deal notes round trip without exposing written scope',()=>{
 const f=fixture(),{c}=f;c.openSalesDeal('d1');const editor=c.modalVals(c.x());assert.equal(editor.modalFields.find(field=>field.label==='Written scope').isInfo,true);assert.match(editor.modalFields.find(field=>field.label==='Written scope').hint,/approved by Ibrar/);
 c.state.draft={...c.state.draft,stage:'Meeting held',date:'2026-10-12',time:'11:30',nextDate:'2026-10-13',nextTime:'09:00',timezone:'Eastern',minutes:'35',salesNotes:'Confirmed the next meeting',tags:'follow-up'};c.saveModal(c.x());const out=roundTrip(f),deal=out.deals.find(d=>d.id==='d1');assert.equal(deal.meeting_at,'2026-10-12T15:30:00.000Z');assert.equal(deal.next_action_at,'2026-10-13T13:00:00.000Z');assert.equal(deal.artifact_minutes,35);assert.equal(deal.sales_notes,'Confirmed the next meeting');assert.equal(deal.scope_agreed,f.full.deals[0].scope_agreed);assert.ok(deal.tags.includes('owner-private'));
});

test('new contacts and scheduled deals use minimal allowed fields and save through the scoped merger',()=>{
 const f=fixture(),{c}=f;c.state.modal='quickadd';c.state.draft={name:'QA new prospect',email:'new@example.invalid',phone:'+12025550112',state:'',timezone:'Choose a time zone',status:'Not contacted',salesNotes:'Shared public business context'};c.saveModal(c.x());let out=roundTrip(f);const added=out.contacts.find(r=>r.name==='QA new prospect');assert.ok(added);assert.equal(added.owner,f.user.name);assert.equal(added.timezone,'');assert.equal(added.timezone_review,true);assert.ok(!Object.hasOwn(added,'monthly_override'));
 f.full=out;c.state.db=c.normalizeScopedWorkspace(scopeSnapshot(out,f.user));c.state.modal='newdeal';c.state.draft={contact:'QA new prospect',stage:'Demo scheduled',date:'2026-10-12',time:'09:30',timezone:'Eastern'};c.saveModal(c.x());out=roundTrip(f);const deal=out.deals.find(d=>d.contact_id===added.id);assert.ok(deal);assert.equal(deal.meeting_at,'2026-10-12T13:30:00.000Z');assert.equal(deal.meeting_tz,'America/New_York');assert.equal(out.contacts.find(c=>c.id===added.id).status,'Booked');
});

test('read-only Sales has visible records and no contact, deal, prep or bulk mutation',()=>{
 const {c}=fixture({edits:[]}),before=JSON.stringify(c.state.db);assert.equal(c.renderVals().canManageSalesContact,false);assert.equal(c.renderVals().canManageSalesDeal,false);field(c,'Name').onChange({target:{value:'Invalid'}});c.moveDeal('d1','Meeting held');c.openQuickForRole();c.openSalesDeal('d1');
 for(const modal of ['quickadd','newdeal','prep','bulktag','bulkdealstage']){c.state.modal=modal;c.state.draft={collection:'contacts'};c.saveModal(c.x());assert.match(c.state.err,/read-only/);}assert.equal(JSON.stringify(c.state.db),before);
});

test('assigned contributor does not inherit Sales editing or Pipeline navigation',()=>{
 const {c}=fixture({profile:'contributor',scope:'assigned',edits:['contacts','pipeline','calls']});assert.equal(c.isSalesAssociate(),false);assert.equal(c.canManageSalesContact(),false);assert.equal(c.canManageSalesDeal(),false);assert.equal(c.canView('pipeline'),false);c.state.modal='newdeal';c.state.draft={contact:'QA compact import'};c.saveModal(c.x());assert.match(c.state.err,/Ibrar/);
});

test('large compact import shape survives Sales normalization and an unrelated contact edit without fabricated protected fields',()=>{
 const full=fixture().full;full.contacts=Array.from({length:4588},(_,i)=>({id:'qa_import_'+i,name:'QA imported prospect '+i,...(i%7?{email:'qa'+i+'@example.invalid'}:{}),phone:'+1202555'+String(i%10000).padStart(4,'0'),brokerage:'QA Brokerage',owner:'Private operator',state:'',status:'Not contacted',timezone:i<154?'':'America/New_York',...(i<154?{timezone_review:true}:{}),tz_source:i<154?'':'area',call_start:9,call_end:18,tags:['master realtor list','assign-private'],lead_source:'QA import',...(i<885?{source_last_activity:'QA source text, timezone unknown'}:{}),created_at:'2026-10-08T12:00:00Z'}));full.deals=[];const f=fixture({full}),{c}=f;
 const row=c.state.db.contacts.find(row=>!row.email&&row.timezone_review);assert.ok(row,'Compact unknown-zone example exists');c.state.contactId=row.id;c.ensureEnhancements(c.state.db);field(c,'Sales notes').onChange({target:{value:'QA round-trip verification'}});
 const out=roundTrip(f);assert.equal(out.contacts.length,full.contacts.length);assert.equal(out.contacts.find(c=>c.id===row.id).sales_notes,'QA round-trip verification');assert.equal(out.contacts.find(c=>c.id===row.id).timezone,'');assert.equal(out.contacts.filter(c=>c.timezone_review).length,full.contacts.filter(c=>c.timezone_review).length);
});

test('Sales state edits preserve confirmed manual and unflagged unknown zones without guessing New York',()=>{
 const f=fixture(),{c}=f;Object.assign(c.state.db.contacts[0],{timezone:'America/Chicago',timezone_review:false,tz_source:'manual'});field(c,'State').onChange({target:{value:'CA'}});assert.equal(c.state.db.contacts[0].timezone,'America/Chicago');assert.equal(c.state.db.contacts[0].tz_source,'manual');
 delete c.state.db.contacts[0].timezone;delete c.state.db.contacts[0].timezone_review;assert.equal(c.contactZone(c.state.db.contacts[0]),'');assert.equal(c.contactVals(c.x()).cd.time,'Unknown');assert.equal(c.contactZoneChoice(c.state.db.contacts[0]),'Choose a time zone');field(c,'State').onChange({target:{value:'NY'}});assert.ok(!c.state.db.contacts[0].timezone);
});

test('native flush submits a narrow Sales payload and adopts the canonical saved projection',async()=>{
 const f=fixture(),{c,user,full}=f;field(c,'Name').onChange({target:{value:'QA saved through native flush'}});c.moveDeal('d1','Meeting held');c._savedEpoch=0;c._snapshotEtag='"before"';let seen;
 c.apiFetch=async(path,options)=>{assert.equal(path,'/api/db');assert.equal(options.method,'PUT');assert.equal(options.headers['If-Match'],'"before"');seen=JSON.parse(options.body);assert.ok(seen.contacts.every(row=>!Object.hasOwn(row,'org_id')&&!Object.hasOwn(row,'owner')&&!Object.hasOwn(row,'notes')));assert.ok(seen.deals.every(row=>!Object.hasOwn(row,'scope_agreed')));const saved=mergeScopedWrite(full,seen,user);return {ok:true,status:200,headers:{get:key=>key.toLowerCase()==='etag'?'"after"':key.toLowerCase()==='content-type'?'application/json':null},json:async()=>({data:{ok:true,updatedAt:'after'},snapshot:scopeSnapshot(saved,user)})};};
 await c.flushDb();assert.ok(seen);assert.equal(c.state.saveStatus,'saved');assert.equal(c._snapshotEtag,'"after"');assert.equal(c.state.db.contacts[0].name,'QA saved through native flush');assert.equal(c.state.db.deals[0].stage,'Meeting held');assert.equal(c.state.db.sop_instances.length,0);assert.equal(c._savedEpoch,c._saveEpoch);
});

test('native save errors leave the Sales edit visible and explicitly unsaved',async()=>{
 const {c}=fixture();field(c,'Sales notes').onChange({target:{value:'Keep the unsaved Sales context'}});c._savedEpoch=0;c.apiFetch=async()=>({ok:false,status:409,json:async()=>({error:'Saved data changed. Reload before retrying.'})});await c.flushDb();assert.equal(c.state.saveStatus,'error');assert.equal(c.state.saveConflict,true);assert.match(c.state.saveError,/Reload/);assert.equal(c.state.db.contacts[0].sales_notes,'Keep the unsaved Sales context');assert.ok(c._savedEpoch<c._saveEpoch);
});
