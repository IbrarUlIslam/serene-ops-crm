import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {buildCallQueue as buildGeneralCallQueue,callingWindow,nextCallingWindow,handleCallQueue,CALL_OUTCOMES} from './call-queue.mjs';
import {encodeSnapshot,decodeSnapshot,SNAPSHOT_GZIP_PREFIX} from './snapshot-codec.mjs';

const buildCallQueue=(db,user,now,days=7,...rest)=>buildGeneralCallQueue(db,user,now,days,...rest);
const NOW=Date.parse('2026-10-08T14:00:00.000Z'),DAY=86400000;
const owner={id:'u_ibrar',orgId:'org1',name:'Ibrar',isOwner:true};
const staff={id:'u_staff',orgId:'org1',name:'Staff User',email:'staff@example.test',isOwner:false,visibility:{sections:['calls'],editSections:['calls']}};
const client=(id='c1',extra={})=>({id,name:'Client '+id,status:'Client',phone:'+1 212 555 '+String(1000+Number(id.replace(/\D/g,'')||1)),timezone:'America/New_York',created_at:'2026-09-01T13:00:00.000Z',owner_user_id:staff.id,notes:'PRIVATE CONTACT NOTES',...extra});
const db=(contacts=[client()],extra={})=>({contacts,calls:[],emails:[],meetings:[],reminders:[],activity:[],users:[{id:staff.id,name:staff.name,email:staff.email}],...extra});
const req=(path='?inactivityDays=7',method='GET',body)=>new Request('https://crm.test/api/call-queue'+path,{method,body:body===undefined?undefined:JSON.stringify(body)});
function fixture(data=db()){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE crm_snapshot(org_id TEXT PRIMARY KEY,data TEXT,updated_at TEXT,updated_by TEXT);CREATE TABLE zoom_crm_meetings(id TEXT,org_id TEXT,matched_contact_id TEXT,zoom_meeting_id TEXT,zoom_status TEXT,meeting_ended_at TEXT,archived_at TEXT);');sql.prepare('INSERT INTO crm_snapshot VALUES(?,?,?,?)').run('org1',JSON.stringify(data),'2026-10-08T12:00:00.000Z','owner');
 const wrap=(s,v=[])=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});
 const env={DB:{prepare(q){const s=sql.prepare(q);return {...wrap(s),bind(...v){return wrap(s,v);}};}}};
 return {sql,env,data,read(){return JSON.parse(sql.prepare('SELECT data FROM crm_snapshot WHERE org_id=?').get('org1').data);},write(value,version='2026-10-08T12:01:00.000Z'){sql.prepare('UPDATE crm_snapshot SET data=?,updated_at=? WHERE org_id=?').run(JSON.stringify(value),version,'org1');}};
}
const options={now:()=>NOW};
const all=queue=>[...queue.available,...queue.upcoming,...queue.review];
const row=(queue,id='c1')=>all(queue).find(r=>r.contactId===id);
const outcome=(extra={})=>({contactId:'c1',idempotencyKey:'attempt_identifier_0001',outcome:'Connected',note:'Discussed the seller update.',...extra});

test('only assigned non-archived contacts enter queue, with restricted/sample/no-phone clients excluded',()=>{
 const contacts=[client(),client('c2',{status:'Prospect'}),client('c3',{status:'Client',owner_user_id:'other'}),client('c4',{deleted_at:'today'}),client('c5',{archived_at:'today'}),client('c6',{is_sample:true}),client('c7',{phone:''}),client('c8',{consent_withdrawn_at:'2026-10-01'}),client('c9',{do_not_call:true})];
 const queue=buildCallQueue(db(contacts),staff,NOW);assert.deepEqual(all(queue).map(r=>r.contactId),['c1','c2']);assert.equal(queue.canCall,true);assert.deepEqual(queue.excluded,{sample:1,missingPhone:1,withdrawn:1,doNotCall:1});assert.ok(!JSON.stringify(queue).includes('PRIVATE CONTACT NOTES'));assert.ok(!JSON.stringify(queue).includes('Client c3'));
});
test('local 9–18 weekday defaults are separate from work hours and displayed in PKT',()=>{
 const queue=buildCallQueue(db([client('c1',{work_start:8,work_end:16}),client('c2',{timezone:'America/Los_Angeles'})]),owner,NOW);
 assert.equal(row(queue).availableNow,true);assert.equal(row(queue).windowStart,'09:00');assert.equal(row(queue).windowEnd,'18:00');assert.equal(row(queue).opensAt,'2026-10-08T13:00:00.000Z');assert.match(row(queue).opensPKT,/6:00 PM/);assert.equal(row(queue).windowClosingMinutes,480);
 const west=row(queue,'c2');assert.equal(west.bucket,'upcoming');assert.equal(west.opensAt,'2026-10-08T16:00:00.000Z');assert.match(west.opensPKT,/9:00 PM/);assert.equal(queue.callerTimezone,'Asia/Karachi');
});
test('weekend openings honor client dates and DST rather than fixed US offsets',()=>{
 assert.equal(nextCallingWindow(client(),Date.parse('2026-10-09T23:00:00Z')).at,Date.parse('2026-10-12T13:00:00Z'));
 assert.equal(nextCallingWindow(client(),Date.parse('2026-10-30T23:00:00Z')).at,Date.parse('2026-11-02T14:00:00Z'));
 assert.equal(nextCallingWindow(client(),Date.parse('2026-03-06T23:00:00Z')).at,Date.parse('2026-03-09T13:00:00Z'));
});
test('decimal/HH:mm hours and overnight day ownership are explicit, with exclusive closing boundary',()=>{
 assert.equal(callingWindow(client('c1',{call_start:9.5,call_end:'17:15'})).start,570);
 const c=client('c1',{call_start:'22:00',call_end:'02:00',call_days:['Friday']});const saturday=Date.parse('2026-10-10T05:00:00Z');assert.equal(nextCallingWindow(c,saturday).at,saturday);
 assert.equal(nextCallingWindow(c,Date.parse('2026-10-10T06:00:00Z')).at,Date.parse('2026-10-17T02:00:00Z'));
 assert.equal(nextCallingWindow(client(),Date.parse('2026-10-08T22:00:00Z')).at,Date.parse('2026-10-09T13:00:00Z'));
});
test('DST gap and repeated hour never make a disallowed local minute callable',()=>{
 const spring=client('c1',{call_start:'02:30',call_end:'04:00',call_days:[0]});assert.equal(nextCallingWindow(spring,Date.parse('2026-03-08T06:59:00Z')).at,Date.parse('2026-03-08T07:00:00Z'));
 const autumn=client('c1',{call_start:'01:30',call_end:'02:00',call_days:[0]});assert.equal(nextCallingWindow(autumn,Date.parse('2026-11-01T06:10:00Z')).at,Date.parse('2026-11-01T06:30:00Z'));
});
test('missing/invalid timezone, invalid hours and unknown history require review instead of guessing',()=>{
 const queue=buildCallQueue(db([client('c1',{timezone:null}),client('c2',{timezone:'Mars/City'}),client('c3',{call_start:'25:00'}),client('c4',{call_days:[]}),client('c5',{created_at:null})]),owner,NOW);
 assert.equal(queue.available.length,0);assert.equal(queue.review.length,5);assert.equal(row(queue,'c5').historyState,'unknown');assert.equal(row(queue,'c5').reasonCodes[0],'history_unknown');
 const known=buildCallQueue(db([client('c1',{created_at:null})],{calls:[{id:'k1',contact_id:'c1',at:'2026-09-01T13:00:00Z',outcome:'No answer'}]}),owner,NOW);assert.equal(row(known).historyState,'never_contacted');assert.equal(row(known).historyLabel,'No meaningful contact recorded');
});
test('malformed callback dates and nonnumeric hours require review rather than silent defaults',()=>{
 const invalid=buildCallQueue(db([client()],{reminders:[{contact_id:'c1',kind:'Call',done:false,at:'2026-10-09T14:00'}]}),owner,NOW);assert.equal(row(invalid).bucket,'review');assert.equal(row(invalid).reasonCodes[0],'callback_time_invalid');
 for(const call_start of [false,[],{}])assert.equal(callingWindow(client('c1',{call_start})).error,'calling_hours_invalid');
});
test('only meaningful recorded outcomes reset inactivity; contact edits, tasks and notes do not',()=>{
 const queue=buildCallQueue(db([client('c1',{updated_at:new Date(NOW).toISOString()})],{calls:[{id:'failed',contact_id:'c1',at:new Date(NOW-2*DAY).toISOString(),outcome:'No answer'},{id:'connected',contact_id:'c1',at:new Date(NOW-8*DAY).toISOString(),outcome:'Connected'}],activity:[{contact_id:'c1',at:new Date(NOW).toISOString(),what:'Contact edited'}],notes:[{entity_id:'c1',at:new Date(NOW).toISOString()}]}),owner,NOW);
 assert.equal(row(queue).availableNow,true);assert.equal(row(queue).inactiveDays,8);assert.equal(row(queue).lastMeaningfulKind,'conversation');
 assert.equal(row(buildCallQueue(db([client()],{calls:[{contact_id:'c1',at:new Date(NOW-DAY).toISOString(),outcome:'Connected'}]}),owner,NOW)).bucket,'upcoming');
});
test('7/14/30-day cutoffs gate the same contact with no assumption of outside-CRM history',()=>{
 const data=db([client()],{calls:[{contact_id:'c1',at:new Date(NOW-10*DAY).toISOString(),outcome:'Connected'}]});assert.equal(row(buildCallQueue(data,owner,NOW,7)).bucket,'available');assert.equal(row(buildCallQueue(data,owner,NOW,14)).bucket,'upcoming');assert.equal(row(buildCallQueue(data,owner,NOW,30)).bucket,'upcoming');assert.equal(buildCallQueue(data,owner,NOW).historyCoverage.includesLiveInbox,false);
});
test('email evidence needs confirmed provider ID, linked contact and actual human incoming/reply timestamp',()=>{
 const email=extra=>({contact_id:'c1',provider:'zoho',zoho_message_id:'real-provider-id',direction:'incoming',received_at:new Date(NOW-DAY).toISOString(),body:'PRIVATE EMAIL BODY',...extra});
 for(const extra of [{zoho_message_id:null},{direction:'outbound'},{auto:'rule1'},{is_auto_reply:true},{received_at:null,updated_at:new Date(NOW).toISOString()},{matched_contact_id:'c2'}])assert.equal(row(buildCallQueue(db([client()],{emails:[email(extra)]}),owner,NOW)).bucket,'available');
 const queue=buildCallQueue(db([client()],{emails:[email({})]}),staff,NOW);assert.equal(row(queue).bucket,'upcoming');assert.equal(row(queue).lastMeaningfulKind,'recorded interaction');assert.ok(!JSON.stringify(queue).includes('PRIVATE EMAIL BODY'));
 const reply=email({direction:'outbound',received_at:null,in_reply_to:'real-thread-id',sent_at:new Date(NOW-DAY).toISOString()});assert.equal(row(buildCallQueue(db([client()],{emails:[reply]}),owner,NOW)).lastMeaningfulKind,'email exchange');
});
test('completed meetings count actual completion, scheduled meetings and cached archived Zoom copies do not',()=>{
 const data=db([client()],{meetings:[{id:'m1',contact_id:'c1',at:new Date(NOW-DAY).toISOString(),notes:'PRIVATE MEETING NOTES'}]});assert.equal(row(buildCallQueue(data,owner,NOW)).bucket,'available');
 data.meetings[0].status='Completed';data.meetings[0].completed_at=new Date(NOW-DAY).toISOString();assert.equal(row(buildCallQueue(data,owner,NOW)).bucket,'upcoming');
 data.meetings=[{id:'local',zoom_meeting_id:'zoom1',contact_id:'c1',zoom_status:'ended',meeting_ended_at:new Date(NOW-DAY).toISOString()}];const ledger=[{id:'canonical',zoom_meeting_id:'zoom1',matched_contact_id:'c1',zoom_status:'ended',meeting_ended_at:new Date(NOW-DAY).toISOString(),archived_at:'2026-10-08'}];assert.equal(row(buildCallQueue(data,owner,NOW,7,ledger)).bucket,'available');
});
test('due callbacks override inactivity/cooldown but future callbacks never allow early calling',()=>{
 const calls=[{contact_id:'c1',at:new Date(NOW-DAY).toISOString(),outcome:'Connected'},{contact_id:'c1',at:new Date(NOW-3600000).toISOString(),outcome:'No answer'}];
 const reminder={id:'r1',contact_id:'c1',kind:'Call',at:new Date(NOW-1800000).toISOString(),done:false};assert.equal(row(buildCallQueue(db([client()],{calls,reminders:[reminder]}),owner,NOW)).availableNow,true);
 reminder.at=new Date(NOW+3600000).toISOString();const later=row(buildCallQueue(db([client()],{calls:[],reminders:[reminder]}),owner,NOW));assert.equal(later.bucket,'upcoming');assert.equal(later.opensAt,reminder.at);assert.equal(later.dueCallback,false);
});
test('a due callback already attempted does not keep bypassing the 24-hour cooldown',()=>{
 const data=db([client()],{calls:[{contact_id:'c1',at:new Date(NOW-3600000).toISOString(),outcome:'No answer'}],reminders:[{id:'r1',contact_id:'c1',kind:'Call',at:new Date(NOW-7200000).toISOString(),done:false,assignee_user_id:'another'}]});const result=row(buildCallQueue(data,staff,NOW));assert.equal(result.bucket,'upcoming');assert.equal(result.callbackAt,null);assert.ok(result.reasonCodes.includes('attempt_cooldown'));
});
test('a future explicit callback displays its real due time despite failure cooldown, without early eligibility',()=>{
 const callbackAt=new Date(NOW+3600000).toISOString(),data=db([client()],{calls:[{contact_id:'c1',at:new Date(NOW-3600000).toISOString(),outcome:'No answer'}],reminders:[{contact_id:'c1',kind:'Call',at:callbackAt,done:false}]});const before=row(buildCallQueue(data,owner,NOW));assert.equal(before.availableNow,false);assert.equal(before.opensAt,callbackAt);assert.equal(before.dueCallback,false);const due=row(buildCallQueue(data,owner,NOW+3600000));assert.equal(due.availableNow,true);assert.equal(due.dueCallback,true);
});
test('callbacks lead priority, followed by closing window and oldest meaningful contact',()=>{
 const contacts=[client('c1'),client('c2'),client('c3',{timezone:'America/Los_Angeles'}),client('c4')],calls=[{contact_id:'c1',at:'2026-09-25T13:00:00Z',outcome:'Connected'},{contact_id:'c2',at:'2026-09-20T13:00:00Z',outcome:'Connected'}],reminders=[{contact_id:'c4',kind:'Call',at:'2026-10-08T20:00:00Z',done:false}];const queue=buildCallQueue(db(contacts,{calls,reminders}),owner,Date.parse('2026-10-08T21:59:00Z'));assert.deepEqual(queue.available.map(r=>r.contactId),['c4','c2','c1','c3']);assert.equal(queue.available[0].windowClosingMinutes,1);
});
test('duplicate/shared phones go to review without revealing an unassigned contact',()=>{
 const c1=client(),c2=client('c2',{name:'UNASSIGNED SECRET',owner_user_id:'owner',phone:c1.phone.replace('+1 ','')});const queue=buildCallQueue(db([c1,c2]),staff,NOW);assert.equal(queue.review.length,1);assert.equal(queue.review[0].reasonCodes[0],'duplicate_phone');assert.ok(!JSON.stringify(queue).includes('UNASSIGNED SECRET'));
});
test('legacy do-not-call outcomes remain excluded until newer recorded consent is supplied',()=>{
 const data=db([client()],{calls:[{contact_id:'c1',outcome:'Do not call',at:'2026-09-20T13:00:00Z'}]});assert.equal(all(buildCallQueue(data,owner,NOW)).length,0);data.contacts[0].consent_given_at='2026-09-21T13:00:00Z';assert.equal(all(buildCallQueue(data,owner,NOW)).length,1);
});
test('permissions are checked before storage and read-only Calls users cannot check or log',async()=>{
 const env={DB:{prepare(){throw Error('Must not read storage');}}};const denied={...staff,visibility:{sections:[],editSections:['calls']}};assert.equal((await handleCallQueue(req(),env,denied)).status,403);const readonly={...staff,visibility:{sections:['calls'],editSections:[]}};assert.equal((await handleCallQueue(req('/check','POST',{contactId:'c1'}),env,readonly)).status,403);assert.equal((await handleCallQueue(req('/outcome','POST',outcome()),env,readonly)).status,403);
});
test('GET and check are read-only with canonical ETag, cutoff, attribution key and no external calls',async t=>{
 const f=fixture();let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;throw Error('No provider calls');});try{const before=f.read(),get=await handleCallQueue(req(),f.env,staff,options);assert.equal(get.status,200);assert.equal(get.headers.get('ETag'),'"2026-10-08T12:00:00.000Z"');assert.equal((await get.json()).snapshotVersion,'2026-10-08T12:00:00.000Z');const check=await handleCallQueue(req('/check','POST',{contactId:'c1',inactivityDays:14}),f.env,staff,options);assert.equal(check.status,200);const body=await check.json();assert.equal(body.eligible,true);assert.equal(body.inactivityDays,14);assert.match(body.idempotencyKey,/^[a-f0-9-]{36}$/);assert.deepEqual(f.read(),before);assert.equal(calls,0);
 }finally{f.sql.close();}
});
test('check independently rejects unassigned, changed status, bad phone, consent and selected inactivity',async()=>{
 const f=fixture();try{for(const [changes,reason] of [[{owner_user_id:'other'},null],[{archived_at:'today'},'archived_contact'],[{phone:''},'missing_phone'],[{consent_withdrawn_at:'today'},'consent_withdrawn'],[{timezone:null},'timezone_unknown']]){f.write(db([client('c1',changes)]));const resp=await handleCallQueue(req('/check','POST',{contactId:'c1'}),f.env,staff,options);assert.equal(resp.status,reason?409:404);if(reason)assert.ok((await resp.json()).reasonCodes.includes(reason));}
 f.write(db([client()],{calls:[{contact_id:'c1',at:new Date(NOW-10*DAY).toISOString(),outcome:'Connected'}]}));assert.equal((await handleCallQueue(req('/check','POST',{contactId:'c1',inactivityDays:7}),f.env,staff,options)).status,200);assert.equal((await handleCallQueue(req('/check','POST',{contactId:'c1',inactivityDays:14}),f.env,staff,options)).status,409);assert.equal((await handleCallQueue(req('?inactivityDays=2'),f.env,staff,options)).status,400);
 }finally{f.sql.close();}
});
test('owner queue merges org-scoped completed Zoom meetings without provider access',async()=>{
 const f=fixture();try{f.sql.prepare('INSERT INTO zoom_crm_meetings VALUES(?,?,?,?,?,?,?)').run('m1','org1','c1','z1','ended',new Date(NOW-DAY).toISOString(),null);f.sql.prepare('INSERT INTO zoom_crm_meetings VALUES(?,?,?,?,?,?,?)').run('m2','org2','c1','z2','ended',new Date(NOW).toISOString(),null);const body=await (await handleCallQueue(req(),f.env,owner,options)).json();assert.equal(row(body).lastMeaningfulAt,new Date(NOW-DAY).toISOString());assert.equal(row(body).bucket,'upcoming');
 }finally{f.sql.close();}
});
test('outcomes append caller-attributed records and preserve contact/private/unrelated workspace fields',async t=>{
 const f=fixture(db([client(),client('c2',{owner_user_id:'other',monthly_override:500})],{org:{private:'preserve'},notes:[{id:'private',body:'keep'}]}));let external=0;t.mock.method(globalThis,'fetch',()=>{external++;throw Error('No external calls');});try{const resp=await handleCallQueue(req('/outcome','POST',{...outcome(),by_user_id:'forged',phone:'change',archived_at:'today',owner_user_id:'forged'}),f.env,staff,options);assert.equal(resp.status,200);const body=await resp.json(),saved=f.read();assert.equal(body.duplicate,false);assert.equal(resp.headers.get('ETag'),JSON.stringify(body.updatedAt));assert.deepEqual(saved.contacts,f.data.contacts);assert.deepEqual(saved.notes,f.data.notes);assert.deepEqual(saved.org,f.data.org);assert.equal(saved.calls[0].by_user_id,staff.id);assert.equal(saved.calls[0].by,staff.name);assert.equal(saved.calls[0].at,new Date(NOW).toISOString());assert.equal(saved.calls[0].meaningful_contact,true);assert.equal(saved.calls[0].queue,'next_to_call');assert.equal(saved.activity[0].target.recordId,'c1');assert.equal(saved.activity[0].target.callId,saved.calls[0].id);assert.equal(external,0);assert.equal(row(buildCallQueue(saved,staff,NOW)).bucket,'upcoming');
 }finally{f.sql.close();}
});
test('outcome logging is allowed after a dispatched call crosses its closing window',async()=>{
 const f=fixture();try{assert.equal((await handleCallQueue(req('/outcome','POST',outcome()),f.env,staff,{now:()=>Date.parse('2026-10-08T23:00:00Z')})).status,200);assert.equal(f.read().calls.length,1);
 }finally{f.sql.close();}
});
test('identical idempotency replays return one call; altered/other-contact keys reject',async()=>{
 const f=fixture(db([client(),client('c2')]));try{for(let i=0;i<2;i++){const resp=await handleCallQueue(req('/outcome','POST',outcome()),f.env,staff,options);assert.equal(resp.status,200);assert.equal((await resp.json()).duplicate,i===1);}assert.equal(f.read().calls.length,1);assert.equal((await handleCallQueue(req('/outcome','POST',outcome({note:'Different'})),f.env,staff,options)).status,409);assert.equal((await handleCallQueue(req('/outcome','POST',outcome({contactId:'c2'})),f.env,staff,options)).status,409);assert.equal(f.read().calls.length,1);
 }finally{f.sql.close();}
});
test('callback saves require an absolute future date, preserve foreign reminders and replay after due time',async()=>{
 const foreign={id:'r1',contact_id:'c1',assignee_user_id:'other',kind:'Call',at:new Date(NOW-3600000).toISOString(),done:false};const f=fixture(db([client()],{reminders:[foreign]}));try{
 for(const callbackAt of ['2026-10-09T19:00','invalid',new Date(NOW-DAY).toISOString()])assert.equal((await handleCallQueue(req('/outcome','POST',outcome({outcome:'Call back later',note:'Requested tomorrow.',callbackAt})),f.env,staff,options)).status,400);
 const body=outcome({outcome:'Call back later',note:'Requested tomorrow at 7 PM PKT.',callbackAt:'2026-10-09T19:00:00+05:00'});assert.equal((await handleCallQueue(req('/outcome','POST',body),f.env,staff,options)).status,200);let saved=f.read();assert.deepEqual(saved.reminders.find(r=>r.id==='r1'),foreign);const callback=saved.reminders.find(r=>r.call_queue_callback);assert.equal(callback.at,'2026-10-09T14:00:00.000Z');assert.equal(callback.assignee_user_id,staff.id);assert.equal(callback.done,false);assert.equal(saved.calls[0].meaningful_contact,false);
 const duplicate=await handleCallQueue(req('/outcome','POST',body),f.env,staff,{now:()=>NOW+2*DAY});assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);assert.equal(f.read().calls.length,1);assert.equal(row(buildCallQueue(saved,staff,NOW)).opensAt,'2026-10-09T14:00:00.000Z');
 }finally{f.sql.close();}
});
test('wrong-number outcomes require verification and do-not-call outcomes prevent subsequent dialing',async()=>{
 const f=fixture();try{assert.equal((await handleCallQueue(req('/outcome','POST',outcome({outcome:'Wrong number',note:'Recipient confirmed the wrong number.'})),f.env,staff,options)).status,200);assert.equal(row(buildCallQueue(f.read(),staff,NOW)).reasonCodes[0],'wrong_number');assert.equal((await handleCallQueue(req('/check','POST',{contactId:'c1'}),f.env,staff,options)).status,409);
 assert.equal((await handleCallQueue(req('/outcome','POST',outcome({idempotencyKey:'attempt_identifier_0002',outcome:'Do not call',note:'Client requested no phone calls.'})),f.env,staff,options)).status,200);const saved=f.read();assert.equal(saved.contacts[0].do_not_call,true);assert.equal(saved.contacts[0].consent_withdrawn_at,new Date(NOW).toISOString());assert.equal(all(buildCallQueue(saved,staff,NOW)).length,0);assert.equal((await handleCallQueue(req('/check','POST',{contactId:'c1'}),f.env,staff,options)).status,409);
 }finally{f.sql.close();}
});
test('outcome validation rejects invented statuses, keys, oversized notes and unassigned/non-Client targets',async()=>{
 const f=fixture(db([client(),client('c2',{owner_user_id:'other'}),client('c3',{status:'Prospect',archived_at:'2026-10-01'})]));try{for(const extra of [{outcome:'Fantastic'},{idempotencyKey:''},{note:'x'.repeat(4001)},{outcome:'Call back later',note:'Asked later.'},{outcome:'Wrong number',note:''}])assert.equal((await handleCallQueue(req('/outcome','POST',outcome(extra)),f.env,staff,options)).status,400);assert.equal((await handleCallQueue(req('/outcome','POST',outcome({contactId:'c2'})),f.env,staff,options)).status,404);assert.equal((await handleCallQueue(req('/outcome','POST',outcome({contactId:'c3'})),f.env,staff,options)).status,409);assert.equal(f.read().calls.length,0);assert.equal(CALL_OUTCOMES.length,6);
 }finally{f.sql.close();}
});
test('concurrent identical outcomes cannot duplicate records',async()=>{
 const f=fixture();try{const responses=await Promise.all([handleCallQueue(req('/outcome','POST',outcome()),f.env,staff,options),handleCallQueue(req('/outcome','POST',outcome()),f.env,staff,options)]);assert.ok(responses.every(r=>r.status===200));const values=await Promise.all(responses.map(r=>r.json()));assert.equal(values.filter(v=>v.duplicate).length,1);assert.equal(f.read().calls.length,1);assert.equal(f.read().activity.length,1);
 }finally{f.sql.close();}
});
test('a racing user edit is preserved and outcome reports conflict for same-key retry',async()=>{
 const f=fixture();try{const prepare=f.env.DB.prepare;let changed=false;f.env.DB.prepare=q=>{const prepared=prepare(q);if(!q.startsWith('UPDATE crm_snapshot SET data=?'))return prepared;return {...prepared,bind(...v){const bound=prepared.bind(...v);return {...bound,async run(){if(!changed){changed=true;const fresh=f.read();fresh.contacts[0].name='NEWER OWNER EDIT';f.write(fresh,'2026-10-08T14:00:01.000Z');}return bound.run();}};}};};
 const first=await handleCallQueue(req('/outcome','POST',outcome()),f.env,staff,options);assert.equal(first.status,409);assert.equal((await first.json()).retrySameIdentifier,true);assert.equal(f.read().contacts[0].name,'NEWER OWNER EDIT');assert.equal(f.read().calls.length,0);assert.equal((await handleCallQueue(req('/outcome','POST',outcome()),f.env,staff,options)).status,200);assert.equal(f.read().contacts[0].name,'NEWER OWNER EDIT');assert.equal(f.read().calls.length,1);
 }finally{f.sql.close();}
});
test('wrong organization cannot read or append another workspace record',async()=>{
 const f=fixture();try{assert.equal((await handleCallQueue(req(),f.env,{...staff,orgId:'other'},options)).status,409);assert.equal((await handleCallQueue(req('/outcome','POST',outcome()),f.env,{...staff,orgId:'other'},options)).status,409);assert.equal(f.read().calls.length,0);
 }finally{f.sql.close();}
});
test('a targeted check still detects a hidden duplicate phone without evaluating unrelated windows',async()=>{
 const data=db([client(),client('c2',{owner_user_id:'other',phone:client().phone,timezone:'Mars/City'})]);const f=fixture(data);try{const resp=await handleCallQueue(req('/check','POST',{contactId:'c1'}),f.env,staff,options);assert.equal(resp.status,409);assert.deepEqual((await resp.json()).reasonCodes,['duplicate_phone']);
 }finally{f.sql.close();}
});

test('queue reads and outcome appends preserve compressed imported contact data',async()=>{
 const f=fixture();try {
  f.data.original_imported_notes='Illustrative source content — مثال. '.repeat(40000);
  f.sql.prepare('UPDATE crm_snapshot SET data=?').run(await encodeSnapshot(JSON.stringify(f.data)));
  const queue=await handleCallQueue(req(),f.env,staff,options);assert.equal(queue.status,200);assert.equal((await queue.json()).available[0].contactId,'c1');
  assert.equal((await handleCallQueue(req('/outcome','POST',outcome()),f.env,staff,options)).status,200);
  const stored=f.sql.prepare('SELECT data FROM crm_snapshot').get().data;assert.ok(stored.startsWith(SNAPSHOT_GZIP_PREFIX));const saved=await decodeSnapshot(stored);assert.equal(saved.calls.length,1);assert.equal(saved.original_imported_notes,f.data.original_imported_notes);assert.equal(saved.contacts[0].name,f.data.contacts[0].name);
 }finally{f.sql.close();}
});
