import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {handleCallQueue} from './call-queue.mjs';
import {scopeSnapshot} from './user-access.mjs';
const require=createRequire(import.meta.url),{integrateStaffManualCalls}=require('./integrate-staff-manual-calls.cjs');
const raw=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),original=JSON.parse(raw.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/)[1]),template=integrateStaffManualCalls(original),code=template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
const NOW=Date.parse('2026-10-08T14:00:00.000Z');
class FixtureDate extends Date{constructor(...args){super(...(args.length?args:[NOW]));}static now(){return NOW;}}
const plain=x=>JSON.parse(JSON.stringify(x));
const response=(body,status=200,type='application/json')=>new Response(type==='application/json'?JSON.stringify(body):body,{status,headers:{'Content-Type':type}});

function fixture({edits=['contacts','pipeline','calls'],sections=['contacts','pipeline','calls'],scope='all_sales',profile='sales_associate'}={}){
 let key=0;const requests=[],notices=[];
 const context={Date:FixtureDate,Intl,JSON,Math,URL,URLSearchParams,structuredClone,console,crypto:{randomUUID:()=> 'manual_attempt_identifier_'+(++key)},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},confirm:()=>true,
  location:{hostname:'crm.example.invalid',origin:'https://crm.example.invalid'},document:{querySelectorAll:()=>[]},window:{scrollTo(){},addEventListener(){},removeEventListener(){},location:{reload(){}}},
  DCLogic:class{setState(value,callback){this.state={...this.state,...(typeof value==='function'?value(this.state):value)};callback?.();}}};
 vm.createContext(context);vm.runInContext(code+';globalThis.TestComponent=Component;',context);
 const c=new context.TestComponent();c.props={};c.toast=message=>notices.push(message);
 const user={id:'u_sales',orgId:'org1',name:'Fictional sales associate',email:'sales@example.test',roleCode:profile,isOwner:false,visibility:{profile,scope,sections,editSections:edits}};
 const full={org:{id:'org1',capacity_hours:230,trigger:.75},users:[{id:'legacy_sales',auth_user_id:user.id,name:user.name,email:user.email,role:'Contributor'},{id:'u_private',name:'Private owner',email:'private@example.test',role:'Owner / Admin'}],
  contacts:[{id:'c1',name:'Fictional prospect',status:'Not contacted',phone:'+12125550111',timezone:'America/New_York',owner_user_id:'u_private',notes:'PRIVATE OWNER NOTES',onboarding_vault:{secret:'PRIVATE VAULT'},sales_notes:'Shared sales context',created_at:'2026-10-08T13:00:00Z'},{id:'c2',name:'Fictional assigned prospect',status:'Contacted',phone:'+12125550222',timezone:'America/New_York',owner_user_id:user.id}],
  calls:[],notes:[{id:'private_note',body:'PRIVATE OWNER NOTES'}],reminders:[],activity:[],todos:[],tickets:[],meetings:[],deals:[],checklists:{precall:[],onboarding:[]}};
 c.state={...c.state,authChecked:true,accessUser:user,dbLoadFailed:false,meIdUnresolved:false,meId:'legacy_sales',db:c.normalizeScopedWorkspace(scopeSnapshot(full,user)),view:'callqueue',now:NOW};c._saveEpoch=0;c._savedEpoch=0;
 c.apiFetch=async(path,input)=>{requests.push({path,input});return response({ok:true,duplicate:false,updatedAt:'snapshot-next'});};c.refreshAuditDocuments=async()=>{c.refreshCount=(c.refreshCount||0)+1;};
 const x=()=>({db:c.state.db,live:c.state.db.contacts,clients:[],byId:Object.fromEntries(c.state.db.contacts.map(c=>[c.id,c]))});
 const enter=(values={outcome:'Connected',note:'Discussed their follow-up process.'})=>{c.endCallDialog('c1','+12125550111');c.setState({draft:{...c.state.draft,...values}});};
 return {c,user,full,requests,notices,enter,x};
}

test('staff manual-call transform is repeat-safe and the outcome form offers labeled outcome and notes',()=>{
 assert.equal(integrateStaffManualCalls(template),template);
 const f=fixture();f.enter();const model=f.c.modalVals(f.x());assert.equal(model.modalTitle,'Record call outcome');assert.match(model.modalSub,/phone connection is not required/);assert.deepEqual(plain(model.modalFields.map(f=>f.label)),['Outcome','Call notes','Callback date · PKT','Callback time · PKT']);
 assert.equal(model.modalFields[0].isSelect,true);assert.equal(model.modalFields[1].isArea,true);assert.match(model.modalFields[1].hint,/contact’s call outcome/);
});

test('sales native Save records the manual outcome and notes through the permitted endpoint without Zoom or snapshot mutation',async()=>{
 const f=fixture();f.enter();const before=plain(f.c.state.db);await f.c.saveModal(f.x());assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,'/api/call-queue/outcome');assert.equal(f.requests[0].input.method,'POST');
 assert.deepEqual(JSON.parse(f.requests[0].input.body),{contactId:'c1',idempotencyKey:'manual_attempt_identifier_1',outcome:'Connected',note:'Discussed their follow-up process.'});assert.deepEqual(plain(f.c.state.db),before);assert.equal(f.c.state.modal,null);assert.equal(f.c.refreshCount,1);assert.match(f.notices.at(-1),/outcome and notes saved/);assert.equal(f.c._saveEpoch,0);
});

test('native manual outcome and notes reach canonical storage under Sales all-sales access without a phone mapping',async t=>{
 const f=fixture(),sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);');sql.prepare('INSERT INTO crm_snapshot VALUES(?,?,?,?)').run('org1',JSON.stringify(f.full),'snapshot-old','owner');
 const wrap=(s,v=[])=>({first:async()=>s.get(...v)||null,run:async()=>({meta:{changes:Number(s.run(...v).changes)}})}),env={DB:{prepare(q){const s=sql.prepare(q);return {...wrap(s),bind(...v){return wrap(s,v);}};}}};
 let providers=0;t.mock.method(globalThis,'fetch',()=>{providers++;throw Error('External services are not part of a manual log');});
 f.c.apiFetch=(path,input)=>{f.requests.push({path,input});return handleCallQueue(new Request('https://crm.example.invalid'+path,{method:input.method,headers:input.headers,body:input.body}),env,f.user,{now:()=>NOW});};
 try{f.enter({outcome:'No answer',note:'Rang their business number; left no message.'});await f.c.saveModal(f.x());const saved=JSON.parse(sql.prepare('SELECT data FROM crm_snapshot').get().data);assert.equal(saved.calls.length,1);assert.equal(saved.calls[0].outcome,'No answer');assert.equal(saved.calls[0].note,'Rang their business number; left no message.');assert.equal(saved.calls[0].by_user_id,f.user.id);assert.equal(saved.calls[0].queue_mode,'contacts');assert.deepEqual(saved.notes,f.full.notes);assert.deepEqual(saved.contacts,f.full.contacts);assert.equal(providers,0);}finally{sql.close();}
});

test('missing or read-only Calls permissions block native open and save before any network request',async()=>{
 for(const config of [{edits:['contacts','pipeline']},{sections:['contacts','pipeline'],edits:['contacts','pipeline']}]){const f=fixture(config);f.enter();assert.notEqual(f.c.state.modal,'callend');f.c.setState({modal:'callend',draft:{contact_id:'c1',outcome:'Connected',note:'Unauthorized'}});await f.c.saveModal(f.x());assert.equal(f.requests.length,0);assert.match(f.c.state.err,/read-only|unavailable/);}
});

test('unknown contact and invalid outcomes or notes fail before transmitting an attempt',async()=>{
 for(const values of [{contact_id:'hidden'},{outcome:''},{outcome:'Invented'},{note:'x'.repeat(4001)},{outcome:'Do not call',note:''},{outcome:'Wrong number',note:''},{outcome:'Call back later',note:'Requested tomorrow.'}]){const f=fixture();f.enter({...{outcome:'Connected',note:'Public notes'},...values});await f.c.saveModal(f.x());assert.equal(f.requests.length,0);assert.equal(f.c.state.modal,'callend');assert.ok(f.c.state.err);}
});

test('a requested callback uses explicit PKT and sends neither profile, scope nor user-supplied attribution',async()=>{
 const f=fixture();f.enter({outcome:'Call back later',note:'Requested tomorrow at 7 PM PKT.',callbackDate:'2026-10-09',callbackTime:'19:00',profile:'owner',scope:'all',by_user_id:'u_private'});await f.c.saveModal(f.x());const sent=JSON.parse(f.requests[0].input.body);assert.equal(sent.callbackAt,'2026-10-09T14:00:00.000Z');assert.deepEqual(Object.keys(sent).sort(),['callbackAt','contactId','idempotencyKey','note','outcome']);
});

test('duplicate Save clicks are blocked while the manual outcome is pending',async()=>{
 const f=fixture();let release;f.c.apiFetch=(path,input)=>{f.requests.push({path,input});return new Promise(resolve=>{release=resolve;});};f.enter();const pending=f.c.saveModal(f.x());assert.equal(f.c.state.manualCallSaving,true);assert.equal(f.c.modalVals(f.x()).modalSaving,true);assert.ok(f.c.modalVals(f.x()).modalFields.every(field=>field.disabled));await f.c.saveModal(f.x());assert.equal(f.requests.length,1);f.c.closeNativeModal();assert.equal(f.c.state.modal,'callend');release(response({ok:true}));await pending;assert.equal(f.c.state.manualCallSaving,false);
});

test('unknown save response retains the identical attempt and notes for retry without duplicating a completed call',async()=>{
 const f=fixture();let attempt=0;f.c.apiFetch=async(path,input)=>{f.requests.push({path,input});if(++attempt===1)throw Error('Connection interrupted');return response({ok:true,duplicate:true});};f.enter();await f.c.saveModal(f.x());assert.equal(f.c.state.manualCallUncertain,true);assert.equal(f.c.state.modal,'callend');assert.equal(f.c.state.draft.note,'Discussed their follow-up process.');assert.ok(f.c.modalVals(f.x()).modalFields.every(field=>field.disabled));f.c.closeNativeModal();assert.equal(f.c.state.modal,'callend');await f.c.saveModal(f.x());assert.equal(f.requests[0].input.body,f.requests[1].input.body);assert.equal(f.c.state.manualCallUncertain,false);assert.equal(f.c.state.modal,null);assert.match(f.notices.at(-1),/already saved/);
});

test('HTML sign-in responses never discard a manual outcome or surface a JSON parser error',async()=>{
 const f=fixture();f.c.apiFetch=async(path,input)=>{f.requests.push({path,input});return response('<!DOCTYPE html><title>Cloudflare sign in</title>',200,'text/html');};f.enter();await f.c.saveModal(f.x());assert.match(f.c.state.err,/session|Sign in/);assert.doesNotMatch(f.c.state.err,/Unexpected token/);assert.equal(f.c.state.manualCallUncertain,true);assert.equal(f.c.state.draft.note,'Discussed their follow-up process.');
});

test('definite rejection leaves editable notes and current permission loss prevents retry',async()=>{
 const f=fixture();f.c.apiFetch=async(path,input)=>{f.requests.push({path,input});return response({error:'This contact is outside your calling scope.'},404);};f.enter();await f.c.saveModal(f.x());assert.equal(f.c.state.manualCallUncertain,false);assert.equal(f.c.state.draft.note,'Discussed their follow-up process.');assert.ok(f.c.modalVals(f.x()).modalFields.every(field=>!field.disabled));f.c.state.accessUser.visibility.editSections=[];await f.c.saveModal(f.x());assert.equal(f.requests.length,1);assert.match(f.c.state.err,/read-only|unavailable/);
});

test('pending snapshot edits are saved first and failed autosave preserves the outcome draft',async()=>{
 const f=fixture();f.enter();f.c._saveEpoch=1;f.c.flushDb=async()=>{f.c._savedEpoch=1;};await f.c.saveModal(f.x());assert.equal(f.requests.length,1);
 const failed=fixture();failed.enter();failed.c._saveEpoch=1;failed.c.flushDb=async()=>failed.c.setState({saveError:'Denied'});await failed.c.saveModal(failed.x());assert.equal(failed.requests.length,0);assert.equal(failed.c.state.modal,'callend');assert.match(failed.c.state.err,/pending contact changes/);assert.equal(failed.c.state.manualCallUncertain,false);
});

test('staff keypad manual logging opens the same outcome form instead of attempting snapshot ledger writes',()=>{
 const f=fixture(),before=plain(f.c.state.db);f.c.setState({dialPad:'12125550111',dialerContactId:'c1',dialerNote:'An actual completed external call.'});f.c.logManualCall('Voicemail');assert.equal(f.c.state.modal,'callend');assert.equal(f.c.state.draft.outcome,'Voicemail');assert.equal(f.c.state.draft.note,'An actual completed external call.');assert.deepEqual(plain(f.c.state.db),before);assert.equal(f.requests.length,0);assert.equal(f.c._saveEpoch,0);
});
