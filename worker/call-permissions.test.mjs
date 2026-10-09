import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SECTION_CHOICES,attachVisibility,canUseCallQueue,allowedStaffRoute,scopeSnapshot,mergeScopedWrite,handleUsers} from './user-access.mjs';

const person={id:'u_staff',orgId:'org1',name:'Assigned Staff',email:'staff@example.test',roleCode:'contributor',isOwner:false};
const viewer=(sections=['calls'],editSections=[])=>({...person,visibility:{sections,editSections,scope:'assigned'}});
const source=()=>({
 users:[{id:'legacy_staff',auth_user_id:person.id,name:person.name,email:person.email},{id:'u_ibrar',name:'Ibrar',email:'owner@example.test'}],
 contacts:[
  {id:'mine',status:'Client',name:'Assigned active client',owner_user_id:'legacy_staff',email:'private@example.test',phone:'+15550001111',notes:'private client notes',timezone:'America/New_York'},
  {id:'other',status:'Client',name:'Other private client',owner_user_id:'u_ibrar',email:'other@example.test'},
  {id:'lead',status:'Lead',name:'Assigned lead',owner_user_id:person.id},
  {id:'archived',status:'Client',name:'Archived client',owner_user_id:person.id,archived_at:'2026-10-01'},
  {id:'deleted',status:'Client',name:'Deleted client',owner_user_id:person.id,deleted_at:'2026-10-01'}
 ],
 calls:[
  {id:'q_mine',contact_id:'mine',queue:'next_to_call',by_user_id:person.id,notes:'private outcome note',assignee_user_id:person.id},
  {id:'q_other',contact_id:'other',queue:'next_to_call',by_user_id:person.id,notes:'other note'},
  {id:'q_foreign',contact_id:'mine',queue:'next_to_call',by_user_id:'u_ibrar'},
  {id:'zoom',contact_id:'mine',by_user_id:person.id,zoom_call_id:'ledger secret',assignee_user_id:person.id}
 ],
 deals:[{id:'d1',contact_id:'mine'}],files:[{id:'file',contact_id:'mine'}],todos:[],tickets:[],social_posts:[],meetings:[],reminders:[],activity:[],user_prefs:{legacy_staff:{theme:'white'}},org:{name:'Serene Ops',capacity_hours:200},access:[{id:'credential',value:'secret'}]
});
const visibilityStore=row=>({DB:{prepare(){return {bind(){return {first:async()=>row};}};}}});

test('Calls is an optional editable assigned section and owner access includes it',async()=>{
 assert.deepEqual(SECTION_CHOICES.find(s=>s.id==='calls'),{id:'calls',label:'Assigned calling list',editable:true});
 const owner=await attachVisibility({}, {id:'u_ibrar',roleCode:'owner_admin'});
 assert.equal(canUseCallQueue(owner),true);assert.equal(canUseCallQueue(owner,true),true);
 assert.ok(owner.visibility.sections.includes('calls'));assert.ok(owner.visibility.editSections.includes('calls'));
});

test('recognizing Calls does not grant it to any existing or missing visibility row',async()=>{
 const rows=[null,{sections_json:'["contacts","work"]',edit_sections_json:'["work"]'},{sections_json:'broken',edit_sections_json:'[]'}];
 for(const row of rows){const user=await attachVisibility(visibilityStore(row),{...person});assert.equal(canUseCallQueue(user),false);assert.equal(canUseCallQueue(user,true),false);assert.equal(user.visibility.sections.includes('calls'),false);}
 const unchanged=await attachVisibility(visibilityStore(rows[1]),{...person});assert.deepEqual(unchanged.visibility.sections,['contacts','work']);assert.deepEqual(unchanged.visibility.editSections,['work']);
});

test('read permission and edit permission are separate and malformed edit-only grants fail closed',async()=>{
 assert.equal(canUseCallQueue(viewer()),true);assert.equal(canUseCallQueue(viewer(),true),false);
 assert.equal(canUseCallQueue(viewer(['calls'],['calls']),true),true);
 for(const u of [null,viewer([],['calls']),{...person,visibility:{sections:'calls',editSections:'calls'}}]){assert.equal(canUseCallQueue(u),false);assert.equal(canUseCallQueue(u,true),false);}
 const u=await attachVisibility(visibilityStore({sections_json:'["activity"]',edit_sections_json:'["calls"]'}),{...person});assert.deepEqual(u.visibility.editSections,[]);
});

test('the new queue routes enforce exact methods and Calls permissions',()=>{
 const read=viewer(),edit=viewer(['calls'],['calls']),removed=viewer(['contacts'],[]);
 for(const u of [read,edit])assert.equal(allowedStaffRoute('/api/call-queue','GET',u),true);
 for(const path of ['/api/call-queue/check','/api/call-queue/outcome','/api/zoom/calls/claim']){assert.equal(allowedStaffRoute(path,'POST',edit),true);assert.equal(allowedStaffRoute(path,'POST',read),false);assert.equal(allowedStaffRoute(path,'GET',edit),false);assert.equal(allowedStaffRoute(path,'POST',removed),false);}
 assert.equal(allowedStaffRoute('/api/zoom/phone-mapping','GET',edit),true);
 assert.equal(allowedStaffRoute('/api/zoom/phone-mapping','GET',read),false);
 assert.equal(allowedStaffRoute('/api/zoom/phone-mapping','POST',edit),false);
 for(const method of ['POST','PUT','DELETE','PATCH'])assert.equal(allowedStaffRoute('/api/call-queue',method,edit),false);
 assert.equal(allowedStaffRoute('/api/call-queue','GET'),false);
 assert.equal(allowedStaffRoute('/api/call-queue','GET',removed),false);
});

test('Calls never grants general calls CRUD, Zoom ledgers, admin mapping writes or unrelated APIs',()=>{
 const edit=viewer(['calls'],['calls']);
 for(const path of ['/api/calls','/api/calls/q_mine','/api/zoom/calls','/api/zoom/phone-users','/api/zoom/calls/zoom','/api/zoom/token','/api/zoom/phone-mapping/u_staff','/api/call-queue/other','/api/call-queue/outcome/extra','/api/contacts','/api/users'])for(const method of ['GET','POST','PUT','DELETE'])assert.equal(allowedStaffRoute(path,method,edit),false,path+' '+method);
 assert.equal(allowedStaffRoute('/api/db'),true);assert.equal(allowedStaffRoute('/api/me'),true);
});

test('a Calls-only snapshot contains no contact directory, files, call ledger or private fields',()=>{
 const db=source(),view=scopeSnapshot(db,viewer(['calls','activity'],['calls']));
 for(const key of ['contacts','files','calls','deals','todos','access'])assert.deepEqual(view[key],[],key);
 assert.deepEqual(view.users.map(u=>u.id),['legacy_staff']);
 for(const text of ['private@example.test','+15550001111','private client notes','private outcome note','ledger secret','Other private client'])assert.equal(JSON.stringify(view).includes(text),false,text);
});

test('Contacts permission keeps its established assigned detail scope without exposing any calls ledger',()=>{
 const view=scopeSnapshot(source(),viewer(['contacts','calls'],['calls']));
 assert.ok(view.contacts.some(c=>c.id==='mine'&&c.email==='private@example.test'));
 assert.deepEqual(view.calls.map(k=>k.id),['q_mine']);assert.ok(view.calls.every(k=>k.by==='You'));
});

test('calling activity requires Calls and a current active assigned Client, validating referenced logs',()=>{
 const db=source(),make=(id,contactId,callId)=>({id,kind:'call',who:person.name,by_user_id:person.id,what:'Call outcome saved',contact_id:contactId,target:{section:'calls',recordId:contactId,...(callId?{callId}:{})}});
 db.activity=[make('mine','mine','q_mine'),make('other','other','q_other'),make('lead','lead'),make('archived','archived'),make('deleted','deleted'),make('foreign-log','mine','q_foreign'),make('zoom-ledger','mine','zoom'),make('unknown-log','mine','missing'),{...make('other-actor','mine','q_mine'),who:'Ibrar',by_user_id:'u_ibrar'},make('no-contact',null),{...make('contradictory','mine','q_other'),contact_id:'other'}];
 assert.deepEqual(scopeSnapshot(db,viewer(['calls','activity'])).activity.map(a=>a.id),['mine','lead']);
 assert.deepEqual(scopeSnapshot(db,viewer(['contacts','activity'])).activity,[]);
 assert.deepEqual(scopeSnapshot(db,viewer(['calls'])).activity,[]);
 db.contacts[0].owner_user_id='u_ibrar';assert.deepEqual(scopeSnapshot(db,viewer(['calls','activity'])).activity.map(a=>a.id),['lead']);
});

test('removing Calls immediately removes new queue activity and denies each dedicated queue route',()=>{
 const db=source();db.activity=[{id:'queue',kind:'call',who:person.name,what:'Call outcome saved',contact_id:'mine',target:{section:'calls',recordId:'mine',callId:'q_mine'}}];
 const u=viewer(['calls','contacts','activity'],['calls']);assert.equal(scopeSnapshot(db,u).activity.length,1);
 u.visibility.sections=['contacts','activity'];u.visibility.editSections=[];
 assert.deepEqual(scopeSnapshot(db,u).activity,[]);
 for(const [path,method]of [['/api/call-queue','GET'],['/api/call-queue/check','POST'],['/api/call-queue/outcome','POST'],['/api/zoom/phone-mapping','GET'],['/api/zoom/calls/claim','POST']])assert.equal(allowedStaffRoute(path,method,u),false);
});

test('legacy own call activity retains Contacts access only for visible assigned contact references',()=>{
 const db=source();db.activity=[{id:'legacy-mine',kind:'call',who:person.name,what:'Call logged',contact_id:'mine'},{id:'legacy-other',kind:'call',who:person.name,what:'Call logged',contact_id:'other'}];
 assert.deepEqual(scopeSnapshot(db,viewer(['contacts','activity'])).activity.map(a=>a.id),['legacy-mine']);
 assert.deepEqual(scopeSnapshot(db,viewer(['calls','activity'])).activity,[]);
});

test('Calls edit grants cannot alter contact assignment, existing call logs, or create logs through snapshot autosave',()=>{
 const db=source(),u=viewer(['calls'],['calls']),incoming=scopeSnapshot(db,u);
 incoming.calls=[{...db.calls[0],notes:'forged note'},{id:'forged',contact_id:'other',queue:'next_to_call'}];
 incoming.contacts=[{...db.contacts[1],owner_user_id:person.id}];
 incoming.activity=[{who:person.name,kind:'call',what:'Forged event'}];
 const merged=mergeScopedWrite(db,incoming,u);assert.deepEqual(merged.calls,db.calls);assert.deepEqual(merged.contacts,db.contacts);assert.deepEqual(merged.activity,db.activity);
});

test('owner provisioning can grant Calls explicitly but it is not inserted into unrelated grants',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE users(id TEXT PRIMARY KEY,org_id TEXT,name TEXT,email TEXT UNIQUE,role_id TEXT,status TEXT,created_at TEXT DEFAULT 'now',updated_at TEXT,deleted_at TEXT);CREATE TABLE user_visibility(org_id TEXT,user_id TEXT,sections_json TEXT,edit_sections_json TEXT,updated_at TEXT,PRIMARY KEY(org_id,user_id));");
 const wrap=(s,v=[])=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});
 const env={DB:{prepare(q){const s=sql.prepare(q);return {...wrap(s),bind(...v){return wrap(s,v);}};}}};
 const actor={id:'u_ibrar',orgId:'org1',isOwner:true};
 const create=(name,sections,editSections)=>new Request('https://crm.test/api/users',{method:'POST',body:JSON.stringify({name,email:name+'@example.test',sections,editSections})});
 try{
  let result=await handleUsers(create('caller',['calls'],['calls']),env,actor);assert.equal(result.status,200);const a=await result.json();
  assert.deepEqual(JSON.parse(sql.prepare('SELECT sections_json FROM user_visibility WHERE user_id=?').get(a.id).sections_json),['calls']);
  assert.deepEqual(JSON.parse(sql.prepare('SELECT edit_sections_json FROM user_visibility WHERE user_id=?').get(a.id).edit_sections_json),['calls']);
  result=await handleUsers(create('worker',['work'],['work']),env,actor);assert.equal(result.status,200);const b=await result.json();
  assert.deepEqual(JSON.parse(sql.prepare('SELECT sections_json FROM user_visibility WHERE user_id=?').get(b.id).sections_json),['work']);
  result=await handleUsers(create('bad',['work'],['calls']),env,actor);assert.equal(result.status,400);
 }finally{sql.close();}
});
