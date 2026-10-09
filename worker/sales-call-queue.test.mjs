import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {buildCallQueue,handleCallQueue} from './call-queue.mjs';

const NOW=Date.parse('2026-10-08T14:00:00Z'),DAY=86400000;
const owner={id:'u_owner',orgId:'org1',name:'Owner',isOwner:true};
const associate={id:'u_sales',orgId:'org1',name:'Fictional sales associate',email:'sales@example.test',isOwner:false,visibility:{profile:'sales_associate',scope:'all_sales',sections:['calls','contacts','pipeline'],editSections:['calls','contacts','pipeline']}};
const assigned={...associate,visibility:{...associate.visibility,scope:'assigned'}};
const contributor={...associate,visibility:{profile:'contributor',scope:'all_sales',sections:['calls'],editSections:['calls']}};
const contact=(id='c1',extra={})=>({id,name:'Fictional prospect '+id,status:'Not contacted',phone:'+1 212 555 '+String(1000+Number(id.slice(1)||1)),timezone:'America/New_York',created_at:'2026-10-08T13:59:00Z',owner_user_id:'u_other',notes:'PRIVATE NOTES DO NOT EXPOSE',onboarding_vault:{private:'PRIVATE VAULT'},...extra});
const db=(contacts=[contact()],extra={})=>({contacts,calls:[],emails:[],meetings:[],reminders:[],activity:[],users:[{id:'u_other',name:'PRIVATE STAFF NAME',email:'private@example.test'},{id:associate.id,name:associate.name,email:associate.email}],...extra});
const all=q=>[...q.available,...q.upcoming,...q.review];
const row=(q,id='c1')=>all(q).find(r=>r.contactId===id);
const req=(path='',method='GET',body)=>new Request('https://crm.test/api/call-queue'+path,{method,body:body===undefined?undefined:JSON.stringify(body)});
const outcome=(extra={})=>({contactId:'c1',idempotencyKey:'sales_attempt_identifier_001',outcome:'Connected',note:'Discussed public sales priorities.',...extra});
function fixture(data=db()){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);CREATE TABLE zoom_crm_meetings(id TEXT,org_id TEXT,matched_contact_id TEXT,zoom_meeting_id TEXT,zoom_status TEXT,meeting_ended_at TEXT,archived_at TEXT);');sql.prepare('INSERT INTO crm_snapshot VALUES(?,?,?,?)').run('org1',JSON.stringify(data),'2026-10-08T12:00:00Z','owner');
 const wrap=(s,v=[])=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});
 const env={DB:{prepare(q){const s=sql.prepare(q);return {...wrap(s),bind(...v){return wrap(s,v);}};}}};
 return {sql,env,read:()=>JSON.parse(sql.prepare('SELECT data FROM crm_snapshot WHERE org_id=?').get('org1').data),write(value){sql.prepare('UPDATE crm_snapshot SET data=?,updated_at=? WHERE org_id=?').run(JSON.stringify(value),'2026-10-08T13:00:00Z','org1');}};
}
const options={now:()=>NOW};

test('trusted Sales all-sales profile sees eligible prospects and Clients regardless of owner, with minimal private context',()=>{
 const records=['Not contacted','Contacted','Booked','Client','Past client','Paused'].map((status,i)=>contact('c'+(i+1),{status,created_at:'2026-09-01T12:00:00Z'}));
 records.push(contact('c7',{archived_at:'today'}),contact('c8',{deleted_at:'today'}));
 const q=buildCallQueue(db(records),associate,NOW);assert.equal(q.queueMode,'contacts');assert.equal(q.contactScope,'all_sales');assert.equal(q.queueTitle,'Next to call');assert.deepEqual(all(q).map(r=>r.contactId).sort(),['c1','c2','c3','c4','c5','c6']);assert.deepEqual(q.eligibleStatuses,['Not contacted','Contacted','Booked','Client','Past client','Paused']);assert.equal(row(q,'c3').status,'Booked');
 const serialized=JSON.stringify(q);for(const secret of ['PRIVATE NOTES','PRIVATE VAULT','PRIVATE STAFF NAME','private@example.test','u_other'])assert.ok(!serialized.includes(secret));
});

test('Sales assigned scope honors authenticated ID/email aliases and does not expose unassigned records',()=>{
 const records=[contact('c1',{owner_user_id:associate.id}),contact('c2',{owner_user_id:null,assigned_to:associate.email}),contact('c3',{name:'PRIVATE UNASSIGNED PROSPECT'})];
 const q=buildCallQueue(db(records),assigned,NOW);assert.equal(q.contactScope,'assigned');assert.deepEqual(all(q).map(r=>r.contactId).sort(),['c1','c2']);assert.ok(!JSON.stringify(q).includes('PRIVATE UNASSIGNED PROSPECT'));
});

test('owner and contributor retain assigned Client follow-up behavior without Sales profile auto-grants',()=>{
 const data=db([contact(),contact('c2',{status:'Client',owner_user_id:contributor.id,created_at:'2026-09-01T12:00:00Z'}),contact('c3',{status:'Client',created_at:'2026-09-01T12:00:00Z'})]);
 const own=buildCallQueue(data,owner,NOW),staff=buildCallQueue(data,contributor,NOW);assert.equal(own.queueMode,'contacts');assert.equal(own.queueTitle,'Next to call');assert.deepEqual(all(own).map(r=>r.contactId).sort(),['c1','c2','c3']);assert.deepEqual(all(staff).map(r=>r.contactId),['c2']);assert.equal(staff.contactScope,'assigned');
});

test('first Sales outreach ignores recent creation or unknown baseline while Client follow-ups keep inactivity checks',()=>{
 const q=buildCallQueue(db([contact(),contact('c2',{created_at:null}),contact('c3',{status:'Client'})]),associate,NOW,30);
 for(const id of ['c1','c2']){assert.equal(row(q,id).availableNow,true);assert.equal(row(q,id).firstSalesOutreach,true);assert.deepEqual(row(q,id).reasonCodes,['sales_outreach_ready']);}
 assert.equal(row(q,'c3').bucket,'upcoming');assert.equal(row(q,'c3').firstSalesOutreach,false);assert.ok(row(q,'c3').reasonCodes.includes('recent_meaningful_contact'));
});

test('a real recent meaningful interaction gates Sales prospect follow-up and hides inaccessible source details',()=>{
 const data=db([contact('c1',{created_at:null})],{emails:[{contact_id:'c1',provider:'zoho',zoho_message_id:'verified-id',direction:'incoming',received_at:new Date(NOW-DAY).toISOString(),body:'PRIVATE EMAIL BODY'}]});const q=buildCallQueue(data,associate,NOW,7);assert.equal(row(q).firstSalesOutreach,false);assert.equal(row(q).availableNow,false);assert.equal(row(q).lastMeaningfulKind,'recorded interaction');assert.ok(row(q).reasonCodes.includes('recent_meaningful_contact'));assert.ok(!JSON.stringify(q).includes('PRIVATE EMAIL BODY'));
});

test('Sales first outreach still respects local window, unsuccessful attempt cooldown and future callback',()=>{
 const data=db([contact(),contact('c2',{timezone:'America/Los_Angeles'}),contact('c3')],{calls:[{contact_id:'c1',at:new Date(NOW-3600000).toISOString(),outcome:'No answer'}],reminders:[{contact_id:'c3',kind:'Call',at:new Date(NOW+3600000).toISOString(),done:false}]});const q=buildCallQueue(data,associate,NOW);
 assert.ok(row(q).reasonCodes.includes('attempt_cooldown'));assert.equal(row(q).availableNow,false);assert.equal(row(q,'c2').availableNow,false);assert.ok(row(q,'c2').reasonCodes.includes('outside_calling_hours'));assert.equal(row(q,'c3').opensAt,new Date(NOW+3600000).toISOString());assert.equal(row(q,'c3').availableNow,false);
});

test('Sales never includes DNC variants, withdrawn consent, samples or missing phones, and unresolved timezone remains review',()=>{
 const records=[contact('c1',{do_not_call:true}),contact('c2',{tags:['DNC']}),contact('c3',{tags:'prospect, Do Not Call'}),contact('c4',{consent_withdrawn_at:'today'}),contact('c5',{is_sample:true}),contact('c6',{phone:''}),contact('c7',{timezone:''}),contact('c8',{timezone:'America/New_York',timezone_review:true})];const q=buildCallQueue(db(records),associate,NOW);
 assert.equal(q.available.length,0);assert.deepEqual(q.review.map(r=>r.contactId),['c7','c8']);assert.ok(q.review.every(r=>r.reasonCodes.includes('timezone_unknown')));assert.deepEqual(q.excluded,{sample:1,missingPhone:1,withdrawn:1,doNotCall:3});
});

test('shared prospect/Client phone requires review without leaking unassigned identity',()=>{
 const first=contact('c1',{owner_user_id:associate.id}),second=contact('c2',{status:'Client',name:'PRIVATE UNASSIGNED DUPLICATE',phone:first.phone});const q=buildCallQueue(db([first,second]),assigned,NOW);assert.equal(q.review.length,1);assert.equal(q.review[0].reasonCodes[0],'duplicate_phone');assert.ok(!JSON.stringify(q).includes(second.name));
});

test('client-supplied Sales mode and all-sales scope cannot authorize contributor prospect GET/check/outcome',async()=>{
 const f=fixture(db([contact('c1',{owner_user_id:'unassigned_other'})]));try{const q=await (await handleCallQueue(req('?mode=sales&scope=all_sales'),f.env,contributor,options)).json();assert.equal(q.queueMode,'contacts');assert.equal(all(q).length,0);
 const check=await handleCallQueue(req('/check','POST',{contactId:'c1',mode:'sales',scope:'all_sales',profile:'sales_associate'}),f.env,contributor,options);assert.equal(check.status,404);
 const write=await handleCallQueue(req('/outcome','POST',outcome({mode:'sales',scope:'all_sales',profile:'sales_associate'})),f.env,contributor,options);assert.equal(write.status,404);assert.equal(f.read().calls.length,0);
 }finally{f.sql.close();}
});

test('trusted Sales check validates canonical current hours/timezone/DNC and never calls providers or writes storage',async t=>{
 const f=fixture();let external=0;t.mock.method(globalThis,'fetch',()=>{external++;throw Error('Provider calls forbidden');});try{const before=f.read(),valid=await handleCallQueue(req('/check','POST',{contactId:'c1',inactivityDays:30,scope:'assigned'}),f.env,associate,options);assert.equal(valid.status,200);const body=await valid.json();assert.equal(body.queueMode,'contacts');assert.equal(body.eligible,true);assert.match(body.idempotencyKey,/^[a-f0-9-]{36}$/);assert.deepEqual(f.read(),before);assert.equal(external,0);
 for(const [extra,reason] of [[{do_not_call:true},'do_not_call'],[{timezone_review:true},'timezone_unknown'],[{timezone:'America/Los_Angeles'},'outside_calling_hours']]){f.write(db([contact('c1',extra)]));const rejected=await handleCallQueue(req('/check','POST',{contactId:'c1'}),f.env,associate,options);assert.equal(rejected.status,409);assert.ok((await rejected.json()).reasonCodes.includes(reason));}
 }finally{f.sql.close();}
});

test('Sales manual outcome preserves status, assignment/private fields, owns attribution and replays once',async()=>{
 const data=db([contact(),contact('c2')],{org:{private:'KEEP'},notes:[{id:'n1',body:'KEEP PRIVATE'}]}),f=fixture(data);try{const payload=outcome({by_user_id:'forged',queue_mode:'client_followup',status:'Client',owner_user_id:'forged',phone:'forged'}),first=await handleCallQueue(req('/outcome','POST',payload),f.env,associate,options);assert.equal(first.status,200);let saved=f.read();assert.deepEqual(saved.contacts,data.contacts);assert.deepEqual(saved.notes,data.notes);assert.deepEqual(saved.org,data.org);assert.equal(saved.calls.length,1);assert.equal(saved.calls[0].by_user_id,associate.id);assert.equal(saved.calls[0].queue_mode,'contacts');assert.equal(saved.calls[0].number,data.contacts[0].phone);assert.equal(saved.activity[0].target.section,'calls');assert.equal(saved.activity[0].by_user_id,associate.id);
 const replay=await handleCallQueue(req('/outcome','POST',payload),f.env,associate,options);assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);saved=f.read();assert.equal(saved.calls.length,1);assert.equal(saved.activity.length,1);assert.equal(row(buildCallQueue(saved,associate,NOW)).firstSalesOutreach,false);assert.equal(row(buildCallQueue(saved,associate,NOW,7)).availableNow,false);
 }finally{f.sql.close();}
});

test('Sales callback and DNC outcomes mutate only the intended canonical calling fields',async()=>{
 const f=fixture();try{const callback='2026-10-09T14:00:00Z',response=await handleCallQueue(req('/outcome','POST',outcome({outcome:'Call back later',callbackAt:callback})),f.env,associate,options);assert.equal(response.status,200);let saved=f.read();assert.equal(saved.reminders[0].assignee_user_id,associate.id);assert.equal(saved.reminders[0].contact_id,'c1');assert.equal(saved.reminders[0].at,'2026-10-09T14:00:00.000Z');assert.equal(saved.contacts[0].status,'Not contacted');
 const dnc=await handleCallQueue(req('/outcome','POST',outcome({idempotencyKey:'sales_attempt_identifier_002',outcome:'Do not call',note:'Asked us not to call again.'})),f.env,associate,options);assert.equal(dnc.status,200);saved=f.read();assert.equal(saved.contacts[0].do_not_call,true);assert.equal(saved.contacts[0].do_not_call_by,associate.id);assert.equal(saved.contacts[0].owner_user_id,'u_other');assert.equal(all(buildCallQueue(saved,associate,NOW)).length,0);
 }finally{f.sql.close();}
});

test('read-only or removed Calls permission fails closed for Sales check/outcome before storage',async()=>{
 const env={DB:{prepare(){throw Error('Storage must not be read');}}};for(const user of [{...associate,visibility:{...associate.visibility,editSections:[]}},{...associate,visibility:{...associate.visibility,sections:['contacts','pipeline']}}])for(const path of ['/check','/outcome'])assert.equal((await handleCallQueue(req(path,'POST',outcome()),env,user,options)).status,403);
 const readOnly={...associate,visibility:{...associate.visibility,editSections:[]}},q=buildCallQueue(db(),readOnly,NOW);assert.equal(q.canCall,false);assert.equal(q.canLog,false);assert.equal(q.available.length,1);
});

test('current Sales scope/profile/contact revocation is enforced on outcome and idempotent retry',async()=>{
 const f=fixture();try{const payload=outcome(),first=await handleCallQueue(req('/outcome','POST',payload),f.env,associate,options);assert.equal(first.status,200);
 const assignedRetry=await handleCallQueue(req('/outcome','POST',payload),f.env,assigned,options);assert.equal(assignedRetry.status,404);
 const contributorRetry=await handleCallQueue(req('/outcome','POST',payload),f.env,contributor,options);assert.equal(contributorRetry.status,404);
 const data=f.read();data.contacts[0].archived_at='2026-10-08';f.write(data);assert.equal((await handleCallQueue(req('/outcome','POST',payload),f.env,associate,options)).status,404);assert.equal(f.read().calls.length,1);
 }finally{f.sql.close();}
});

test('new prospect cannot bypass historical or hidden shared-number DNC while unrelated phones remain callable',()=>{
 const current=contact('c1',{owner_user_id:associate.id});
 for(const extra of [{status:'Past client',do_not_call:true},{archived_at:'today',do_not_call:true},{deleted_at:'today',consent_withdrawn_at:'2026-10-01'},{status:'Paused',tags:['Do Not Call']},{status:'Past client',consent_status:'withdrawn'}]){
  const historical=contact('c9',{name:'PRIVATE HISTORICAL IDENTITY',phone:current.phone.replace('+1 ',''),owner_user_id:'u_hidden',...extra}),q=buildCallQueue(db([current,historical,contact('c2',{owner_user_id:associate.id})]),assigned,NOW);
  assert.equal(row(q),undefined);assert.equal(row(q,'c2').availableNow,true);assert.equal(q.excluded.doNotCall,1);assert.ok(!JSON.stringify(q).includes('PRIVATE HISTORICAL IDENTITY'));assert.ok(!JSON.stringify(q).includes('u_hidden'));
 }
});

test('recorded shared-number DNC still protects an archived or missing contact without revealing its identity',()=>{
 const current=contact(),past=contact('c9',{status:'Past client',archived_at:'today',phone:current.phone}),recorded={contact_id:'c9',number:current.phone,outcome:'Do not call',at:'2026-09-01T14:00:00Z',note:'PRIVATE CALL NOTE',by:'PRIVATE STAFF IDENTITY'};
 for(const contacts of [[current,past],[current]]){const q=buildCallQueue(db(contacts,{calls:[recorded]}),associate,NOW);assert.equal(row(q),undefined);assert.equal(q.excluded.doNotCall,1);assert.ok(!JSON.stringify(q).includes('PRIVATE CALL NOTE'));assert.ok(!JSON.stringify(q).includes('PRIVATE STAFF IDENTITY'));}
});

test('verified later canonical consent supersedes shared legacy DNC, but never an unresolved explicit restriction',()=>{
 const current=contact(),past=contact('c9',{status:'Past client',phone:current.phone}),call={contact_id:past.id,number:current.phone,outcome:'Do not call',at:'2026-09-01T14:00:00Z'};
 for(const consent of ['2026-08-01T14:00:00Z','2026-09-01T14:00:00Z','2026-10-09T14:00:00Z','invalid']){assert.equal(row(buildCallQueue(db([{...current,consent_given_at:consent},past],{calls:[call]}),associate,NOW)),undefined);}
 const verified={...current,consent_given_at:'2026-09-02T14:00:00Z'};assert.ok(row(buildCallQueue(db([verified,past],{calls:[call]}),associate,NOW)).reasonCodes.includes('duplicate_phone'));
 assert.equal(row(buildCallQueue(db([verified,{...past,do_not_call:true}],{calls:[call]}),associate,NOW)),undefined);
});

test('sample, automatic or future DNC evidence never blocks an unrelated real prospect',()=>{
 const current=contact(),past=contact('c9',{status:'Past client',phone:current.phone,is_sample:true,do_not_call:true}),call={contact_id:past.id,number:current.phone,outcome:'Do not call',at:'2026-09-01T14:00:00Z'};
 assert.equal(row(buildCallQueue(db([current,past],{calls:[call]}),associate,NOW)).availableNow,true);
 for(const extra of [{automated:true},{is_sample:true},{at:'2026-10-09T14:00:00Z'}])assert.equal(row(buildCallQueue(db([current],{calls:[{...call,...extra}]}),associate,NOW)).availableNow,true);
});

test('changing a historical contact number does not release its original dialed DNC number',()=>{
 const current=contact(),past=contact('c9',{status:'Past client',phone:'+1 212 555 9999',consent_given_at:'2026-09-02T14:00:00Z'}),call={contact_id:past.id,number:current.phone,outcome:'Do not call',at:'2026-09-01T14:00:00Z'};
 const q=buildCallQueue(db([current,past,contact('c2')],{calls:[call]}),associate,NOW);assert.equal(row(q),undefined);assert.equal(row(q,'c2').availableNow,true);
});

test('targeted check applies historical shared-phone consent without leaking or modifying hidden records',async()=>{
 const current=contact('c1',{owner_user_id:associate.id}),hidden=contact('c9',{status:'Past client',phone:current.phone,name:'PRIVATE HISTORICAL IDENTITY',do_not_call:true}),f=fixture(db([current,hidden]));try{
  const before=f.read(),response=await handleCallQueue(req('/check','POST',{contactId:current.id}),f.env,assigned,options);assert.equal(response.status,409);const rejected=await response.json();assert.deepEqual(rejected.reasonCodes,['do_not_call']);assert.match(rejected.error,/phone number/);assert.equal(rejected.contact,undefined);assert.ok(!JSON.stringify(rejected).includes(hidden.name));assert.deepEqual(f.read(),before);
 }finally{f.sql.close();}
});

test('full queue prepares canonical consent once rather than rescanning it for every eligible row',()=>{
 let consentReads=0,originalNumberReads=0;const records=Array.from({length:500},(_,i)=>{const c=contact('c'+(i+1));Object.defineProperty(c,'consent_given_at',{enumerable:true,get(){consentReads++;return null;}});return c;}),recorded={contact_id:'historical',outcome:'Do not call',at:'2026-09-01T14:00:00Z'};
 Object.defineProperty(recorded,'number',{enumerable:true,get(){originalNumberReads++;return '+1 212 555 9999';}});const q=buildCallQueue(db(records,{calls:[recorded]}),associate,NOW);assert.equal(q.available.length,500);assert.equal(consentReads,500);assert.equal(originalNumberReads,1);
});

test('a large calling list reuses timezone validation and repeated timestamp labels rather than formatting every contact',t=>{
 const NativeFormatter=Intl.DateTimeFormat;let constructors=0,formats=0;
 t.mock.method(Intl,'DateTimeFormat',function(...args){constructors++;const formatter=new NativeFormatter(...args),format=formatter.format;Object.defineProperty(formatter,'format',{value:date=>{formats++;return format(date);}});return formatter;});
 const records=Array.from({length:500},(_,i)=>contact('c'+(i+1),{timezone:'America/Toronto'})),at=Date.parse('2026-10-14T14:00:00Z'),q=buildCallQueue(db(records),associate,at);
 assert.equal(q.available.length,500);assert.ok(constructors<=4,'Timezone validation and formatters must be reused across the same zone');assert.ok(formats<=10,'Identical local/PKT timestamps must be formatted once, not per contact');
 assert.ok(q.available.every(row=>row.localNow===q.available[0].localNow&&row.closesLocal===q.available[0].closesLocal));
});
